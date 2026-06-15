import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft, ChevronDown, Trophy, Shield, BadgeCheck,
  Share2, Check, Medal, Crown, Flame, Crosshair, Swords, Target,
  Link2, Download, X, Sparkles, type LucideIcon,
} from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { useClaim, ClaimControls, ClaimedProfileBlock } from './ClaimProfile';
import { useAuth } from '../context/AuthContext';
import { findMyPlayerProfiles, startClaimReauth } from '../services/supabase';
import type {
  Tournament,
  TeamInTournament,
  TournamentPlayer,
  MatchPlayerStat,
  PlayerAlias,
} from './TournamentCreation';
import { getStageOptions, statMatchesPlayer } from './StatsPage';
import { computePlacement } from './TeamsPage';
import { getTournaments, loadWithRetry } from '../services/db';
import { agentIconUrl, mapImageUrl } from '../utils/valorantAssets';
import { bracketRoundLabel } from '../utils/bracketRounds';
import { deriveTournamentStatus } from '../utils/tournamentStatus';
import { normalizeRiotId, normalizeRiotName } from '../utils/riotId';

// Whether two roster entries are the SAME person across tournaments/teams.
// Riot ID is the primary key (it survives team changes — TsWaGg#6969 is the
// same player whether on Auros Gaming or APEX HAVOC), checked against each
// player's current riotId and any historical alias riotId. When neither side
// has a Riot ID we fall back to an exact (normalized) name match, preserving the
// pre-Riot-ID behaviour for players who were only ever entered by name.
function samePlayerIdentity(a: TournamentPlayer, b: TournamentPlayer): boolean {
  if (a.id === b.id) return true;

  const riotIds = (p: TournamentPlayer): string[] => {
    const out: string[] = [];
    if (p.riotId) out.push(normalizeRiotId(p.riotId));
    for (const al of p.nameHistory ?? []) if (al.riotId) out.push(normalizeRiotId(al.riotId));
    return out.filter(Boolean);
  };
  const aIds = riotIds(a);
  const bIds = riotIds(b);
  if (aIds.length && bIds.length) {
    return aIds.some(id => bIds.includes(id));
  }

  // Name fallback (only when at least one side has no Riot ID to key on).
  const names = (p: TournamentPlayer): string[] => {
    const out = [normalizeRiotName(p.name)];
    for (const al of p.nameHistory ?? []) if (al.name) out.push(normalizeRiotName(al.name));
    return out.filter(Boolean);
  };
  const aNames = names(a);
  const bNames = names(b);
  return aNames.some(n => bNames.includes(n));
}

// Render an agent name with its official icon (falls back to a 2-letter chip).
function AgentTag({ agent }: { agent?: string }) {
  if (!agent) return <span className="arena-md-table__dim">—</span>;
  return (
    <span className="arena-pp-agents">
      {agent.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => {
        const url = agentIconUrl(a);
        return (
          <span key={i} className="arena-pp-agent" title={a}>
            {url
              ? <img src={url} alt={a} className="arena-pp-agent__icon" />
              : <span className="arena-pp-agent__fallback">{a.slice(0, 2).toUpperCase()}</span>}
            <span className="arena-pp-agent__name">{a}</span>
          </span>
        );
      })}
    </span>
  );
}

// One played map's stat line for this player, tagged with where it happened.
interface PlayerMapStat extends MatchPlayerStat {
  matchId: string;
  stageLabel: string;
  opponentName: string;
  mapName: string;
  date?: string;
  won?: boolean; // this map's result for the player's team (undefined on ties)
  myScore: number;   // map score, oriented to the player's team
  oppScore: number;
  tournamentId: string;
  tournamentName: string;
}

// Role badge color (text + background) tuned for the dark editorial surface.
function getRoleStyle(role?: string): { color: string; background: string } {
  switch (role) {
    case 'igl': return { color: '#facc15', background: 'rgba(250,204,21,0.1)' };
    case 'duelist': return { color: '#f87171', background: 'rgba(248,113,113,0.1)' };
    case 'controller': return { color: '#60a5fa', background: 'rgba(96,165,250,0.1)' };
    case 'sentinel': return { color: '#4ade80', background: 'rgba(74,222,128,0.1)' };
    case 'initiator': return { color: '#c084fc', background: 'rgba(192,132,252,0.1)' };
    default: return { color: '#9ca3af', background: 'rgba(156,163,175,0.1)' };
  }
}

// Two uppercase initials of a player name, for the photo fallback.
function playerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().substring(0, 2).toUpperCase();
}

// Find the player + their team within a tournament.
function findPlayer(
  tournament: Tournament,
  playerId: string,
): { player: TournamentPlayer; team: TeamInTournament } | null {
  for (const team of tournament.teams) {
    const player = team.players.find(p => p.id === playerId);
    if (player) return { player, team };
  }
  return null;
}

// Collect every played-map stat line for this player across the tournament,
// tagged with stage / opponent / map for the match-history table.
function collectPlayerMapStats(
  tournament: Tournament,
  player: TournamentPlayer,
  teamId: string,
): PlayerMapStat[] {
  const teamNameById: Record<string, string> = {};
  tournament.teams.forEach(t => { teamNameById[t.id] = t.name; });

  const out: PlayerMapStat[] = [];
  // Deduplicate by matchId+mapName so the same map doesn't appear twice when
  // the same match data is stored across multiple tournament copies.
  const seen = new Set<string>();
  for (const stage of getStageOptions(tournament)) {
    for (const bracket of stage.brackets) {
      for (const match of bracket.rounds.flat()) {
        // Opponent = whichever side isn't this player's team.
        const opponentId = match.team1Id === teamId ? match.team2Id : match.team1Id;
        const opponentName =
          match.team1Id === teamId ? match.team2Name : match.team1Name;
        for (const map of match.maps ?? []) {
          const s = (map.playerStats ?? []).find(ps => statMatchesPlayer(ps, player));
          if (!s) continue;
          // Deduplicate by matchId + mapName: the same match stored across
          // multiple tournament copies shares the same matchId so this collapses it.
          const key = `${match.id}|${map.mapName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const isT1 = match.team1Id === teamId;
          out.push({
            ...s,
            matchId: match.id,
            // Actual bracket round ("WB Round 1", "Grand Final") when derivable;
            // generic stage/group label otherwise (round robin, groups).
            stageLabel: bracketRoundLabel(bracket, match) ?? stage.label,
            opponentName: opponentName || teamNameById[opponentId] || 'TBD',
            mapName: map.mapName || '—',
            date: match.date,
            won: map.team1Score === map.team2Score
              ? undefined
              : (isT1 ? map.team1Score > map.team2Score : map.team2Score > map.team1Score),
            myScore: isT1 ? map.team1Score : map.team2Score,
            oppScore: isT1 ? map.team2Score : map.team1Score,
            tournamentId: tournament.id,
            tournamentName: tournament.name,
          });
        }
      }
    }
  }
  return out;
}

// One match the player featured in, within a single tournament — the unit the
// per-tournament expander lists (most recent first). Aggregates the player's
// maps in that match into a single K/D/A + ACS line, oriented to their team.
interface CareerMatch {
  matchId: string;
  stageLabel: string;
  opponentName: string;
  date?: string;
  won?: boolean;        // series result for the player's team (undefined on tie/unknown)
  maps: number;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;          // averaged across the player's maps in this match
  agents: string[];     // agents the player picked across this match's maps
  mapLines: PlayerMapStat[]; // per-map lines, for the inline maps expander
}

// One tournament's worth of this player's stats, for the career section. Carries
// the team they represented there and their match list (so each row can expand
// into a per-tournament match history).
interface CareerEntry {
  tournamentId: string;
  tournamentName: string;
  teamId: string;
  teamName: string;
  maps: number;
  kills: number;
  acs: number;
  placement: string | null; // only set once the tournament is completed
  status: 'planning' | 'registration' | 'in-progress' | 'completed';
  activity: number;         // recency (latest match ms, fallback event start) for ordering
  matches: CareerMatch[];   // most recent first
}

interface Aggregate {
  mapsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;       // averaged per map
  hsPercent: number; // averaged per map
  kd: number;        // total kills / total deaths
  agents: string[];
}

function aggregate(stats: PlayerMapStat[]): Aggregate {
  const maps = stats.length;
  let kills = 0, deaths = 0, assists = 0, acsSum = 0, hsSum = 0;
  const agents = new Set<string>();
  for (const s of stats) {
    kills += s.kills;
    deaths += s.deaths;
    assists += s.assists;
    acsSum += s.acs;
    hsSum += s.hsPercent;
    if (s.agent) agents.add(s.agent);
  }
  return {
    mapsPlayed: maps,
    kills,
    deaths,
    assists,
    acs: maps > 0 ? acsSum / maps : 0,
    hsPercent: maps > 0 ? hsSum / maps : 0,
    kd: deaths > 0 ? kills / deaths : kills,
    agents: [...agents],
  };
}

// ── Achievements ─────────────────────────────────────────────────────────────
// Badges are DERIVED from data already on the page (career totals, per-tournament
// placements, agent pool, career-best map) — no new tables or writes. Each badge
// has a tone class for its accent color. Computed once and rendered in the hero.
interface Badge {
  key: string;
  label: string;
  detail: string;        // tooltip / sub-line explaining how it was earned
  icon: LucideIcon;
  tone: 'gold' | 'silver' | 'red' | 'green' | 'blue' | 'verified';
}

// "1st"/"2nd"… placements parse to a number; everything else (e.g. "Top 4") is
// treated as not-a-podium. computePlacement returns strings like "1st".
function placementRank(placement: string | null): number | null {
  if (!placement) return null;
  const n = parseInt(placement, 10);
  return Number.isFinite(n) ? n : null;
}

function computeBadges(
  agg: Aggregate,
  careers: CareerEntry[],
  peakKills: number,
  isVerified: boolean,
): Badge[] {
  const badges: Badge[] = [];

  if (isVerified) {
    badges.push({ key: 'verified', label: 'Verified Player', detail: 'This profile is claimed and verified by the player', icon: BadgeCheck, tone: 'verified' });
  }

  // Placement badges from completed tournaments (best result wins the medal).
  const ranks = careers
    .filter(c => c.status === 'completed')
    .map(c => placementRank(c.placement))
    .filter((n): n is number => n !== null);
  const titles = ranks.filter(n => n === 1).length;
  if (titles > 0) {
    badges.push({ key: 'champion', label: titles > 1 ? `${titles}× Champion` : 'Champion', detail: `Won ${titles} tournament${titles > 1 ? 's' : ''}`, icon: Crown, tone: 'gold' });
  } else if (ranks.some(n => n === 2)) {
    badges.push({ key: 'finalist', label: 'Finalist', detail: 'Reached a tournament grand final (2nd place)', icon: Medal, tone: 'silver' });
  } else if (ranks.some(n => n === 3)) {
    badges.push({ key: 'podium', label: 'Podium', detail: 'Finished top 3 at a tournament', icon: Medal, tone: 'red' });
  }

  // Performance badges from career aggregates.
  if (agg.mapsPlayed >= 5 && agg.acs >= 250) {
    badges.push({ key: 'fragger', label: 'Star Fragger', detail: `${Math.round(agg.acs)} avg ACS across ${agg.mapsPlayed} maps`, icon: Swords, tone: 'red' });
  }
  if (agg.mapsPlayed >= 5 && agg.kd >= 1.2) {
    badges.push({ key: 'positive-kd', label: 'Positive K/D', detail: `${agg.kd.toFixed(2)} career K/D`, icon: Target, tone: 'green' });
  }
  if (agg.hsPercent >= 25 && agg.mapsPlayed >= 5) {
    badges.push({ key: 'sharpshooter', label: 'Sharpshooter', detail: `${Math.round(agg.hsPercent)}% avg headshots`, icon: Crosshair, tone: 'blue' });
  }
  if (peakKills >= 30) {
    badges.push({ key: 'bomb', label: `${peakKills}-Bomb`, detail: `Dropped ${peakKills} kills on a single map`, icon: Flame, tone: 'gold' });
  }

  // Experience milestone.
  const completed = careers.filter(c => c.status === 'completed').length;
  if (completed >= 3) {
    badges.push({ key: 'veteran', label: 'Veteran', detail: `Competed in ${completed} completed tournaments`, icon: Trophy, tone: 'silver' });
  }

  return badges;
}

// Short date, e.g. "12 May" — shared by the tournament expander match rows.
function shortDate(d?: string): string {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t.getTime())) return '';
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// One tournament in the career section: a header row (tournament name links to
// the tournament page; placement + totals; a chevron toggle at the end) that
// expands into the player's match history *for that tournament*. Expanded by
// default, showing the last 5 matches with a "View more" reveal for the rest.
function CareerTournamentRow({ entry }: { entry: CareerEntry }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);     // expanded by default per spec
  const [showAll, setShowAll] = useState(false);
  // One match at a time can be expanded to show its per-map lines inline.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const shown = showAll ? entry.matches : entry.matches.slice(0, 5);
  const hasMore = entry.matches.length > 5;

  return (
    <div className={`arena-pp-tourney${open ? ' arena-pp-tourney--open' : ''}`}>
      <div className="arena-pp-tourney__head">
        <Trophy className="arena-pp-tourney__icon w-4 h-4" />
        <div className="arena-pp-tourney__id">
          <Link to={`/tournament/${entry.tournamentId}`} className="arena-pp-tourney__name">
            {entry.tournamentName}
          </Link>
          <span className="arena-pp-tourney__team">{entry.teamName}</span>
        </div>
        {entry.placement
          ? <span className="arena-pp-tourney__place">{entry.placement}</span>
          : entry.status !== 'completed' && (
              <span className={`arena-pp-tourney__status arena-pp-tourney__status--${entry.status}`}>
                {entry.status === 'in-progress' ? 'Ongoing' : entry.status === 'registration' ? 'Registration' : 'Upcoming'}
              </span>
            )}
        <span className="arena-pp-tourney__stat">{entry.maps} <small>{entry.maps === 1 ? 'map' : 'maps'}</small></span>
        <span className="arena-pp-tourney__stat arena-pp-tourney__stat--num">{Math.round(entry.acs)} <small>ACS</small></span>
        <span className="arena-pp-tourney__stat arena-pp-tourney__stat--num">{entry.kills} <small>K</small></span>
        {entry.matches.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className={`arena-pp-tourney__toggle${open ? ' arena-pp-tourney__toggle--open' : ''}`}
            title={open ? 'Hide matches' : 'Show matches'}
            aria-label={open ? 'Hide matches' : 'Show matches'}
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        ) : (
          <span className="arena-pp-tourney__toggle arena-pp-tourney__toggle--empty" />
        )}
      </div>

      {open && entry.matches.length > 0 && (
        <div className="arena-pp-tourney__body">
          {shown.map(m => {
            const expanded = expandedId === m.matchId;
            return (
              <div key={m.matchId} className="arena-pp-tmatchwrap">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/tournament-match/${m.matchId}`)}
                  onKeyDown={e => { if (e.key === 'Enter') navigate(`/tournament-match/${m.matchId}`); }}
                  className={`arena-pp-tmatch${m.won === true ? ' arena-pp-tmatch--w' : m.won === false ? ' arena-pp-tmatch--l' : ''}`}
                >
                  <span className="arena-pp-tmatch__stage">{m.stageLabel}</span>
                  <span className="arena-pp-tmatch__opp">vs {m.opponentName}</span>
                  <span className="arena-pp-tmatch__agents">
                    {m.agents.map(a => {
                      const url = agentIconUrl(a);
                      return url
                        ? <img key={a} src={url} alt={a} title={a} className="arena-pp-tmatch__agent" />
                        : <span key={a} className="arena-pp-tmatch__agent arena-pp-tmatch__agent--fallback" title={a}>{a.slice(0, 2).toUpperCase()}</span>;
                    })}
                  </span>
                  <span className="arena-pp-tmatch__date">{m.date ? shortDate(m.date) : ''}</span>
                  <span className="arena-pp-tmatch__kda">
                    <span className="arena-pp-kda__k">{m.kills}</span>
                    <span className="arena-pp-kda__sep">/</span>
                    <span className="arena-pp-kda__d">{m.deaths}</span>
                    <span className="arena-pp-kda__sep">/</span>
                    <span className="arena-pp-kda__a">{m.assists}</span>
                  </span>
                  <span className={`arena-pp-tmatch__acs${m.acs >= 240 ? ' arena-pp-table__acs-hot' : ''}`}>
                    {Math.round(m.acs)} <small>ACS</small>
                  </span>
                  <span className="arena-pp-tmatch__rescol">
                    {m.won !== undefined && (
                      <span className={`arena-pp-tmatch__res arena-pp-tmatch__res--${m.won ? 'w' : 'l'}`}>
                        {m.won ? 'W' : 'L'}
                      </span>
                    )}
                  </span>
                  {m.mapLines.length > 0 ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className={`arena-pp-tmatch__expand${expanded ? ' arena-pp-tmatch__expand--open' : ''}`}
                      title={expanded ? 'Hide maps' : 'Show maps'}
                      onClick={e => { e.stopPropagation(); setExpandedId(expanded ? null : m.matchId); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setExpandedId(expanded ? null : m.matchId);
                        }
                      }}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </span>
                  ) : (
                    <span className="arena-pp-tmatch__expand arena-pp-tmatch__expand--empty" />
                  )}
                </div>

                {expanded && m.mapLines.length > 0 && (
                  <div className="arena-pp-maplines">
                    {m.mapLines.map((ml, mi) => {
                      const splash = mapImageUrl(ml.mapName);
                      return (
                        <div
                          key={mi}
                          className="arena-pp-mapline"
                          style={splash ? {
                            backgroundImage: `linear-gradient(90deg, rgba(10,10,10,0.94) 0%, rgba(10,10,10,0.72) 45%, rgba(10,10,10,0.92) 100%), url(${splash})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center 35%',
                          } : undefined}
                        >
                          <span className="arena-pp-mapline__map">{ml.mapName || `Map ${mi + 1}`}</span>
                          <span className="arena-pp-mapline__score">
                            <span className={ml.won === true ? 'arena-pp-mapline__score-win' : ''}>{ml.myScore}</span>
                            <span className="arena-pp-mapline__score-sep">–</span>
                            <span className={ml.won === false ? 'arena-pp-mapline__score-win' : ''}>{ml.oppScore}</span>
                          </span>
                          <span className="arena-pp-tmatch__agents">
                            {(() => {
                              const a = (ml.agent ?? '').split(',')[0].trim();
                              if (!a) return null;
                              const url = agentIconUrl(a);
                              return url
                                ? <img src={url} alt={a} title={a} className="arena-pp-tmatch__agent" />
                                : <span className="arena-pp-tmatch__agent arena-pp-tmatch__agent--fallback" title={a}>{a.slice(0, 2).toUpperCase()}</span>;
                            })()}
                          </span>
                          <span className="arena-pp-tmatch__kda">
                            <span className="arena-pp-kda__k">{ml.kills}</span>
                            <span className="arena-pp-kda__sep">/</span>
                            <span className="arena-pp-kda__d">{ml.deaths}</span>
                            <span className="arena-pp-kda__sep">/</span>
                            <span className="arena-pp-kda__a">{ml.assists}</span>
                          </span>
                          <span className={`arena-pp-tmatch__acs${ml.acs >= 240 ? ' arena-pp-table__acs-hot' : ''}`}>
                            {Math.round(ml.acs)} <small>ACS</small>
                          </span>
                          <span className="arena-pp-tmatch__rescol">
                            {ml.won !== undefined && (
                              <span className={`arena-pp-tmatch__res arena-pp-tmatch__res--${ml.won ? 'w' : 'l'}`}>
                                {ml.won ? 'W' : 'L'}
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {hasMore && (
            <button
              type="button"
              className="arena-pp-tourney__more"
              onClick={() => setShowAll(s => !s)}
            >
              {showAll ? 'Show fewer matches' : `View all ${entry.matches.length} matches`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PlayerPage() {
  const { tournamentId = '', playerId = '' } = useParams();
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAliases, setShowAliases] = useState(false);
  const [shared, setShared] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [cardError, setCardError] = useState(false); // OG image failed (e.g. local dev — no /api)
  const [toast, setToast] = useState<string | null>(null);
  // Background "this could be your profile" match for the signed-in viewer.
  // Keyed by `${tournamentId}|${playerId}` (a claim is per-card, and the same
  // person can be a different roster slot across tournaments) so the banner only
  // shows on the exact card the match was found against.
  const { userId: viewerId, playerAccount: viewerAccount } = useAuth();
  const [myMatchKeys, setMyMatchKeys] = useState<Set<string> | null>(null);
  const [iHaveActiveClaim, setIHaveActiveClaim] = useState(false);
  const [claimingSuggested, setClaimingSuggested] = useState(false);
  // Set the instant a claim submit succeeds, so the suggestion banner hides
  // without waiting for the claim refetch / a manual page refresh.
  const [claimSubmitted, setClaimSubmitted] = useState(false);

  useEffect(() => loadWithRetry(getTournaments, ts => { setTournaments(ts); setLoading(false); }), []);

  // Esc closes the share-card modal.
  useEffect(() => {
    if (!shareOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShareOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shareOpen]);

  // Background match: which player cards belong to the signed-in viewer (by
  // their captured Riot connection). Gate on verified (claiming needs Google +
  // Discord anyway) AND a captured connection to match against — drives the
  // suggestion banner. Card Riot IDs stay server-side (find-my-player-profiles).
  useEffect(() => {
    let cancelled = false;
    if (!viewerId || !viewerAccount?.is_verified || !viewerAccount?.riot_connection_verified) {
      setMyMatchKeys(null);
      setIHaveActiveClaim(false);
      return;
    }
    findMyPlayerProfiles().then(res => {
      if (cancelled) return;
      setMyMatchKeys(new Set(res.matches.map(m => `${m.tournamentId}|${m.playerId}`)));
      setIHaveActiveClaim(res.hasActiveClaim);
    });
    return () => { cancelled = true; };
  }, [viewerId, viewerAccount?.is_verified, viewerAccount?.riot_connection_verified]);

  const tournament = useMemo(
    () => tournaments.find(t => t.id === tournamentId) || null,
    [tournaments, tournamentId],
  );

  // Find the player by id in the URL's tournament first; if not there (e.g. a
  // substitute who only exists in another tournament's copy of the team), fall
  // back to searching every tournament. `sourceTournament` is wherever we found
  // them, so stats are collected from the right place.
  const resolved = useMemo(() => {
    const primary = tournament ? findPlayer(tournament, playerId) : null;
    if (primary && tournament) return { ...primary, sourceTournament: tournament };
    for (const t of tournaments) {
      const hit = findPlayer(t, playerId);
      if (hit) return { ...hit, sourceTournament: t };
    }
    return null;
  }, [tournament, tournaments, playerId]);

  const found = resolved;

  // The player's photo may have been uploaded on a different tournament/team
  // copy of this person (they recur across tournaments, possibly on different
  // teams). If this copy has no photo, backfill it from any other copy that is
  // the SAME person by Riot-ID identity (name fallback) — so a photo set on the
  // Auros Gaming stint shows on the APEX HAVOC stint too.
  const photo = useMemo(() => {
    if (!found) return undefined;
    if (found.player.photo) return found.player.photo;
    for (const t of tournaments) {
      for (const team of t.teams) {
        const match = team.players.find(p => p.photo && samePlayerIdentity(p, found.player));
        if (match?.photo) return match.photo;
      }
    }
    return undefined;
  }, [found, tournaments]);

  // Profile claim state for this card (button / pending chip / claimed owner).
  // Keyed to the tournament where the player actually lives — that's the blob
  // the verify-riot-claim edge function searches.
  const { claim, owner: claimOwner, myActiveClaim, loaded: claimLoaded, reload: reloadClaim } = useClaim(
    resolved?.sourceTournament.id ?? '',
    resolved?.player.id ?? '',
  );

  const { mapStats, careers } = useMemo(() => {
    if (!resolved) return { mapStats: [] as PlayerMapStat[], careers: [] as CareerEntry[] };
    const allStats: PlayerMapStat[] = [];
    const careerList: CareerEntry[] = [];
    const seen = new Set<string>();
    // Collect from every tournament + team where this *person* appears — matched
    // by Riot ID (with name fallback) rather than team name, so a player who
    // changed teams between tournaments (e.g. Auros Gaming → APEX HAVOC) has all
    // their tournaments unified into one career instead of a profile per team.
    for (const t of tournaments) {
      for (const tm of t.teams) {
        const rosterPlayer = tm.players.find(p => samePlayerIdentity(p, resolved.player));
        if (!rosterPlayer) continue;
        const rows: PlayerMapStat[] = [];
        for (const row of collectPlayerMapStats(t, rosterPlayer, tm.id)) {
          const key = `${row.matchId}|${row.mapName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        if (rows.length === 0) continue;
        allStats.push(...rows);

        // Group this tournament's maps into per-match lines, oriented to the
        // player's team, then sort most-recent first for the expander.
        const byMatch = new Map<string, PlayerMapStat[]>();
        for (const r of rows) {
          const arr = byMatch.get(r.matchId) ?? [];
          arr.push(r);
          byMatch.set(r.matchId, arr);
        }
        const matches: CareerMatch[] = [...byMatch.values()].map(mlist => {
          const ag = aggregate(mlist);
          const wins = mlist.filter(m => m.won === true).length;
          const losses = mlist.filter(m => m.won === false).length;
          return {
            matchId: mlist[0].matchId,
            stageLabel: mlist[0].stageLabel,
            opponentName: mlist[0].opponentName,
            date: mlist[0].date,
            won: wins === losses ? undefined : wins > losses,
            maps: mlist.length,
            kills: ag.kills,
            deaths: ag.deaths,
            assists: ag.assists,
            acs: ag.acs,
            agents: [...new Set(
              mlist.map(m => (m.agent ?? '').split(',')[0].trim()).filter(Boolean),
            )],
            mapLines: mlist,
          };
        });
        const matchTime = (m: CareerMatch) =>
          m.date ? new Date(`${m.date}T00:00`).getTime() : Number.NEGATIVE_INFINITY;
        matches.sort((a, b) => matchTime(b) - matchTime(a));

        const a = aggregate(rows);
        const latestMatchMs = Math.max(
          ...matches.map(matchTime).filter(n => Number.isFinite(n)),
          t.event?.startDate ? new Date(t.event.startDate).getTime() || 0 : 0,
          0,
        );
        const status = deriveTournamentStatus(t);
        careerList.push({
          tournamentId: t.id,
          tournamentName: t.name,
          teamId: tm.id,
          teamName: tm.name,
          maps: rows.length,
          kills: a.kills,
          acs: a.acs,
          placement: status === 'completed' ? computePlacement(t, tm.id) : null,
          status,
          activity: latestMatchMs,
          matches,
        });
      }
    }
    // Order: live/ongoing tournaments first, then upcoming, then completed —
    // a finished event never outranks an active one (so a player's "current"
    // team is the one they're actively playing for). Within a tier, most recent
    // first. This is why a completed Aorus stint stays below an in-progress
    // Next Level stint even if its matches carry later dates.
    const statusRank: Record<CareerEntry['status'], number> = {
      'in-progress': 0,
      'registration': 1,
      'planning': 1,
      'completed': 2,
    };
    careerList.sort((a, b) =>
      statusRank[a.status] - statusRank[b.status] || b.activity - a.activity,
    );
    return { mapStats: allStats, careers: careerList };
  }, [resolved, tournaments]);

  // The player's latest team + tournament (drives the hero chips). Falls back to
  // wherever they were resolved from when there are no stats yet.
  const latestStint = careers[0] ?? null;
  // Other teams the player has represented (distinct, excluding the latest), for
  // the "Past Teams" section. Keyed by normalized team name so the same squad
  // across tournaments collapses to one entry.
  const pastTeams = useMemo(() => {
    const seenNames = new Set<string>();
    if (latestStint) seenNames.add(latestStint.teamName.trim().toLowerCase());
    const out: { teamId: string; teamName: string; tournamentName: string }[] = [];
    for (const c of careers) {
      const key = c.teamName.trim().toLowerCase();
      if (seenNames.has(key)) continue;
      seenNames.add(key);
      out.push({ teamId: c.teamId, teamName: c.teamName, tournamentName: c.tournamentName });
    }
    return out;
  }, [careers, latestStint]);

  const agg = useMemo(() => aggregate(mapStats), [mapStats]);

  // Per-agent breakdown, most-played first.
  const agentBreakdown = useMemo(() => {
    const by = new Map<string, { agent: string; maps: number; kills: number; deaths: number; acsSum: number }>();
    for (const s of mapStats) {
      const agent = (s.agent ?? '').split(',')[0].trim();
      if (!agent) continue;
      const cur = by.get(agent.toLowerCase()) ?? { agent, maps: 0, kills: 0, deaths: 0, acsSum: 0 };
      cur.maps += 1; cur.kills += s.kills; cur.deaths += s.deaths; cur.acsSum += s.acs;
      by.set(agent.toLowerCase(), cur);
    }
    return [...by.values()]
      .map(a => ({ ...a, acs: a.acsSum / a.maps, kd: a.deaths > 0 ? a.kills / a.deaths : a.kills }))
      .sort((a, b) => b.maps - a.maps || b.acs - a.acs);
  }, [mapStats]);

  // Per-map breakdown with W–L record, most-played first.
  const mapBreakdown = useMemo(() => {
    const by = new Map<string, { map: string; maps: number; wins: number; losses: number; acsSum: number }>();
    for (const s of mapStats) {
      if (!s.mapName || s.mapName === '—') continue;
      const cur = by.get(s.mapName.toLowerCase()) ?? { map: s.mapName, maps: 0, wins: 0, losses: 0, acsSum: 0 };
      cur.maps += 1; cur.acsSum += s.acs;
      if (s.won === true) cur.wins += 1;
      else if (s.won === false) cur.losses += 1;
      by.set(s.mapName.toLowerCase(), cur);
    }
    return [...by.values()]
      .map(m => ({ ...m, acs: m.acsSum / m.maps }))
      .sort((a, b) => b.maps - a.maps || b.acs - a.acs);
  }, [mapStats]);

  // Career-best map by kills, for the highlight strip.
  const peak = useMemo(() => {
    let best: PlayerMapStat | null = null;
    for (const s of mapStats) if (!best || s.kills > best.kills) best = s;
    return best && best.kills > 0 ? best : null;
  }, [mapStats]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text animate-pulse">Loading player…</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!found) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text">Player not found.</p>
          <button onClick={() => navigate(-1)} className="arena-md__back" style={{ margin: '0 auto' }}>
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  const { player, team } = found;
  // The tournament the player actually belongs to (may differ from the URL one).
  const playerTournament = found.sourceTournament;

  // This exact card matches the signed-in viewer's captured Riot connection →
  // suggest a claim. Keyed to the resolved (tournament, player) tuple so the
  // banner shows only on the card the match was actually found against.
  const isSuggestedMatch =
    !!myMatchKeys &&
    myMatchKeys.has(`${playerTournament.id}|${player.id}`) &&
    !iHaveActiveClaim;

  // Accept the suggestion → run the existing Discord re-auth claim flow. The
  // ClaimControls instance (mounted in the hero) handles the ?claim=1 return and
  // its result dialogs regardless of what kicked it off.
  const acceptSuggestion = async () => {
    setClaimingSuggested(true);
    try { await startClaimReauth(playerTournament.id, player.id); }
    catch { setClaimingSuggested(false); }
  };

  // A claim is approved against a SNAPSHOT of the card's Riot ID (claim.riot_id).
  // tournaments_blob is mutable: an organizer can edit this card's riotId AFTER
  // approval, which would leave the public "Verified Player" badge (and the
  // claimed-owner avatar/bio override) standing against a card that no longer
  // matches the verified Riot ID — i.e. vouching for the wrong person. So the
  // badge/override only render when the card's CURRENT riotId still matches the
  // claim's snapshot. (decide-claim enforces the same match at approval time;
  // this is the read-side guard for edits that happen afterward.) A superadmin
  // can clean up the now-stale claim via the admin panel.
  const approvedClaimMatchesCard =
    claim?.status === 'approved' &&
    !!player.riotId?.trim() &&
    !!claim.riot_id?.trim() &&
    normalizeRiotId(player.riotId) === normalizeRiotId(claim.riot_id);
  // The owner's profile (avatar/bio/socials) only overrides the roster card when
  // the claim still matches — otherwise show the plain roster card.
  const verifiedOwner = approvedClaimMatchesCard ? claimOwner : null;

  // Hero chips reflect the player's LATEST team/tournament (career is now unified
  // across teams). Fall back to wherever they were resolved when no stats exist.
  const heroTeamId = latestStint?.teamId ?? team.id;
  const heroTeamName = latestStint?.teamName ?? team.name;
  const heroTournamentId = latestStint?.tournamentId ?? playerTournament.id;
  const heroTournamentName = latestStint?.tournamentName ?? playerTournament.name;

  const matchesPlayed = new Set(mapStats.map(s => s.matchId)).size;
  const summaryCards: { label: string; value: string; sub: string; highlight?: boolean }[] = [
    { label: 'ACS', value: Math.round(agg.acs).toString(), sub: 'avg per map', highlight: true },
    { label: 'K/D', value: agg.kd.toFixed(2), sub: `${agg.kills} K · ${agg.deaths} D · ${agg.assists} A` },
    { label: 'HS%', value: `${Math.round(agg.hsPercent)}%`, sub: 'avg per map' },
    { label: 'Maps', value: agg.mapsPlayed.toString(), sub: `across ${matchesPlayed} ${matchesPlayed === 1 ? 'match' : 'matches'}` },
  ];

  // Derived achievement badges (no new data — see computeBadges).
  const badges = computeBadges(agg, careers, peak?.kills ?? 0, approvedClaimMatchesCard);

  // Canonical profile path (drop any incidental query/hash on the current URL).
  // /player/:tid/:pid is rewritten server-side (vercel.json → api/profile-meta)
  // to inject og:image tags pointing at the generated card (api/og/player), so
  // pasting THIS link in Discord/Twitter/iMessage unfurls into a ClutchGG card.
  const shareUrl = `${window.location.origin}/player/${playerTournament.id}/${player.id}`;
  // Same image the link unfurls to — used for the in-app preview + download so
  // what the user sees is pixel-identical to what others get.
  const cardImageUrl = `${window.location.origin}/api/og/player?tid=${encodeURIComponent(playerTournament.id)}&pid=${encodeURIComponent(player.id)}`;
  const shareText = `${player.name}${heroTeamName ? ` (${heroTeamName})` : ''} — ${Math.round(agg.acs)} ACS · ${agg.kd.toFixed(2)} K/D on ClutchGG`;

  // Brief themed toast (auto-dismisses). One at a time is fine here.
  const showToast = (msg: string, ms = 2400) => {
    setToast(msg);
    setTimeout(() => setToast(t => (t === msg ? null : t)), ms);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
      showToast('Profile link copied to clipboard');
    } catch {
      showToast('Couldn’t copy — copy the link from the address bar');
    }
  };
  const handleNativeShare = async () => {
    if (!navigator.share) return handleCopyLink();
    try {
      await navigator.share({ title: `${player.name} · ClutchGG`, text: shareText, url: shareUrl });
      showToast('Shared!');
    } catch { /* cancelled — no-op */ }
  };

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-md">
        {/* Back + Share */}
        <div className="arena-pp-topbar">
          <button onClick={() => navigate(`/teams/${heroTeamId}`)} className="arena-md__back">
            <ChevronLeft className="w-4 h-4" />
            Back to Roster
          </button>
          <button
            type="button"
            onClick={() => { setCardError(false); setShareOpen(true); }}
            className="arena-pp-share"
            title="Share this profile"
          >
            <Share2 className="w-4 h-4" />
            Share
          </button>
        </div>

        {/* Player hero */}
        <div className="arena-pp-hero">
          <div className="arena-pp-hero__photo">
            {/* The claimed owner's avatar wins over the roster photo — it's the
                player's own self-chosen picture. Only when the claim still
                matches the card's current Riot ID (see verifiedOwner). */}
            {(verifiedOwner?.avatar_url || photo)
              ? <img src={verifiedOwner?.avatar_url || photo} alt={player.name} />
              : <span className="arena-pp-hero__initials">{playerInitials(player.name)}</span>}
          </div>

          <div className="arena-pp-hero__id">
            <p className="arena-md-section__eyebrow" style={{ margin: '0 0 0.4rem' }}>Player Profile</p>

            {/* Name + optional history indicator */}
            <div className="arena-pp-name-row">
              <h1 className="arena-pp-hero__name">{player.name}</h1>
              {approvedClaimMatchesCard && (
                <span
                  className="arena-pp-chip"
                  title="This profile is claimed and verified by the player"
                  style={{ borderColor: 'var(--arena-accent)', color: 'var(--arena-accent)', gap: '0.3em' }}
                >
                  <BadgeCheck className="w-3.5 h-3.5" />
                  Verified Player
                </span>
              )}
              {(player.nameHistory ?? []).length > 0 && (
                <div className="arena-pp-alias">
                  <button
                    type="button"
                    className="arena-pp-alias__trigger"
                    onClick={() => setShowAliases(v => !v)}
                    title="This player has changed their name"
                  >
                    <ChevronDown className={`arena-pp-alias__chevron${showAliases ? ' arena-pp-alias__chevron--open' : ''}`} />
                  </button>
                  {showAliases && (
                    <>
                      {/* Transparent backdrop — closes the dropdown on click-away. */}
                      <div
                        className="arena-pp-alias__backdrop"
                        onClick={() => setShowAliases(false)}
                      />
                      <div className="arena-pp-alias__dropdown">
                        <p className="arena-pp-alias__label">Previously played as:</p>
                        <ul className="arena-pp-alias__list">
                          {(player.nameHistory ?? []).map((alias: PlayerAlias, i: number) => (
                            <li key={i} className="arena-pp-alias__item">
                              <span className="arena-pp-alias__name">{alias.name}</span>
                              {alias.riotId && (
                                <span className="arena-pp-alias__riot">{alias.riotId}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {player.riotId && (
              <p className="arena-pp-hero__riot" title="Riot ID">
                <span className="arena-pp-hero__riot-name">{player.riotId.split('#')[0]}</span>
                {player.riotId.includes('#') && (
                  <span className="arena-pp-hero__riot-tag">#{player.riotId.split('#').slice(1).join('#')}</span>
                )}
              </p>
            )}

            <div className="arena-pp-hero__chips">
              <button type="button" onClick={() => navigate(`/teams/${heroTeamId}`)} className="arena-pp-chip arena-pp-chip--link">
                <Shield className="w-3.5 h-3.5" />
                {heroTeamName}
              </button>
              <button type="button" onClick={() => navigate(`/tournament/${heroTournamentId}`)} className="arena-pp-chip arena-pp-chip--link">
                <Trophy className="w-3.5 h-3.5" />
                {heroTournamentName}
              </button>
              {player.role && (
                <span className="arena-pp-chip arena-pp-chip--role" style={getRoleStyle(player.role)}>
                  {player.role.toUpperCase()}
                </span>
              )}
              <ClaimControls
                tournamentId={playerTournament.id}
                playerId={player.id}
                cardRiotId={player.riotId}
                claim={claim}
                myActiveClaim={myActiveClaim}
                claimLoaded={claimLoaded}
                isSuggestedMatch={isSuggestedMatch}
                onClaimChanged={reloadClaim}
                onClaimResult={(status) => {
                  if (status === 'submitted') {
                    setClaimSubmitted(true); // hide the banner immediately (no refresh)
                    showToast('Claim submitted — it’s now in review with an admin.', 5000);
                  } else if (status === 'claim_taken') {
                    showToast('This profile has already been claimed by someone else.', 5000);
                  } else if (status === 'already_has_claim') {
                    showToast('You already hold a claim. Unclaim it first to claim a different profile.', 5000);
                  } else if (status === 'riot_mismatch') {
                    showToast('That profile’s Riot ID doesn’t match your verified account.', 5000);
                  }
                }}
              />
            </div>

            {/* "This could be you" suggestion banner — shown only when the card's
                Riot ID matches the signed-in viewer's verified Riot ID, there's
                no claim yet here, and they hold no claim elsewhere. Hidden the
                instant a claim is submitted (claimSubmitted) so it doesn't linger
                until the claim refetch lands. */}
            {isSuggestedMatch && !claim && !claimSubmitted && (
              <div className="arena-pp-claim-suggest" role="status">
                <Sparkles className="arena-pp-claim-suggest__icon w-5 h-5" />
                <div className="arena-pp-claim-suggest__text">
                  <p className="arena-pp-claim-suggest__title">This looks like your profile</p>
                  <p className="arena-pp-claim-suggest__sub">
                    Your verified Riot ID matches this player. Claim it to make it yours.
                  </p>
                </div>
                <button
                  type="button"
                  className="arena-pp-claim-suggest__btn"
                  onClick={acceptSuggestion}
                  disabled={claimingSuggested}
                >
                  <BadgeCheck className="w-4 h-4" />
                  {claimingSuggested ? 'Working…' : 'Claim this profile'}
                </button>
              </div>
            )}

            {verifiedOwner && <ClaimedProfileBlock owner={verifiedOwner} />}

            {agg.agents.length > 0 && (
              <div className="arena-pp-hero__agents">
                <span className="arena-pp-hero__agents-label">Agents</span>
                <AgentTag agent={agg.agents.join(', ')} />
              </div>
            )}

            {badges.length > 0 && (
              <div className="arena-pp-hero__badges">
                <span className="arena-pp-hero__badges-label">Achievements</span>
                <div className="arena-pp-badges">
                  {badges.map(b => {
                    const Icon = b.icon;
                    return (
                      <span
                        key={b.key}
                        className={`arena-pp-badge arena-pp-badge--${b.tone}`}
                        title={b.detail}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {b.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {pastTeams.length > 0 && (
              <div className="arena-pp-hero__past">
                <span className="arena-pp-hero__past-label">Past Teams</span>
                <span className="arena-pp-hero__past-list">
                  {pastTeams.map(pt => (
                    <button
                      key={pt.teamId}
                      type="button"
                      onClick={() => navigate(`/teams/${pt.teamId}`)}
                      className="arena-pp-chip arena-pp-chip--link arena-pp-chip--ghost"
                      title={`${pt.teamName} · ${pt.tournamentName}`}
                    >
                      <Shield className="w-3.5 h-3.5" />
                      {pt.teamName}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Summary stat strip */}
        <div className="arena-pp-stats">
          {summaryCards.map(card => (
            <div key={card.label} className="arena-pp-stat">
              <p className="arena-pp-stat__label">{card.label}</p>
              <p className={`arena-pp-stat__value${card.highlight ? ' arena-pp-stat__value--accent' : ''}`}>
                {card.value}
              </p>
              <p className="arena-pp-stat__sub">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Career-best highlight — map splash backdrop, broadcast-style strip */}
        {peak && (() => {
          const splash = mapImageUrl(peak.mapName);
          return (
            <div
              className="arena-pp-peak"
              style={splash ? {
                backgroundImage: `linear-gradient(90deg, #111 0%, rgba(17,17,17,0.96) 30%, rgba(17,17,17,0.6) 65%, rgba(17,17,17,0.88) 100%), url(${splash})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center 30%',
              } : undefined}
            >
              <span className="arena-pp-peak__label">Career Best</span>
              <span className="arena-pp-peak__kills">
                {peak.kills}<small>kills</small>
              </span>
              <span className="arena-pp-peak__div" />
              <span className="arena-pp-peak__text">
                vs <strong>{peak.opponentName}</strong>
                <span className="arena-pp-peak__dot">·</span>
                {peak.mapName}
              </span>
            </div>
          );
        })()}

        {/* Agent / map breakdowns — column-aligned tables with usage/winrate bars */}
        {(agentBreakdown.length > 0 || mapBreakdown.length > 0) && (
          <div className="arena-pp-break">
            {agentBreakdown.length > 0 && (() => {
              const maxMaps = Math.max(...agentBreakdown.map(a => a.maps));
              return (
                <div className="arena-tp-card">
                  <h3 className="arena-tp-card__title">By Agent</h3>
                  <div className="arena-pp-break__list">
                    <div className="arena-pp-break__hrow arena-pp-break__grid--agent">
                      <span>Agent</span>
                      <span className="arena-pp-break__hcell--num">Maps</span>
                      <span className="arena-pp-break__hcell--num">ACS</span>
                      <span className="arena-pp-break__hcell--num">K/D</span>
                    </div>
                    {agentBreakdown.map(a => {
                      const icon = agentIconUrl(a.agent);
                      return (
                        <div key={a.agent} className="arena-pp-break__row arena-pp-break__grid--agent">
                          <span className="arena-pp-break__who">
                            {icon
                              ? <img src={icon} alt="" className="arena-pp-break__icon" />
                              : <span className="arena-pp-break__icon arena-pp-break__icon--empty" />}
                            <span className="arena-pp-break__namecol">
                              <span className="arena-pp-break__name">{a.agent}</span>
                              <span className="arena-pp-break__bar">
                                <span
                                  className="arena-pp-break__bar-fill"
                                  style={{ width: `${Math.max(8, (a.maps / maxMaps) * 100)}%` }}
                                />
                              </span>
                            </span>
                          </span>
                          <span className="arena-pp-break__cell arena-pp-break__cell--num">{a.maps}</span>
                          <span className="arena-pp-break__cell arena-pp-break__cell--num arena-pp-break__cell--strong">{Math.round(a.acs)}</span>
                          <span className="arena-pp-break__cell arena-pp-break__cell--num">{a.kd.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            {mapBreakdown.length > 0 && (
              <div className="arena-tp-card">
                <h3 className="arena-tp-card__title">By Map</h3>
                <div className="arena-pp-break__list">
                  <div className="arena-pp-break__hrow arena-pp-break__grid--map">
                    <span>Map</span>
                    <span className="arena-pp-break__hcell--num">Record</span>
                    <span className="arena-pp-break__hcell--num">Maps</span>
                    <span className="arena-pp-break__hcell--num">ACS</span>
                  </div>
                  {mapBreakdown.map(m => {
                    const decided = m.wins + m.losses;
                    return (
                      <div key={m.map} className="arena-pp-break__row arena-pp-break__grid--map">
                        <span className="arena-pp-break__who">
                          <span className="arena-pp-break__namecol">
                            <span className="arena-pp-break__name">{m.map}</span>
                            <span className="arena-pp-break__bar">
                              {decided > 0 && (
                                <>
                                  <span className="arena-pp-break__bar-fill arena-pp-break__bar-fill--w" style={{ width: `${(m.wins / decided) * 100}%` }} />
                                  <span className="arena-pp-break__bar-fill arena-pp-break__bar-fill--l" style={{ width: `${(m.losses / decided) * 100}%` }} />
                                </>
                              )}
                            </span>
                          </span>
                        </span>
                        <span className="arena-pp-break__cell arena-pp-break__cell--num">
                          <span className="arena-pp-break__w">{m.wins}W</span>
                          <span className="arena-pp-break__sep">–</span>
                          <span className="arena-pp-break__l">{m.losses}L</span>
                        </span>
                        <span className="arena-pp-break__cell arena-pp-break__cell--num">{m.maps}</span>
                        <span className="arena-pp-break__cell arena-pp-break__cell--num arena-pp-break__cell--strong">{Math.round(m.acs)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tournaments & match history — one row per tournament; the tournament
            name links to its page, the chevron expands the player's match history
            for that tournament (open by default, last 5 + view more). */}
        <section className="arena-md-section arena-pp-form">
          <p className="arena-md-section__eyebrow">Track Record</p>
          <h2 className="arena-md-section__title">Tournaments</h2>

          {careers.length === 0 ? (
            <div className="arena-stats-empty">
              <p className="arena-stats-empty__title">No stats recorded yet</p>
              <p className="arena-stats-empty__sub">
                Stats appear here once match scoreboards are applied for this player.
              </p>
            </div>
          ) : (
            <div className="arena-pp-tourney-list">
              {careers.map(c => (
                <CareerTournamentRow key={`${c.tournamentId}-${c.teamId}`} entry={c} />
              ))}
            </div>
          )}
        </section>
      </main>

      {shareOpen && (
        <div
          className="arena-success-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Share profile card"
          onClick={() => setShareOpen(false)}
        >
          <div className="arena-share-modal" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="arena-share-modal__close"
              onClick={() => setShareOpen(false)}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <p className="arena-share-modal__title">Share Card</p>
            <p className="arena-share-modal__sub">
              This is how <strong>{player.name}</strong>'s profile looks when the link is shared.
            </p>

            {/* The exact image the link unfurls to (api/og/player). 1200×630.
                The /api route only runs in production (Vercel) — locally it 404s,
                so show a friendly note instead of a broken image. */}
            <div className={`arena-share-modal__preview${cardError ? ' arena-share-modal__preview--error' : ''}`}>
              {cardError ? (
                <div className="arena-share-modal__fallback">
                  <Share2 className="w-6 h-6" />
                  <p>Card preview generates on the live site.</p>
                  <span>Copy or share the link — it’ll unfurl into the card automatically.</span>
                </div>
              ) : (
                <img
                  src={cardImageUrl}
                  alt={`${player.name} — ClutchGG player card`}
                  loading="eager"
                  onError={() => setCardError(true)}
                />
              )}
            </div>

            <div className="arena-share-modal__actions">
              <button type="button" className="arena-share-modal__btn arena-share-modal__btn--primary" onClick={handleCopyLink}>
                {shared ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                {shared ? 'Copied!' : 'Copy link'}
              </button>
              <a
                className="arena-share-modal__btn"
                href={cardImageUrl}
                download={`${player.name.replace(/[^\w-]+/g, '_')}_clutchgg_card.png`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="w-4 h-4" />
                Download
              </a>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button type="button" className="arena-share-modal__btn" onClick={handleNativeShare}>
                  <Share2 className="w-4 h-4" />
                  Share…
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightweight themed toast — bottom-center, auto-dismisses. */}
      {toast && (
        <div className="arena-toast" role="status" aria-live="polite">
          <Check className="w-4 h-4" />
          {toast}
        </div>
      )}

      <Footer />
    </div>
  );
}
