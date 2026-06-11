import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, Trophy, Users, Calendar, MapPin, DollarSign, Newspaper, Clock,
  BarChart3, ArrowRight, Share2, Check,
} from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { Tournament, BracketGenerated, BracketMatch, PrizePool, MatchPlayerStat } from './TournamentCreation';
import { formatPrize } from './TournamentCreation';
import type { NewsItem } from './AdminPanel';
import { getTournaments, getNews, loadWithRetryPolled } from '../services/db';
import { getStageOptions, statMatchesPlayer } from './StatsPage';
import { BracketDisplay } from './BracketDisplay';
import { computePlacement } from './TeamsPage';
import { deriveTournamentStatus } from '../utils/tournamentStatus';
import { orderRosterIglFirst } from '../utils/roster';
import { mapImageUrl } from '../utils/valorantAssets';
import { bracketRoundLabel } from '../utils/bracketRounds';

type TabKey = 'overview' | 'matches' | 'bracket' | 'standings' | 'teams' | 'news';

// Podium colors: gold / silver / bronze
const PLACE_COLORS = ['#facc15', '#d1d5db', '#cd7f32'];

const STATUS_META: Record<string, { label: string; className: string }> = {
  'in-progress': { label: 'Live', className: 'arena-tp-status--live' },
  'registration': { label: 'Registration Open', className: 'arena-tp-status--open' },
  'planning': { label: 'Upcoming', className: 'arena-tp-status--planning' },
  'completed': { label: 'Completed', className: 'arena-tp-status--done' },
};

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function getMatchStatus(date?: string, time?: string): 'upcoming' | 'live' | 'completed' {
  if (!date) return 'upcoming';
  try {
    const dt = new Date(`${date}T${time || '00:00'}`);
    const diffH = (dt.getTime() - Date.now()) / 36e5;
    if (diffH > -3 && diffH < 3) return 'live';
    if (diffH < -3) return 'completed';
    return 'upcoming';
  } catch {
    return 'upcoming';
  }
}

function isMatchDecidedByMaps(match: BracketMatch): boolean {
  const maps = match.maps ?? [];
  if (maps.length === 0) return false;
  const maxMaps = match.format === 'bo1' ? 1 : match.format === 'bo5' ? 5 : 3;
  let w1 = 0, w2 = 0;
  for (const m of maps) {
    if (m.team1Score > m.team2Score) w1++;
    else if (m.team2Score > m.team1Score) w2++;
  }
  const needed = Math.ceil(maxMaps / 2);
  if (w1 >= needed || w2 >= needed) return true;
  if (maps.length >= maxMaps && w1 !== w2) return true;
  return false;
}

function effectiveStatus(m: BracketMatch): 'upcoming' | 'live' | 'completed' {
  if (m.winner || isMatchDecidedByMaps(m)) return 'completed';
  return getMatchStatus(m.date, m.time);
}

// Series score (map wins per side). Falls back to a 1-0 from the recorded
// winner when no maps were entered.
function deriveScore(m: BracketMatch): { s1: number; s2: number } {
  const maps = m.maps ?? [];
  if (maps.length === 0) {
    return {
      s1: m.winner === m.team1Id ? 1 : 0,
      s2: m.winner === m.team2Id ? 1 : 0,
    };
  }
  let s1 = 0, s2 = 0;
  for (const map of maps) {
    if (map.team1Score > map.team2Score) s1++;
    else if (map.team2Score > map.team1Score) s2++;
  }
  return { s1, s2 };
}

// Champion + runner-up of a finished elimination tournament: the winner of the
// final stage's last match (the grand final). Returns null while undecided.
function deriveChampion(t: Tournament): {
  champion: { id?: string; name: string; logo?: string };
  runnerUp?: { id?: string; name: string; logo?: string };
} | null {
  const finalStageBracket = t.stage2Bracket || t.generatedBracket;
  if (!finalStageBracket?.rounds?.length) return null;
  const lastRound = finalStageBracket.rounds[finalStageBracket.rounds.length - 1];
  const grandFinal = lastRound?.[lastRound.length - 1];
  if (!grandFinal?.winner) return null;
  const byId = (id?: string) => t.teams.find(tm => tm.id === id);
  const champTeam = byId(grandFinal.winner);
  const champName = champTeam?.name
    ?? (grandFinal.winner === grandFinal.team1Id ? grandFinal.team1Name : grandFinal.team2Name);
  if (!champName || isTeamSlotName(champName)) return null;
  const runnerId = grandFinal.winner === grandFinal.team1Id ? grandFinal.team2Id : grandFinal.team1Id;
  const runnerTeam = byId(runnerId);
  const runnerName = runnerTeam?.name
    ?? (grandFinal.winner === grandFinal.team1Id ? grandFinal.team2Name : grandFinal.team1Name);
  return {
    champion: { id: champTeam?.id, name: champName, logo: champTeam?.logo },
    runnerUp: runnerName && !isTeamSlotName(runnerName)
      ? { id: runnerTeam?.id, name: runnerName, logo: runnerTeam?.logo }
      : undefined,
  };
}

// Per-player stat totals across every recorded map of the tournament.
// Deduped by match+map+player so duplicated match copies don't double-count.
interface PlayerTotals {
  playerId: string;   // raw stat id (Riot ID) — kept for keying
  // The roster slot id this stat resolves to, used for /player links. Falls back
  // to the raw playerId only if no roster match is found.
  rosterId: string;
  name: string;
  teamName: string;
  kills: number;
  maps: number;
  avgAcs: number;
  avgHs: number;
}

function aggregatePlayerTotals(t: Tournament): PlayerTotals[] {
  const teamNameById: Record<string, string> = {};
  t.teams.forEach(tm => { teamNameById[tm.id] = tm.name; });

  const totals = new Map<string, {
    playerId: string; name: string; teamId: string; sample: MatchPlayerStat;
    kills: number; maps: number; acsSum: number; hsSum: number;
  }>();
  const seen = new Set<string>();
  for (const stage of getStageOptions(t)) {
    for (const bracket of stage.brackets) {
      for (const match of bracket.rounds.flat()) {
        for (const map of match.maps ?? []) {
          for (const ps of map.playerStats ?? []) {
            const key = `${match.id}|${map.mapName}|${ps.playerId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const cur = totals.get(ps.playerId) ?? {
              playerId: ps.playerId, name: ps.playerName, teamId: ps.teamId, sample: ps,
              kills: 0, maps: 0, acsSum: 0, hsSum: 0,
            };
            cur.kills += ps.kills;
            cur.maps += 1;
            cur.acsSum += ps.acs;
            cur.hsSum += ps.hsPercent;
            totals.set(ps.playerId, cur);
          }
        }
      }
    }
  }

  // Resolve each stat row to a roster slot id so /player links work (the stat's
  // own playerId is a Riot ID, which the player page can't look up directly).
  const resolveRosterId = (sample: MatchPlayerStat, teamId: string): string => {
    const team = t.teams.find(tm => tm.id === teamId);
    const hit = team?.players.find(p => statMatchesPlayer(sample, p))
      ?? t.teams.flatMap(tm => tm.players).find(p => statMatchesPlayer(sample, p));
    return hit?.id ?? sample.playerId;
  };

  return [...totals.values()].map(p => ({
    playerId: p.playerId,
    rosterId: resolveRosterId(p.sample, p.teamId),
    name: p.name,
    teamName: teamNameById[p.teamId] ?? '',
    kills: p.kills,
    maps: p.maps,
    avgAcs: p.maps > 0 ? p.acsSum / p.maps : 0,
    avgHs: p.maps > 0 ? p.hsSum / p.maps : 0,
  }));
}

// Tournament MVP: the player with the most total kills.
function deriveMvp(t: Tournament): PlayerTotals | null {
  let best: PlayerTotals | null = null;
  for (const p of aggregatePlayerTotals(t)) {
    if (!best || p.kills > best.kills) best = p;
  }
  return best && best.kills > 0 ? best : null;
}

// Event leaders for the overview card: top player per category.
function deriveLeaders(t: Tournament): { label: string; player: PlayerTotals; value: string }[] {
  const players = aggregatePlayerTotals(t).filter(p => p.maps > 0);
  if (players.length === 0) return [];
  const top = (cmp: (a: PlayerTotals, b: PlayerTotals) => number) =>
    players.slice().sort(cmp)[0];
  const kills = top((a, b) => b.kills - a.kills);
  const acs = top((a, b) => b.avgAcs - a.avgAcs);
  const hs = top((a, b) => b.avgHs - a.avgHs);
  const out: { label: string; player: PlayerTotals; value: string }[] = [];
  if (kills.kills > 0) out.push({ label: 'Kills', player: kills, value: `${kills.kills}` });
  if (acs.avgAcs > 0) out.push({ label: 'ACS', player: acs, value: `${Math.round(acs.avgAcs)}` });
  if (hs.avgHs > 0) out.push({ label: 'HS%', player: hs, value: `${Math.round(hs.avgHs)}%` });
  return out;
}

// Last N series results (chronological bracket order) for one team — the
// W/L form dots on the Teams tab.
function teamForm(
  matches: { match: BracketMatch; status: string }[],
  teamId: string,
  n = 3,
): { won: boolean; opponent: string }[] {
  const out: { won: boolean; opponent: string }[] = [];
  for (const { match: m, status } of matches) {
    if (status !== 'completed') continue;
    const isT1 = m.team1Id === teamId;
    const isT2 = m.team2Id === teamId;
    if (!isT1 && !isT2) continue;
    const { s1, s2 } = deriveScore(m);
    if (s1 === s2) continue;
    out.push({
      won: isT1 ? s1 > s2 : s2 > s1,
      opponent: isT1 ? m.team2Name : m.team1Name,
    });
  }
  return out.slice(-n);
}

// Rank weight for a placement string: '1st' → 1, 'Top 4' → 4, unknown → last.
function placementRank(p: string | null): number {
  if (!p) return Number.MAX_SAFE_INTEGER;
  const m = p.match(/\d+/);
  return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
}

// Round-by-round progress of the final stage bracket, for the overview's
// progress stepper. Round-robin has no meaningful "rounds to a final" → empty.
function deriveStageProgress(t: Tournament): { label: string; done: boolean }[] {
  const b = t.stage2Bracket || t.generatedBracket;
  if (!b?.rounds?.length || b.bracketType === 'roundrobin') return [];

  const isDouble = b.rounds.flat().some(m => m.bracketSection === 'losers');
  // Track the winners-side path to the title (plus the grand final for double
  // elim) — the losers bracket runs in parallel and would clutter the stepper.
  const mainRounds = b.rounds.filter(r =>
    r.length > 0 && (!isDouble || !r[0].bracketSection || r[0].bracketSection === 'winners'),
  );
  const gfRounds = isDouble
    ? b.rounds.filter(r => r.length > 0 && r[0].bracketSection === 'grand-final')
    : [];

  const n = mainRounds.length;
  const labelFor = (i: number): string => {
    const fromEnd = n - 1 - i;
    if (fromEnd === 0) return isDouble ? 'WB Final' : 'Final';
    if (fromEnd === 1) return 'Semi Finals';
    if (fromEnd === 2) return 'Quarter Finals';
    return `Round ${i + 1}`;
  };

  const steps = mainRounds.map((round, i) => ({
    label: labelFor(i),
    done: round.every(m => !!m.winner),
  }));
  for (const r of gfRounds) {
    steps.push({ label: 'Grand Final', done: r.every(m => !!m.winner) });
  }
  return steps.length > 1 ? steps : [];
}

// A bracket match isn't a real, listable match until both slots are real teams.
function isTeamSlotName(name: string) {
  return !name || name === 'Select Team' || name.startsWith('Team Slot') || name === 'TBD' ||
    name.startsWith('Winner') || name.startsWith('Loser') ||
    name === 'LB TBD' || name === 'WB Champion' || name === 'LB Champion';
}


export function TournamentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  // "Copied" feedback on the hero share button.
  const [copied, setCopied] = useState(false);
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (http / old browser) — nothing sensible to do.
    }
  };

  // Initial tab can be deep-linked via the URL hash (e.g. /tournament/x#bracket).
  // Falls back to Overview for any missing/unknown hash.
  const [tab, setTab] = useState<TabKey>(() => {
    const hash = window.location.hash.replace('#', '') as TabKey;
    return (['overview', 'matches', 'bracket', 'standings', 'teams', 'news'] as TabKey[]).includes(hash) ? hash : 'overview';
  });

  // Initial retrying load + background polling so bracket/match updates appear
  // on an open tournament page. setLoading(false) only on the first success;
  // subsequent polls swap data in silently without flashing the loader.
  useEffect(() => loadWithRetryPolled(
    () => Promise.all([getTournaments(), getNews()]),
    ([ts, ns]) => { setTournaments(ts); setNews(ns); setLoading(false); },
  ), []);

  const tournament = useMemo(() => tournaments.find(t => t.id === id) || null, [tournaments, id]);
  const stages = useMemo(() => (tournament ? getStageOptions(tournament) : []), [tournament]);

  // All listable matches (both teams real), tagged with stage + status.
  const matches = useMemo(() => {
    const out: { match: BracketMatch; stage: string; status: 'upcoming' | 'live' | 'completed' }[] = [];
    for (const stage of stages) {
      for (const bracket of stage.brackets) {
        for (const m of bracket.rounds.flat()) {
          if (isTeamSlotName(m.team1Name) || isTeamSlotName(m.team2Name)) continue;
          // Prefer the match's actual bracket round ("WB Round 1", "Grand
          // Final") over the generic stage name; round robin keeps the latter.
          out.push({ match: m, stage: bracketRoundLabel(bracket, m) ?? stage.label, status: effectiveStatus(m) });
        }
      }
    }
    return out;
  }, [stages]);

  const tournamentNews = useMemo(
    () => news.filter(n => n.visible && n.tournamentId === id),
    [news, id],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text animate-pulse">Loading tournament…</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text">Tournament not found.</p>
          <button onClick={() => navigate('/tournaments')} className="arena-md__back" style={{ margin: '0 auto' }}>
            <ChevronLeft className="w-4 h-4" /> Back to Tournaments
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  const ev = tournament.event;
  const prizePool = ev?.prizePool;
  const prizePlaces = (prizePool?.places ?? []).slice().sort((a, b) => a.position - b.position);
  const hasPrizePool = !!prizePool && (prizePlaces.length > 0 || !!prizePool.total);

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'matches', label: 'Matches', count: matches.length },
    { key: 'bracket', label: 'Bracket' },
    { key: 'standings', label: 'Standings' },
    { key: 'teams', label: 'Teams', count: tournament.teams.length },
    { key: 'news', label: 'News', count: tournamentNews.length },
  ];

  const statusLabel = deriveTournamentStatus(tournament);

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-md">
        {/* Back */}
        <button onClick={() => navigate('/tournaments')} className="arena-md__back">
          <ChevronLeft className="w-4 h-4" />
          Back to Tournaments
        </button>

        {/* Event hero */}
        <div className={`arena-tp-hero${tournament.coverImage ? ' arena-tp-hero--cover' : ''}`}>
          <button
            type="button"
            onClick={handleShare}
            className={`arena-tp-share${copied ? ' arena-tp-share--copied' : ''}`}
            title="Copy tournament link"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Share'}
          </button>
          {tournament.coverImage && (
            <div className="arena-tp-hero__cover">
              <img src={tournament.coverImage} alt={tournament.name} />
              <div className="arena-tp-hero__cover-wash" />
            </div>
          )}
          <div className="arena-tp-hero__body">
            <span className="arena-tp-hero__crest">
              <Trophy className="w-6 h-6" />
            </span>
            <div className="arena-tp-hero__id">
              <p className="arena-md-section__eyebrow" style={{ margin: '0 0 0.4rem' }}>Tournament</p>
              <h1 className="arena-tp-hero__name">{tournament.name}</h1>
              {tournament.overview && <p className="arena-tp-hero__overview">{tournament.overview}</p>}
              <div className="arena-tp-hero__meta">
                {ev?.startDate && (
                  <span><Calendar className="w-3.5 h-3.5" />{new Date(ev.startDate).toLocaleDateString()}</span>
                )}
                {ev?.location && (
                  <span><MapPin className="w-3.5 h-3.5" />{ev.location}</span>
                )}
                {ev?.type && (
                  <span className="arena-tp-hero__meta-type"><span className="arena-tp-hero__dot" />{ev.type}</span>
                )}
                {prizePool?.total && (
                  <span className="arena-tp-hero__meta-prize"><Trophy className="w-3.5 h-3.5" />{formatPrize(prizePool.total, prizePool.currency)}</span>
                )}
                <span className={`arena-tp-status ${STATUS_META[statusLabel]?.className ?? 'arena-tp-status--planning'}`}>
                  <span className="arena-tp-status__dot" />
                  {STATUS_META[statusLabel]?.label ?? statusLabel}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="arena-tp-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`arena-tp-tab${tab === t.key ? ' arena-tp-tab--active' : ''}`}
            >
              {t.label}
              {t.count !== undefined && <span className="arena-tp-tab__count">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="arena-tp-content">
          {tab === 'overview' && (
            <Overview
              tournament={tournament}
              hasPrizePool={hasPrizePool}
              prizePool={prizePool}
              prizePlaces={prizePlaces}
              recentMatches={matches.filter(m => m.status === 'completed').slice(-5).reverse()}
              upcomingMatches={matches.filter(m => m.status !== 'completed').slice(0, 5)}
              onMatch={mid => navigate(`/tournament-match/${mid}`)}
            />
          )}

          {tab === 'matches' && (
            <MatchesList matches={matches} onMatch={mid => navigate(`/tournament-match/${mid}`)} />
          )}

          {tab === 'bracket' && (
            <BracketTab tournament={tournament} stages={stages} />
          )}

          {tab === 'standings' && (
            <StandingsTab tournament={tournament} matches={matches} />
          )}

          {tab === 'teams' && (
            tournament.teams.length === 0 ? (
              <div className="arena-stats-empty">
                <p className="arena-stats-empty__title">No teams added</p>
                <p className="arena-stats-empty__sub">Teams will appear here once they're registered.</p>
              </div>
            ) : (
              <div className="arena-tp-teams">
                {tournament.teams.map(team => {
                  const form = teamForm(matches, team.id);
                  return (
                  <div key={team.id} className="arena-tp-team">
                    <Link to={`/teams/${team.id}`} className="arena-tp-team__head">
                      <span className="arena-tp-team__crest">
                        {team.logo
                          ? <img src={team.logo} alt={team.name} />
                          : <span className="arena-tp-team__crest-text">{team.name.substring(0, 2).toUpperCase()}</span>}
                      </span>
                      <span className="arena-tp-team__name">{team.name}</span>
                      {form.length > 0 && (
                        <span className="arena-tp-team__form">
                          {form.map((f, i) => (
                            <span
                              key={i}
                              className={`arena-tp-team__form-dot${f.won ? ' arena-tp-team__form-dot--w' : ''}`}
                              title={`${f.won ? 'Won' : 'Lost'} vs ${f.opponent}`}
                            >
                              {f.won ? 'W' : 'L'}
                            </span>
                          ))}
                        </span>
                      )}
                      {team.players.length > 0 && (
                        <span className="arena-tp-team__count">{Math.min(team.players.length, 5)}</span>
                      )}
                    </Link>
                    <div className="arena-tp-team__players">
                      {orderRosterIglFirst(team.players).slice(0, 5).map(p => (
                        <Link key={p.id} to={`/player/${tournament.id}/${p.id}`} className="arena-tp-team__player">
                          <span className="arena-tp-team__player-name">{p.name || 'TBD'}</span>
                          {p.role === 'igl' && <span className="arena-tp-team__igl">IGL</span>}
                        </Link>
                      ))}
                      {team.players.length === 0 && <p className="arena-tp-team__empty">No players listed</p>}
                    </div>
                  </div>
                  );
                })}
              </div>
            )
          )}

          {tab === 'news' && (
            tournamentNews.length === 0 ? (
              <div className="arena-stats-empty">
                <Newspaper className="w-10 h-10 arena-stats-empty__icon" />
                <p className="arena-stats-empty__title">No news yet</p>
                <p className="arena-stats-empty__sub">No articles are linked to this tournament.</p>
              </div>
            ) : (
              <div className="arena-tp-news">
                {tournamentNews.map(n => (
                  <Link
                    key={n.id}
                    to={n.link ? n.link : `/news/${n.id}`}
                    target={n.link ? '_blank' : undefined}
                    className="arena-tp-news__row"
                  >
                    {n.imageUrl ? (
                      <img src={n.imageUrl} alt={n.title} className="arena-tp-news__thumb" />
                    ) : (
                      <span className="arena-tp-news__thumb arena-tp-news__thumb--empty">
                        <Newspaper className="w-5 h-5" />
                      </span>
                    )}
                    <div className="arena-tp-news__info">
                      {n.category && <span className="arena-tp-news__cat">{n.category}</span>}
                      <h3 className="arena-tp-news__title">{n.title}</h3>
                      {n.timeAgo && <span className="arena-tp-news__time"><Clock className="w-3 h-3" />{n.timeAgo}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function Overview({ tournament, hasPrizePool, prizePool, prizePlaces, recentMatches, upcomingMatches, onMatch }: {
  tournament: Tournament;
  hasPrizePool: boolean;
  prizePool?: PrizePool;
  prizePlaces: { position: number; prize: string }[];
  recentMatches: { match: BracketMatch; stage: string; status: string }[];
  upcomingMatches: { match: BracketMatch; stage: string; status: string }[];
  onMatch: (id: string) => void;
}) {
  const ev = tournament.event;
  const totalSlots = ev?.maxTeams || tournament.teams.length;
  const registered = tournament.teams.length;
  const available = Math.max(0, totalSlots - registered);
  const fillPct = totalSlots > 0 ? Math.min(100, (registered / totalSlots) * 100) : 0;
  const result = deriveTournamentStatus(tournament) === 'completed' ? deriveChampion(tournament) : null;
  const mvp = result ? deriveMvp(tournament) : null;
  const leaders = deriveLeaders(tournament);
  const progress = deriveStageProgress(tournament);
  return (
    <>
    {/* Champion banner — only once the tournament is decided */}
    {result && (
      <div className="arena-tp-champ">
        <div className="arena-tp-champ__glow" />
        <Trophy className="arena-tp-champ__trophy" />
        <div className="arena-tp-champ__info">
          <p className="arena-tp-champ__eyebrow">Champion</p>
          {result.champion.id ? (
            <Link to={`/teams/${result.champion.id}`} className="arena-tp-champ__name arena-tp-champ__name--link">
              {result.champion.logo && <img src={result.champion.logo} alt="" className="arena-tp-champ__logo" />}
              {result.champion.name}
            </Link>
          ) : (
            <p className="arena-tp-champ__name">{result.champion.name}</p>
          )}
          {result.runnerUp && (
            <p className="arena-tp-champ__runner">
              Runner-up&nbsp;·&nbsp;
              {result.runnerUp.id
                ? <Link to={`/teams/${result.runnerUp.id}`} className="arena-tp-champ__runner-link">{result.runnerUp.name}</Link>
                : result.runnerUp.name}
            </p>
          )}
        </div>
        {mvp && (
          <Link to={`/player/${tournament.id}/${mvp.rosterId}`} className="arena-tp-champ__mvp">
            <p className="arena-tp-champ__mvp-label">Tournament MVP</p>
            <p className="arena-tp-champ__mvp-name">{mvp.name}</p>
            <p className="arena-tp-champ__mvp-sub">
              {mvp.kills} kills{mvp.teamName ? ` · ${mvp.teamName}` : ''}
            </p>
          </Link>
        )}
      </div>
    )}
    <div className="arena-tp-overview">
      <div className="arena-tp-overview__main">
        {/* Team slots */}
        <div className="arena-tp-card">
          <h3 className="arena-tp-card__title"><Users className="w-4 h-4" /> Team Slots</h3>
          <div className="arena-tp-slots">
            <div className="arena-tp-slots__cell">
              <p className="arena-tp-slots__label">Total</p>
              <p className="arena-tp-slots__value">{totalSlots}</p>
            </div>
            <div className="arena-tp-slots__cell">
              <p className="arena-tp-slots__label">Registered</p>
              <p className="arena-tp-slots__value arena-tp-slots__value--accent">{registered}</p>
            </div>
            <div className="arena-tp-slots__cell">
              <p className="arena-tp-slots__label">Available</p>
              <p className="arena-tp-slots__value arena-tp-slots__value--blue">{available}</p>
            </div>
          </div>
          <div className="arena-tp-slots__bar" title={`${registered} of ${totalSlots} slots filled`}>
            <div className="arena-tp-slots__bar-fill" style={{ width: `${fillPct}%` }} />
          </div>
        </div>

        {/* Stage progress stepper */}
        {progress.length > 0 && (
          <div className="arena-tp-progress">
            {progress.map((step, i) => (
              <div key={i} className={`arena-tp-progress__step${step.done ? ' arena-tp-progress__step--done' : ''}`}>
                <span className="arena-tp-progress__node">
                  {step.done ? <Check className="w-3 h-3" /> : null}
                </span>
                <span className="arena-tp-progress__label">{step.label}</span>
                {i < progress.length - 1 && <span className="arena-tp-progress__rule" />}
              </div>
            ))}
          </div>
        )}

        {/* Upcoming + recent */}
        {(upcomingMatches.length > 0 || recentMatches.length > 0) && (
          <div className="arena-tp-overview__minis">
            <MatchMini title="Upcoming" items={upcomingMatches} onMatch={onMatch} countdown />
            <MatchMini title="Recent Results" items={recentMatches} onMatch={onMatch} />
          </div>
        )}
      </div>

      {/* Right column: prize pool + event leaders */}
      <div className="arena-tp-overview__side">
      <div className="arena-tp-card">
        <h3 className="arena-tp-card__title"><DollarSign className="w-4 h-4" /> Prize Pool</h3>
        {hasPrizePool ? (
          <div className="arena-tp-prize">
            {prizePool?.total && (
              <div className="arena-tp-prize__featured">
                <p className="arena-tp-prize__featured-label">Total Prize Pool</p>
                <p className="arena-tp-prize__featured-value">{formatPrize(prizePool.total, prizePool.currency)}</p>
              </div>
            )}
            {prizePlaces.map((p, i) => {
              // Once decided, name the podium: champion takes 1st, runner-up 2nd.
              const podiumTeam =
                p.position === 1 ? result?.champion.name
                : p.position === 2 ? result?.runnerUp?.name
                : undefined;
              return (
                <div key={p.position} className="arena-tp-prize__row">
                  <span className="arena-tp-prize__place">
                    <span className="arena-tp-prize__medal" style={{ color: PLACE_COLORS[i] || '#717182', borderColor: 'currentColor' }}>
                      {p.position}
                    </span>
                    <span className="arena-tp-prize__place-text">
                      <span className="arena-tp-prize__label">{ordinal(p.position)} Place</span>
                      {podiumTeam && <span className="arena-tp-prize__team">{podiumTeam}</span>}
                    </span>
                  </span>
                  <span className="arena-tp-prize__value" style={{ color: PLACE_COLORS[i] || '#e5e7eb' }}>{formatPrize(p.prize, prizePool?.currency)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="arena-tp-card__empty">No prize pool set.</p>
        )}
      </div>

      {/* Event leaders — top player per stat category */}
      {leaders.length > 0 && (
        <div className="arena-tp-card">
          <h3 className="arena-tp-card__title"><BarChart3 className="w-4 h-4" /> Event Leaders</h3>
          <div className="arena-tp-leaders">
            {leaders.map(l => (
              <Link
                key={l.label}
                to={`/player/${tournament.id}/${l.player.rosterId}`}
                className="arena-tp-leaders__row"
              >
                <span className="arena-tp-leaders__cat">{l.label}</span>
                <span className="arena-tp-leaders__who">
                  <span className="arena-tp-leaders__name">{l.player.name}</span>
                  {l.player.teamName && <span className="arena-tp-leaders__team">{l.player.teamName}</span>}
                </span>
                <span className="arena-tp-leaders__value">{l.value}</span>
              </Link>
            ))}
          </div>
          <Link to={`/stats?tournament=${tournament.id}`} className="arena-tp-leaders__all">
            Full stats <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
      </div>
    </div>
    </>
  );
}

// "2d 4h" / "3h 12m" / "45m" until a future timestamp.
function formatCountdown(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function MatchMini({ title, items, onMatch, countdown = false }: {
  title: string;
  items: { match: BracketMatch; stage: string; status: string }[];
  onMatch: (id: string) => void;
  countdown?: boolean;
}) {
  // Re-render every 30s so the countdown chip stays current while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!countdown) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [countdown]);

  // Earliest future-scheduled match among the listed ones.
  let nextStart: number | null = null;
  if (countdown) {
    for (const { match: m } of items) {
      if (!m.date) continue;
      const t = new Date(`${m.date}T${m.time || '00:00'}`).getTime();
      if (isNaN(t) || t <= now) continue;
      if (nextStart === null || t < nextStart) nextStart = t;
    }
  }

  return (
    <div className="arena-tp-card">
      <p className="arena-tp-mini__title">
        {title}
        {nextStart !== null && (
          <span className="arena-tp-mini__countdown">
            <Clock className="w-3 h-3" />
            in {formatCountdown(nextStart - now)}
          </span>
        )}
      </p>
      {items.length === 0 ? (
        <p className="arena-tp-card__empty">Nothing yet.</p>
      ) : (
        <div className="arena-tp-mini__list">
          {items.map(({ match: m, status }) => {
            const done = status === 'completed';
            const { s1, s2 } = deriveScore(m);
            const w1 = done && s1 > s2;
            const w2 = done && s2 > s1;
            return (
              <button key={m.id} onClick={() => onMatch(m.id)} className="arena-tp-mini__row">
                <span className={`arena-tp-mini__team${w1 ? ' arena-tp-mini__team--win' : ''}${done && !w1 ? ' arena-tp-mini__team--loss' : ''}`}>
                  {m.team1Name}
                </span>
                {done ? (
                  <span className="arena-tp-mini__score">
                    <span className={w1 ? 'arena-tp-mini__score-win' : ''}>{s1}</span>
                    <span className="arena-tp-mini__score-sep">:</span>
                    <span className={w2 ? 'arena-tp-mini__score-win' : ''}>{s2}</span>
                  </span>
                ) : (
                  <span className="arena-tp-mini__vs">vs</span>
                )}
                <span className={`arena-tp-mini__team arena-tp-mini__team--right${w2 ? ' arena-tp-mini__team--win' : ''}${done && !w2 ? ' arena-tp-mini__team--loss' : ''}`}>
                  {m.team2Name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Matches tab ──────────────────────────────────────────────────────────────
function MatchesList({ matches, onMatch }: {
  matches: { match: BracketMatch; stage: string; status: 'upcoming' | 'live' | 'completed' }[];
  onMatch: (id: string) => void;
}) {
  // One match at a time can be expanded to show its per-map scores inline.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const groups: { key: string; label: string }[] = [
    { key: 'live', label: 'Live' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
  ];
  if (matches.length === 0) {
    return (
      <div className="arena-stats-empty">
        <p className="arena-stats-empty__title">No matches yet</p>
        <p className="arena-stats-empty__sub">Matches appear here once the bracket is set.</p>
      </div>
    );
  }

  return (
    <div className="arena-tp-matches">
      {groups.map(g => {
        const items = matches.filter(m => m.status === g.key).slice().reverse();
        if (items.length === 0) return null;
        return (
          <div key={g.key} className="arena-tp-matchgroup">
            <div className="arena-match-divider">
              {g.key === 'live' && <span className="arena-match-card__badge-dot" style={{ color: 'var(--arena-accent)' }} />}
              <p className={`arena-match-divider__label${g.key === 'live' ? ' arena-match-divider__label--live' : ''}`}>{g.label}</p>
              <span className="arena-match-divider__rule" />
              <p className="arena-match-divider__label">{items.length}</p>
            </div>
            <div className="arena-tp-matchlist">
              {items.map(({ match: m, stage, status }) => {
                const dateText = m.date
                  ? `${new Date(`${m.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${m.time ? ` · ${m.time}` : ''}`
                  : '';
                const done = status === 'completed';
                const { s1, s2 } = deriveScore(m);
                const w1 = done && s1 > s2;
                const w2 = done && s2 > s1;
                const maps = (m.maps ?? []).filter(map => map.team1Score > 0 || map.team2Score > 0);
                const expandable = done && maps.length > 0;
                const expanded = expandedId === m.id;
                return (
                  <div key={m.id} className="arena-tp-matchwrap">
                    <button onClick={() => onMatch(m.id)} className="arena-tp-matchrow">
                      <span className="arena-tp-matchrow__teams">
                        <span className={`arena-tp-matchrow__team${w1 ? ' arena-tp-matchrow__team--win' : ''}${done && !w1 ? ' arena-tp-matchrow__team--loss' : ''}`}>
                          {m.team1Name}
                        </span>
                        {done ? (
                          <span className="arena-tp-matchrow__score">
                            <span className={w1 ? 'arena-tp-matchrow__score-win' : ''}>{s1}</span>
                            <span className="arena-tp-matchrow__score-sep">:</span>
                            <span className={w2 ? 'arena-tp-matchrow__score-win' : ''}>{s2}</span>
                          </span>
                        ) : (
                          <span className="arena-tp-matchrow__vs">vs</span>
                        )}
                        <span className={`arena-tp-matchrow__team arena-tp-matchrow__team--right${w2 ? ' arena-tp-matchrow__team--win' : ''}${done && !w2 ? ' arena-tp-matchrow__team--loss' : ''}`}>
                          {m.team2Name}
                        </span>
                      </span>
                      <span className="arena-tp-matchrow__meta">
                        <span className="arena-tp-matchrow__stage">{stage}</span>
                        {dateText && <span className="arena-tp-matchrow__date">{dateText}</span>}
                        {expandable && (
                          <span
                            role="button"
                            tabIndex={0}
                            className={`arena-tp-matchrow__expand${expanded ? ' arena-tp-matchrow__expand--open' : ''}`}
                            title={expanded ? 'Hide map scores' : 'Show map scores'}
                            onClick={e => { e.stopPropagation(); setExpandedId(expanded ? null : m.id); }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                setExpandedId(expanded ? null : m.id);
                              }
                            }}
                          >
                            <ChevronDown className="w-4 h-4" />
                          </span>
                        )}
                      </span>
                    </button>
                    {expandable && expanded && (
                      <div className="arena-tp-mapscores">
                        {maps.map((map, mi) => {
                          const m1 = map.team1Score > map.team2Score;
                          const m2 = map.team2Score > map.team1Score;
                          const splash = mapImageUrl(map.mapName);
                          return (
                            <div
                              key={mi}
                              className="arena-tp-mapscores__row"
                              style={splash ? {
                                backgroundImage: `linear-gradient(90deg, rgba(10,10,10,0.94) 0%, rgba(10,10,10,0.72) 45%, rgba(10,10,10,0.9) 100%), url(${splash})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center 35%',
                              } : undefined}
                            >
                              <span className="arena-tp-mapscores__map">{map.mapName || `Map ${mi + 1}`}</span>
                              <span className="arena-tp-mapscores__score">
                                <span className={m1 ? 'arena-tp-mapscores__win' : ''}>{map.team1Score}</span>
                                <span className="arena-tp-mapscores__sep">–</span>
                                <span className={m2 ? 'arena-tp-mapscores__win' : ''}>{map.team2Score}</span>
                              </span>
                              <span className="arena-tp-mapscores__taker">
                                {m1 ? m.team1Name : m2 ? m.team2Name : 'Tied'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Standings tab ────────────────────────────────────────────────────────────
function StandingsTab({ tournament, matches }: {
  tournament: Tournament;
  matches: { match: BracketMatch; stage: string; status: 'upcoming' | 'live' | 'completed' }[];
}) {
  const navigate = useNavigate();
  const isCompleted = deriveTournamentStatus(tournament) === 'completed';

  const rows = useMemo(() => {
    const completed = matches.filter(m => m.status === 'completed');
    const built = tournament.teams.map(team => {
      let seriesW = 0, seriesL = 0, mapsW = 0, mapsL = 0;
      for (const { match: m } of completed) {
        const isT1 = m.team1Id === team.id;
        const isT2 = m.team2Id === team.id;
        if (!isT1 && !isT2) continue;
        const { s1, s2 } = deriveScore(m);
        const mine = isT1 ? s1 : s2;
        const theirs = isT1 ? s2 : s1;
        mapsW += mine;
        mapsL += theirs;
        if (mine > theirs) seriesW++;
        else if (theirs > mine) seriesL++;
      }
      const placement = isCompleted ? computePlacement(tournament, team.id) : null;
      return {
        team,
        seriesW, seriesL, mapsW, mapsL,
        diff: mapsW - mapsL,
        played: seriesW + seriesL,
        placement,
      };
    });
    // Completed: rank by final placement, ties broken by record.
    // In progress: rank by series wins, then map diff, then map wins.
    built.sort((a, b) =>
      placementRank(a.placement) - placementRank(b.placement)
      || b.seriesW - a.seriesW
      || b.diff - a.diff
      || b.mapsW - a.mapsW
      || a.team.name.localeCompare(b.team.name)
    );
    return built;
  }, [tournament, matches, isCompleted]);

  if (rows.length === 0 || rows.every(r => r.played === 0)) {
    return (
      <div className="arena-stats-empty">
        <p className="arena-stats-empty__title">No results yet</p>
        <p className="arena-stats-empty__sub">Standings appear once matches are completed.</p>
      </div>
    );
  }

  return (
    <div className="arena-md-table-card">
      <div className="arena-md-table-wrap">
        <table className="arena-md-table arena-tp-standings">
          <thead>
            <tr>
              <th className="arena-md-table__left arena-tp-standings__rank-h">#</th>
              <th className="arena-md-table__left">Team</th>
              <th>Series</th>
              <th>Maps</th>
              <th>+/−</th>
              {isCompleted && <th>Place</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.team.id}
                onClick={() => navigate(`/teams/${r.team.id}`)}
                className={`arena-tp-standings__row${i % 2 === 0 ? ' arena-md-table__alt' : ''}`}
              >
                <td className="arena-md-table__left">
                  <span
                    className={`arena-tp-standings__rank${i < 3 && isCompleted ? ' arena-tp-standings__rank--podium' : ''}`}
                    style={i < 3 && isCompleted ? { color: PLACE_COLORS[i], borderColor: 'currentColor' } : undefined}
                  >
                    {i + 1}
                  </span>
                </td>
                <td className="arena-md-table__left">
                  <span className="arena-tp-standings__team">
                    <span className="arena-tp-standings__crest">
                      {r.team.logo
                        ? <img src={r.team.logo} alt="" />
                        : <span>{r.team.name.substring(0, 2).toUpperCase()}</span>}
                    </span>
                    <span className="arena-tp-standings__name">{r.team.name}</span>
                  </span>
                </td>
                <td>
                  <span className="arena-tp-standings__wl">
                    <span className="arena-tp-standings__w">{r.seriesW}</span>
                    <span className="arena-tp-standings__wl-sep">–</span>
                    <span className="arena-tp-standings__l">{r.seriesL}</span>
                  </span>
                </td>
                <td className="arena-md-table__dim">{r.mapsW}–{r.mapsL}</td>
                <td className={r.diff > 0 ? 'arena-tp-standings__diff-pos' : r.diff < 0 ? 'arena-tp-standings__diff-neg' : 'arena-md-table__dim'}>
                  {r.diff > 0 ? `+${r.diff}` : r.diff}
                </td>
                {isCompleted && (
                  <td className="arena-md-table__dim">{r.placement ?? '—'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Bracket tab ──────────────────────────────────────────────────────────────
function BracketTab({ tournament, stages }: {
  tournament: Tournament;
  stages: { id: string; label: string; brackets: BracketGenerated[] }[];
}) {
  const bracketStages = stages.filter(s => s.brackets.length > 0);

  // Show the latest stage first: Stage 2 (knockout) leads when its bracket exists.
  const orderedStages = [...bracketStages].sort((a, b) => {
    const rank = (id: string) => (id === 'stage2' ? 0 : id === 'stage1' ? 1 : 2);
    return rank(a.id) - rank(b.id);
  });

  // Default the dropdown to the first (latest) stage.
  const [selectedId, setSelectedId] = useState<string>(orderedStages[0]?.id ?? '');

  if (bracketStages.length === 0) {
    return (
      <div className="arena-stats-empty">
        <p className="arena-stats-empty__title">No bracket yet</p>
        <p className="arena-stats-empty__sub">No bracket has been generated for this tournament.</p>
      </div>
    );
  }

  const active = orderedStages.find(s => s.id === selectedId) ?? orderedStages[0];

  return (
    <div className="arena-tp-bracket">
      <div className="arena-tp-bracket__head">
        <h3 className="arena-tp-bracket__stage">{active.label}</h3>
        {/* Stage selector — only when more than one stage has a bracket */}
        {orderedStages.length > 1 && (
          <div className="arena-stats-select" style={{ minWidth: '12rem' }}>
            <select value={active.id} onChange={e => setSelectedId(e.target.value)}>
              {orderedStages.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 arena-stats-select__chevron" />
          </div>
        )}
      </div>
      {active.brackets.map((bracket, i) => (
        <BracketDisplay
          key={i}
          bracket={bracket}
          teams={tournament.teams}
          editable={false}
          onBracketChange={() => {}}
        />
      ))}
    </div>
  );
}
