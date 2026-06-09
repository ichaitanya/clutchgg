import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, Trophy, Users, Calendar, MapPin, DollarSign, Newspaper, Clock,
} from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { Tournament, BracketGenerated, BracketMatch, PrizePool } from './TournamentCreation';
import { formatPrize } from './TournamentCreation';
import type { NewsItem } from './AdminPanel';
import { getTournaments, getNews, loadWithRetryPolled } from '../services/db';
import { getStageOptions } from './StatsPage';
import { BracketDisplay } from './BracketDisplay';
import { deriveTournamentStatus } from '../utils/tournamentStatus';
import { orderRosterIglFirst } from '../utils/roster';

type TabKey = 'overview' | 'matches' | 'bracket' | 'teams' | 'news';

const PLACE_COLORS = ['#4ade80', '#60a5fa', '#f59e0b'];

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
  // Initial tab can be deep-linked via the URL hash (e.g. /tournament/x#bracket).
  // Falls back to Overview for any missing/unknown hash.
  const [tab, setTab] = useState<TabKey>(() => {
    const hash = window.location.hash.replace('#', '') as TabKey;
    return (['overview', 'matches', 'bracket', 'teams', 'news'] as TabKey[]).includes(hash) ? hash : 'overview';
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
          out.push({ match: m, stage: stage.label, status: effectiveStatus(m) });
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
                <span className="arena-tp-hero__status">{statusLabel}</span>
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

          {tab === 'teams' && (
            tournament.teams.length === 0 ? (
              <div className="arena-stats-empty">
                <p className="arena-stats-empty__title">No teams added</p>
                <p className="arena-stats-empty__sub">Teams will appear here once they're registered.</p>
              </div>
            ) : (
              <div className="arena-tp-teams">
                {tournament.teams.map(team => (
                  <div key={team.id} className="arena-tp-team">
                    <Link to={`/teams/${team.id}`} className="arena-tp-team__head">
                      <span className="arena-tp-team__crest">
                        {team.logo
                          ? <img src={team.logo} alt={team.name} />
                          : <span className="arena-tp-team__crest-text">{team.name.substring(0, 2).toUpperCase()}</span>}
                      </span>
                      <span className="arena-tp-team__name">{team.name}</span>
                    </Link>
                    <div className="arena-tp-team__players">
                      {orderRosterIglFirst(team.players).slice(0, 5).map(p => (
                        <Link key={p.id} to={`/player/${tournament.id}/${p.id}`} className="arena-tp-team__player">
                          {p.name || 'TBD'}
                        </Link>
                      ))}
                      {team.players.length === 0 && <p className="arena-tp-team__empty">No players listed</p>}
                    </div>
                  </div>
                ))}
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
  return (
    <div className="arena-tp-overview">
      <div className="arena-tp-overview__main">
        {/* Team slots */}
        <div className="arena-tp-card">
          <h3 className="arena-tp-card__title"><Users className="w-4 h-4" /> Team Slots</h3>
          <div className="arena-tp-slots">
            <div>
              <p className="arena-tp-slots__label">Total</p>
              <p className="arena-tp-slots__value">{ev?.maxTeams || tournament.teams.length}</p>
            </div>
            <div>
              <p className="arena-tp-slots__label">Registered</p>
              <p className="arena-tp-slots__value arena-tp-slots__value--accent">{tournament.teams.length}</p>
            </div>
            <div>
              <p className="arena-tp-slots__label">Available</p>
              <p className="arena-tp-slots__value arena-tp-slots__value--blue">{Math.max(0, (ev?.maxTeams || tournament.teams.length) - tournament.teams.length)}</p>
            </div>
          </div>
        </div>

        {/* Upcoming + recent */}
        {(upcomingMatches.length > 0 || recentMatches.length > 0) && (
          <div className="arena-tp-overview__minis">
            <MatchMini title="Upcoming" items={upcomingMatches} onMatch={onMatch} />
            <MatchMini title="Recent Results" items={recentMatches} onMatch={onMatch} />
          </div>
        )}
      </div>

      {/* Prize pool */}
      <div className="arena-tp-card arena-tp-card--fit">
        <h3 className="arena-tp-card__title"><DollarSign className="w-4 h-4" /> Prize Pool</h3>
        {hasPrizePool ? (
          <div className="arena-tp-prize">
            {prizePool?.total && (
              <div className="arena-tp-prize__row">
                <span className="arena-tp-prize__label">Total</span>
                <span className="arena-tp-prize__total">{formatPrize(prizePool.total, prizePool.currency)}</span>
              </div>
            )}
            {prizePlaces.map((p, i) => (
              <div key={p.position} className="arena-tp-prize__row">
                <span className="arena-tp-prize__label">{ordinal(p.position)} Place</span>
                <span className="arena-tp-prize__value" style={{ color: PLACE_COLORS[i] || '#e5e7eb' }}>{formatPrize(p.prize, prizePool?.currency)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="arena-tp-card__empty">No prize pool set.</p>
        )}
      </div>
    </div>
  );
}

function MatchMini({ title, items, onMatch }: {
  title: string;
  items: { match: BracketMatch; stage: string; status: string }[];
  onMatch: (id: string) => void;
}) {
  return (
    <div className="arena-tp-card">
      <p className="arena-tp-mini__title">{title}</p>
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
                return (
                  <button key={m.id} onClick={() => onMatch(m.id)} className="arena-tp-matchrow">
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
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
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
