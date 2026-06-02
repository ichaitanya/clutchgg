import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, Trophy, Clock, Calendar, Play, ExternalLink, X, Map as MapIcon } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import type { AdminData } from './AdminPanel';
import type { Tournament, BracketMatch, TeamInTournament, TournamentPlayer, MatchPlayerStat, MatchMapResult, BracketGenerated } from './TournamentCreation';
import { getTournaments } from '../services/db';
import { statMatchesPlayer } from './StatsPage';
import { mapImageUrl, agentIconUrl } from '../utils/valorantAssets';

interface MatchContext {
  match: BracketMatch;
  tournament: Tournament;
  team1: TeamInTournament | null;
  team2: TeamInTournament | null;
  stage: string;
  status: 'upcoming' | 'live' | 'completed';
}

function getMatchStatus(date?: string, time?: string): 'upcoming' | 'live' | 'completed' {
  if (!date) return 'upcoming';
  try {
    const matchDateTime = new Date(`${date}T${time || '00:00'}`);
    const now = new Date();
    const diffHours = (matchDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (diffHours > -3 && diffHours < 3) return 'live';
    if (diffHours < -3) return 'completed';
    return 'upcoming';
  } catch {
    return 'upcoming';
  }
}

// A series is decided once a team reaches ceil(maxMaps/2) map wins (2 in a BO3),
// or all maps are played and someone is ahead.
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

// Role badge colors, tuned for the dark editorial surface.
function getRoleColor(role?: string) {
  switch (role) {
    case 'igl': return 'color:#facc15;background:rgba(250,204,21,0.1)';
    case 'duelist': return 'color:#f87171;background:rgba(248,113,113,0.1)';
    case 'controller': return 'color:#60a5fa;background:rgba(96,165,250,0.1)';
    case 'sentinel': return 'color:#4ade80;background:rgba(74,222,128,0.1)';
    case 'initiator': return 'color:#c084fc;background:rgba(192,132,252,0.1)';
    default: return 'color:#9ca3af;background:rgba(156,163,175,0.1)';
  }
}

// Two uppercase initials of a team name for the crest fallback.
function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().substring(0, 2).toUpperCase();
}

// Extract a YouTube video id from the common URL shapes (watch?v=, youtu.be/,
// /embed/, /live/, /shorts/). Returns null if it can't be parsed.
function youtubeId(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1) || null;
    if (host.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/\/(embed|live|shorts)\/([^/?]+)/);
      if (m) return m[2];
    }
  } catch {
    // Not a parseable URL.
  }
  return null;
}

function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function youtubeThumb(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}

function findMatchInTournaments(matchId: string, tournaments: Tournament[]): MatchContext | null {
  for (const tournament of tournaments) {
    const allBrackets: Array<{ bracket: { rounds: BracketMatch[][] }; stage: string }> = [];

    if (tournament.generatedBracket) {
      allBrackets.push({ bracket: tournament.generatedBracket, stage: 'Main Bracket' });
    }
    if (tournament.stage1Bracket) {
      allBrackets.push({
        bracket: tournament.stage1Bracket,
        stage: tournament.stage1Config?.format === 'groupstage' ? 'Group Stage' : 'Stage 1',
      });
    }
    if (tournament.stage2Bracket) {
      allBrackets.push({ bracket: tournament.stage2Bracket, stage: 'Stage 2' });
    }

    for (const { bracket, stage } of allBrackets) {
      const match = bracket.rounds.flat().find(m => m.id === matchId);
      if (match) {
        const team1 = tournament.teams.find(t => t.id === match.team1Id) ?? null;
        const team2 = tournament.teams.find(t => t.id === match.team2Id) ?? null;
        const stageLabel = match.bracketSection === 'losers'
          ? `${stage} – Losers`
          : match.bracketSection === 'grand-final'
          ? 'Grand Final'
          : stage;
        return {
          match,
          tournament,
          team1,
          team2,
          stage: stageLabel,
          status: (match.winner || isMatchDecidedByMaps(match)) ? 'completed' : getMatchStatus(match.date, match.time),
        };
      }
    }
  }
  return null;
}

// A map slot is "played" if it carries real data. Empty placeholder slots
// (used to preserve map ordering when, e.g., Map 2 is filled before Map 1) have
// no matchId/stats and 0-0 score, and should be hidden from the UI.
function isPlayedMap(m: MatchMapResult): boolean {
  return !!m.matchId || (!!m.playerStats && m.playerStats.length > 0)
    || !!m.mapName || m.team1Score > 0 || m.team2Score > 0;
}

// ── Score from maps ──────────────────────────────────────────────────────────
function deriveScore(match: BracketMatch): { s1: number; s2: number } {
  if (!match.maps || match.maps.length === 0) {
    return {
      s1: match.winner === match.team1Id ? 1 : match.winner === match.team2Id ? 0 : 0,
      s2: match.winner === match.team2Id ? 1 : match.winner === match.team1Id ? 0 : 0,
    };
  }
  let s1 = 0, s2 = 0;
  for (const m of match.maps) {
    if (m.team1Score > m.team2Score) s1++;
    else if (m.team2Score > m.team1Score) s2++;
  }
  return { s1, s2 };
}

// ── Head-to-head / past matches ──────────────────────────────────────────────
// A normalized player-name set for a roster, used to decide whether two team
// entries (possibly under different names or tournaments) are "the same team".
function rosterKey(players: TournamentPlayer[]): Set<string> {
  return new Set(players.map(p => p.name.trim().toLowerCase()).filter(Boolean));
}

// Two rosters are treated as the same team when they share at least 3 players.
function rostersOverlap(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const name of a) if (b.has(name)) shared++;
  return shared >= 3;
}

// One finished match involving a tracked team, flattened for the history lists.
interface HistoryMatch {
  id: string;
  tournamentId: string;
  tournamentName: string;
  date?: string;
  // Oriented around the "subject" team: self = the tracked team's score.
  selfName: string;
  selfLogo?: string;
  oppName: string;
  oppLogo?: string;
  selfScore: number;
  oppScore: number;
  won: boolean;
  format: 'bo1' | 'bo3' | 'bo5';
  // Both rosters, so head-to-head can test the opponent side too.
  selfRoster: Set<string>;
  oppRoster: Set<string>;
  ts: number; // sort key (epoch ms; 0 when undated)
}

// Walk every bracket of every tournament and collect each *completed* match that
// involves a team whose roster matches `subjectRoster` (≥3 shared players). The
// result is oriented so `self*` is always the subject team's side.
function collectHistory(
  subjectRoster: Set<string>,
  tournaments: Tournament[],
  excludeMatchId: string,
): HistoryMatch[] {
  const out: HistoryMatch[] = [];
  for (const t of tournaments) {
    const brackets = [t.generatedBracket, t.stage1Bracket, t.stage2Bracket].filter(Boolean) as BracketGenerated[];
    const teamById = new Map(t.teams.map(tm => [tm.id, tm]));
    for (const b of brackets) {
      for (const m of b.rounds.flat()) {
        if (m.id === excludeMatchId) continue;
        if (!m.winner && !isMatchDecidedByMaps(m)) continue; // completed only
        const t1 = teamById.get(m.team1Id);
        const t2 = teamById.get(m.team2Id);
        const r1 = rosterKey(t1?.players ?? []);
        const r2 = rosterKey(t2?.players ?? []);
        const subjectIs1 = rostersOverlap(subjectRoster, r1);
        const subjectIs2 = rostersOverlap(subjectRoster, r2);
        if (!subjectIs1 && !subjectIs2) continue;
        const { s1, s2 } = deriveScore(m);
        const ts = m.date ? new Date(`${m.date}T${m.time || '00:00'}`).getTime() : 0;
        const format = (m.format ?? 'bo3') as 'bo1' | 'bo3' | 'bo5';
        if (subjectIs1) {
          out.push({
            id: m.id, tournamentId: t.id, tournamentName: t.name, date: m.date,
            selfName: t1?.name ?? m.team1Name, selfLogo: t1?.logo,
            oppName: t2?.name ?? m.team2Name, oppLogo: t2?.logo,
            selfScore: s1, oppScore: s2, won: s1 > s2, format,
            selfRoster: r1, oppRoster: r2, ts: Number.isNaN(ts) ? 0 : ts,
          });
        } else {
          out.push({
            id: m.id, tournamentId: t.id, tournamentName: t.name, date: m.date,
            selfName: t2?.name ?? m.team2Name, selfLogo: t2?.logo,
            oppName: t1?.name ?? m.team1Name, oppLogo: t1?.logo,
            selfScore: s2, oppScore: s1, won: s2 > s1, format,
            selfRoster: r2, oppRoster: r1, ts: Number.isNaN(ts) ? 0 : ts,
          });
        }
      }
    }
  }
  // Newest first; undated (ts 0) sort to the end.
  return out.sort((a, b) => b.ts - a.ts);
}

// ── Sub-components ──────────────────────────────────────────────────────────
// Team crest in the hero: uploaded logo, else a gradient tile with initials.
function HeroCrest({ name, gradient, logo }: { name: string; gradient: string; logo?: string }) {
  if (logo) {
    return (
      <span className="arena-md-hero__crest">
        <img src={logo} alt={name} />
      </span>
    );
  }
  return (
    <span className="arena-md-hero__crest arena-md-hero__crest--gradient" style={{ background: gradient }}>
      <span className="arena-md-hero__crest-text">{teamInitials(name)}</span>
    </span>
  );
}

type SortKey = 'kills' | 'kd' | 'acs' | 'hsPercent';

function StatsTable({ teamName, teamStats, tournamentId, rosterPlayers }: {
  teamName: string;
  teamStats: MatchPlayerStat[];
  tournamentId: string;
  rosterPlayers: TournamentPlayer[];
}) {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>('acs');
  if (teamStats.length === 0) return null;
  const maxAcs = Math.max(...teamStats.map(s => s.acs));

  const sortValue = (s: MatchPlayerStat, key: SortKey) =>
    key === 'kd' ? (s.kd > 0 ? s.kd : s.deaths > 0 ? s.kills / s.deaths : s.kills) : s[key];
  const sortedStats = [...teamStats].sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));

  const SortHeader = ({ label, sortKey: key }: { label: string; sortKey: SortKey }) => (
    <th
      className={`arena-md-table__sortable${sortKey === key ? ' arena-md-table__sorted' : ''}`}
      onClick={() => setSortKey(key)}
    >
      {label}{sortKey === key ? ' ↓' : ''}
    </th>
  );

  return (
    <div className="arena-md-table-card">
      <div className="arena-md-table-card__head">
        <span className="arena-md-table-card__bar" />
        <span className="arena-md-table-card__team">{teamName}</span>
      </div>
      <div className="arena-md-table-wrap">
        <table className="arena-md-table">
          <thead>
            <tr>
              <th className="arena-md-table__left">Player</th>
              <th className="arena-md-table__left">Agent</th>
              <SortHeader label="K" sortKey="kills" />
              <th>D</th>
              <th>A</th>
              <SortHeader label="K/D" sortKey="kd" />
              <SortHeader label="ACS" sortKey="acs" />
              <SortHeader label="HS%" sortKey="hsPercent" />
            </tr>
          </thead>
          <tbody>
            {sortedStats.map((s, i) => {
              const isTopAcs = s.acs === maxAcs && s.acs > 0;
              // Resolve this stat row to a roster player so the name links to
              // their profile (stats are keyed by Riot ID, not roster slot id).
              const rosterPlayer = rosterPlayers.find(p => statMatchesPlayer(s, p));
              const kdClass = s.kd >= 1.5 ? 'arena-md-table__kd-good' : s.kd >= 1 ? 'arena-md-table__kd-ok' : 'arena-md-table__kd-low';
              return (
                <tr key={s.playerId} className={i % 2 === 0 ? 'arena-md-table__alt' : ''}>
                  <td className="arena-md-table__left">
                    {rosterPlayer ? (
                      <button
                        onClick={() => navigate(`/player/${tournamentId}/${rosterPlayer.id}`)}
                        className="arena-md-table__player"
                      >
                        {s.playerName}
                      </button>
                    ) : (
                      <span className="arena-md-table__player arena-md-table__player--static">{s.playerName}</span>
                    )}
                  </td>
                  <td className="arena-md-table__left">
                    {s.agent ? (
                      <span className="arena-md-table__agents">
                        {s.agent.split(',').map(a => a.trim()).filter(Boolean).map((a, idx) => {
                          const url = agentIconUrl(a);
                          return url
                            ? <img key={idx} src={url} alt={a} title={a} className="arena-md-table__agent" />
                            : <span key={idx} title={a} className="arena-md-table__agent-fallback">{a.slice(0, 2).toUpperCase()}</span>;
                        })}
                      </span>
                    ) : <span className="arena-md-table__dim">—</span>}
                  </td>
                  <td>{s.kills}</td>
                  <td>{s.deaths}</td>
                  <td>{s.assists}</td>
                  <td>
                    <span className={kdClass}>
                      {s.kd > 0 ? s.kd.toFixed(2) : (s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : '—')}
                    </span>
                  </td>
                  <td>
                    <span className={isTopAcs ? 'arena-md-table__acs-top' : ''}>
                      {s.acs > 0 ? s.acs : '—'}
                    </span>
                  </td>
                  <td className="arena-md-table__dim">
                    {s.hsPercent > 0 ? `${s.hsPercent}%` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// One row in the head-to-head / past-matches lists. Oriented around the subject
// team: their score on the left, opponent's logo + name, the date on the right.
function HistoryRow({ h, onClick }: { h: HistoryMatch; onClick: () => void }) {
  const dateText = h.date
    ? new Date(`${h.date}T00:00`).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
    : '';
  return (
    <button type="button" onClick={onClick} className="arena-md-hrow">
      <span className="arena-md-hrow__crest">
        {h.oppLogo ? <img src={h.oppLogo} alt="" /> : <span className="arena-md-hrow__crest-text">{teamInitials(h.oppName)}</span>}
      </span>
      <span className="arena-md-hrow__name">{h.oppName}</span>
      {dateText && <span className="arena-md-hrow__date">{dateText}</span>}
      <span className="arena-md-hrow__fmt">{h.format.toUpperCase()}</span>
      <span className={`arena-md-hrow__score${h.won ? ' arena-md-hrow__score--win' : ' arena-md-hrow__score--loss'}`}>
        {h.selfScore} <span className="arena-md-hrow__score-dash">-</span> {h.oppScore}
      </span>
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export function TournamentMatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<MatchContext | null>(null);
  const [allTournaments, setAllTournaments] = useState<Tournament[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);
  // When set, a YouTube embed URL to show in the video popup modal (stream/clip).
  const [streamPopup, setStreamPopup] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) { setNotFound(true); return; }
    getTournaments()
      .then(tournaments => {
        setAllTournaments(tournaments);
        const result = findMatchInTournaments(matchId, tournaments);
        if (result) setCtx(result);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [matchId]);

  // Default to the aggregated "Total" view when the match has multiple maps
  // with stats; otherwise select the first map that actually has stats.
  useEffect(() => {
    if (!ctx) return;
    const maps = ctx.match.maps ?? [];
    const withStats = maps
      .map((m, i) => ({ i, has: !!m.playerStats && m.playerStats.length > 0 }))
      .filter(x => x.has);
    if (withStats.length > 1) setSelectedMapIndex(-1);
    else setSelectedMapIndex(withStats[0]?.i ?? 0);
  }, [ctx]);

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text">Match not found.</p>
          <button onClick={() => navigate('/matches')} className="arena-md__back" style={{ margin: '0 auto' }}>
            <ArrowLeft className="w-4 h-4" /> Back to Schedule
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text animate-pulse">Loading match…</p>
        </div>
        <Footer />
      </div>
    );
  }

  const { match, tournament, team1, team2, stage, status } = ctx;

  const team1Name = team1?.name ?? match.team1Name;
  const team2Name = team2?.name ?? match.team2Name;
  const isCompleted = status === 'completed' || !!match.winner;
  const team1Won = match.winner === match.team1Id;
  const team2Won = match.winner === match.team2Id;

  const { s1, s2 } = deriveScore(match);

  const hasMaps = (match.maps ?? []).some(isPlayedMap);

  // Build effective stats — use saved stats or generate blank rows from team rosters
  const buildDefaultStats = () => {
    const rows: MatchPlayerStat[] = [];
    for (const [teamId, teamObj] of [[match.team1Id, team1], [match.team2Id, team2]] as [string, TeamInTournament | null][]) {
      if (!teamObj) continue;
      for (const p of teamObj.players) {
        rows.push({ playerId: p.id, playerName: p.name, teamId, agent: '', kills: 0, deaths: 0, assists: 0, kd: 0, acs: 0, hsPercent: 0 });
      }
    }
    return rows;
  };
  // Aggregate stats across every map. Players are unioned by playerId, so if
  // rosters differ between maps, all unique players appear. K/D/A are summed;
  // ACS and HS% are averaged over the maps that player actually played; K/D is
  // recomputed from summed kills/deaths.
  const buildTotalStats = (): MatchPlayerStat[] => {
    // Aggregate keyed by playerId via a plain object (kept simple/portable).
    type Agg = { row: MatchPlayerStat; agents: Set<string>; mapsPlayed: number; acsSum: number; hsSum: number };
    const acc: Record<string, Agg> = {};
    const order: string[] = [];
    for (const m of match.maps ?? []) {
      for (const s of m.playerStats ?? []) {
        const cur = acc[s.playerId];
        if (!cur) {
          order.push(s.playerId);
          acc[s.playerId] = {
            row: { ...s },
            agents: new Set(s.agent ? [s.agent] : []),
            mapsPlayed: 1,
            acsSum: s.acs,
            hsSum: s.hsPercent,
          };
        } else {
          cur.row.kills += s.kills;
          cur.row.deaths += s.deaths;
          cur.row.assists += s.assists;
          if (s.agent) cur.agents.add(s.agent);
          cur.mapsPlayed += 1;
          cur.acsSum += s.acs;
          cur.hsSum += s.hsPercent;
        }
      }
    }
    return order.map(id => {
      const { row, agents, mapsPlayed, acsSum, hsSum } = acc[id];
      return {
        ...row,
        agent: Array.from(agents).join(', '),
        kd: row.deaths > 0 ? parseFloat((row.kills / row.deaths).toFixed(2)) : row.kills,
        acs: mapsPlayed > 0 ? Math.round(acsSum / mapsPlayed) : 0,
        hsPercent: mapsPlayed > 0 ? Math.round(hsSum / mapsPlayed) : 0,
      };
    });
  };

  // Per-map stats: if maps carry their own playerStats, use the selected map's
  // stats. selectedMapIndex === -1 means the aggregated "Total" view.
  const mapsWithStats = (match.maps ?? []).some(m => m.playerStats && m.playerStats.length > 0);
  const isTotalView = selectedMapIndex === -1;
  const safeMapIndex = isTotalView ? -1 : Math.min(selectedMapIndex, (match.maps?.length ?? 1) - 1);
  const selectedMapStats = !mapsWithStats ? undefined
    : isTotalView ? buildTotalStats()
    : match.maps?.[safeMapIndex]?.playerStats;
  const effectiveStats: MatchPlayerStat[] =
    (selectedMapStats && selectedMapStats.length > 0)
      ? selectedMapStats
      : (match.playerStats && match.playerStats.length > 0)
      ? match.playerStats
      : buildDefaultStats();
  const hasAnyTeamPlayers = (team1?.players.length ?? 0) > 0 || (team2?.players.length ?? 0) > 0;

  // Split stats per team. Normally filter by teamId; but when both bracket slots
  // are the SAME team (team1Id === team2Id), filtering can't separate the two
  // sides, so split the rows in half (API stats come ordered Blue then Red).
  let team1Stats: MatchPlayerStat[];
  let team2Stats: MatchPlayerStat[];
  if (match.team1Id === match.team2Id) {
    const mid = Math.ceil(effectiveStats.length / 2);
    team1Stats = effectiveStats.slice(0, mid);
    team2Stats = effectiveStats.slice(mid);
  } else {
    team1Stats = effectiveStats.filter(s => s.teamId === match.team1Id);
    team2Stats = effectiveStats.filter(s => s.teamId === match.team2Id);
  }

  const statusLabel = status === 'live' ? 'Live' : status === 'upcoming' ? 'Upcoming' : 'Completed';

  // Highlight clips: only those that resolve to a YouTube embed open in the
  // popup; others (rare) fall back to opening in a new tab via an anchor.
  const clips = (match.clips ?? []).filter(c => c.url);
  const hasBroadcast = !!match.streamUrl || clips.length > 0;

  // History: each team's completed matches (this one excluded), matched across
  // all tournaments by roster overlap. Head-to-head = the subset where the
  // opponent side also matches the *other* team here.
  const roster1 = rosterKey(team1?.players ?? []);
  const roster2 = rosterKey(team2?.players ?? []);
  const history1 = collectHistory(roster1, allTournaments, match.id);
  const history2 = collectHistory(roster2, allTournaments, match.id);
  const headToHead = history1.filter(h => rostersOverlap(h.oppRoster, roster2));
  const past1 = history1.slice(0, 5);
  const past2 = history2.slice(0, 5);
  const hasHistory = headToHead.length > 0 || past1.length > 0 || past2.length > 0;

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-md">
        {/* Back */}
        <button onClick={() => navigate('/matches')} className="arena-md__back">
          <ArrowLeft className="w-4 h-4" />
          Back to Schedule
        </button>

        {/* ── Match Hero ─────────────────────────────────────────────────── */}
        <div className={`arena-md-hero${isCompleted && team1Won ? ' arena-md-hero--win-left' : ''}${isCompleted && team2Won ? ' arena-md-hero--win-right' : ''}`}>
          <div className="arena-md-hero__stage">{stage}</div>

          <div className="arena-md-hero__body">
            {/* Team 1 */}
            <button
              type="button"
              onClick={() => team1 && navigate(`/teams/${team1.id}`)}
              className={`arena-md-hero__team${isCompleted && team1Won ? ' arena-md-hero__team--winner' : ''}${isCompleted && !team1Won ? ' arena-md-hero__team--loser' : ''}`}
              disabled={!team1}
            >
              <HeroCrest name={team1Name} logo={team1?.logo} gradient={team1Won ? 'linear-gradient(135deg,#ff4655,#c0392b)' : 'linear-gradient(135deg,#3b82f6,#1d4ed8)'} />
              <p className="arena-md-hero__team-name">{team1Name}</p>
            </button>

            {/* Center */}
            <div className="arena-md-hero__center">
              {isCompleted ? (
                <span className="arena-md-hero__score">
                  <span className={team1Won ? 'arena-md-hero__score-win' : ''}>{s1}</span>
                  <span className="arena-md-hero__score-sep">:</span>
                  <span className={team2Won ? 'arena-md-hero__score-win' : ''}>{s2}</span>
                </span>
              ) : (
                <span className="arena-md-hero__vs">vs</span>
              )}
              <span className={`arena-md-hero__badge arena-md-hero__badge--${status}`}>
                {status === 'live' && <span className="arena-md-hero__badge-dot" />}
                {statusLabel}
              </span>
              {(match.date || match.time) && (
                <div className="arena-md-hero__datetime">
                  {match.date && (
                    <span>
                      <Calendar className="w-3 h-3" />
                      {new Date(`${match.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                  {match.time && (
                    <span>
                      <Clock className="w-3 h-3" />
                      {match.time}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Team 2 */}
            <button
              type="button"
              onClick={() => team2 && navigate(`/teams/${team2.id}`)}
              className={`arena-md-hero__team${isCompleted && team2Won ? ' arena-md-hero__team--winner' : ''}${isCompleted && !team2Won ? ' arena-md-hero__team--loser' : ''}`}
              disabled={!team2}
            >
              <HeroCrest name={team2Name} logo={team2?.logo} gradient={team2Won ? 'linear-gradient(135deg,#ff4655,#c0392b)' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)'} />
              <p className="arena-md-hero__team-name">{team2Name}</p>
            </button>
          </div>

          {/* Tournament strip */}
          <div className="arena-md-hero__strip">
            <Link to={`/tournament/${tournament.id}`} className="arena-md-hero__strip-link">
              <Trophy className="w-4 h-4" />
              {tournament.name}
            </Link>
            <span className="arena-md-hero__strip-sep">·</span>
            <span>Round {match.round + 1}</span>
          </div>
        </div>

        {/* ── Map Results ────────────────────────────────────────────────── */}
        {hasMaps && (
          <section className="arena-md-section">
            <p className="arena-md-section__eyebrow">Series</p>
            <h2 className="arena-md-section__title">Map Results</h2>
            <div className="arena-md-maps">
              {match.maps!.map((m, i) => {
                if (!isPlayedMap(m)) return null; // hide unplayed placeholder slots
                const t1wins = m.team1Score > m.team2Score;
                const t2wins = m.team2Score > m.team1Score;
                const clickable = mapsWithStats && !!m.playerStats && m.playerStats.length > 0;
                const isSelected = clickable && i === safeMapIndex;
                const splash = mapImageUrl(m.mapName);
                return (
                  <div
                    key={i}
                    onClick={() => clickable && setSelectedMapIndex(i)}
                    className={`arena-md-map${clickable ? ' arena-md-map--clickable' : ''}${isSelected ? ' arena-md-map--selected' : ''}`}
                  >
                    <span className="arena-md-map__thumb">
                      {splash
                        ? <img src={splash} alt={m.mapName} />
                        : <MapIcon className="w-4 h-4" />}
                    </span>
                    <span className="arena-md-map__info">
                      <span className="arena-md-map__name">{m.mapName || `Map ${i + 1}`}</span>
                      {(t1wins || t2wins) && (
                        <span className="arena-md-map__winner">{t1wins ? team1Name : team2Name} wins</span>
                      )}
                      {clickable && (
                        <span className="arena-md-map__hint">
                          {isSelected ? 'Viewing scoreboard' : 'Click for scoreboard'}
                        </span>
                      )}
                    </span>
                    <span className="arena-md-map__score">
                      <span className={t1wins ? 'arena-md-map__score-win' : ''}>{m.team1Score}</span>
                      <span className="arena-md-map__score-sep">:</span>
                      <span className={t2wins ? 'arena-md-map__score-win' : ''}>{m.team2Score}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Broadcast & Highlights (compact two-column tiles) ──────────── */}
        {hasBroadcast && (
          <section className="arena-md-section">
            <div className="arena-md-media">
              {/* Streams */}
              <div className="arena-md-media__col">
                <p className="arena-md-media__label">Streams</p>
                {match.streamUrl ? (
                  (() => {
                    const embed = youtubeEmbedUrl(match.streamUrl!);
                    return embed ? (
                      <button
                        type="button"
                        onClick={() => setStreamPopup(embed)}
                        className="arena-md-tile arena-md-tile--primary"
                      >
                        <Play className="w-4 h-4 arena-md-tile__icon" />
                        <span className="arena-md-tile__text">Match Stream</span>
                      </button>
                    ) : (
                      <a
                        href={match.streamUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="arena-md-tile arena-md-tile--primary"
                      >
                        <ExternalLink className="w-4 h-4 arena-md-tile__icon" />
                        <span className="arena-md-tile__text">Match Stream</span>
                      </a>
                    );
                  })()
                ) : (
                  <p className="arena-md-media__empty">Not available</p>
                )}
              </div>

              {/* Highlights / clips */}
              <div className="arena-md-media__col">
                <p className="arena-md-media__label">Highlights</p>
                {clips.length > 0 ? (
                  <div className="arena-md-tile-grid">
                    {clips.map(clip => {
                      const embed = youtubeEmbedUrl(clip.url);
                      const label = clip.title || 'Clip';
                      return embed ? (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => setStreamPopup(embed)}
                          className="arena-md-tile"
                        >
                          <Play className="w-3.5 h-3.5 arena-md-tile__icon" />
                          <span className="arena-md-tile__text">{label}</span>
                        </button>
                      ) : (
                        <a
                          key={clip.id}
                          href={clip.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="arena-md-tile"
                        >
                          <ExternalLink className="w-3.5 h-3.5 arena-md-tile__icon" />
                          <span className="arena-md-tile__text">{label}</span>
                        </a>
                      );
                    })}
                  </div>
                ) : (
                  <p className="arena-md-media__empty">Not yet available</p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Player Stats ───────────────────────────────────────────────── */}
        {hasAnyTeamPlayers && (
          <section className="arena-md-section">
            <p className="arena-md-section__eyebrow">Performance</p>
            <h2 className="arena-md-section__title">
              Player Stats
              {mapsWithStats && (match.maps?.length ?? 0) > 1 && (
                <span className="arena-md-section__title-sub">
                  {isTotalView ? 'Total' : (match.maps?.[safeMapIndex]?.mapName || `Map ${safeMapIndex + 1}`)}
                </span>
              )}
            </h2>

            {/* Map / Total selector — only when multiple maps carry stats */}
            {mapsWithStats && (match.maps?.length ?? 0) > 1 && (
              <div className="arena-md-pills">
                <button
                  onClick={() => setSelectedMapIndex(-1)}
                  className={`arena-md-pill${isTotalView ? ' arena-md-pill--active' : ''}`}
                >
                  Total
                </button>
                {(match.maps ?? []).map((m, i) => {
                  const hasStats = !!m.playerStats && m.playerStats.length > 0;
                  if (!hasStats) return null;
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedMapIndex(i)}
                      className={`arena-md-pill${!isTotalView && safeMapIndex === i ? ' arena-md-pill--active' : ''}`}
                    >
                      {m.mapName || `Map ${i + 1}`}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Official map splash banner for the selected map */}
            {!isTotalView && (() => {
              const selMap = match.maps?.[safeMapIndex];
              const splash = mapImageUrl(selMap?.mapName);
              if (!selMap || !splash) return null;
              return (
                <div className="arena-md-splash">
                  <img src={splash} alt={selMap.mapName} />
                  <div className="arena-md-splash__wash" />
                  <div className="arena-md-splash__row">
                    <div>
                      <p className="arena-md-splash__label">Map</p>
                      <p className="arena-md-splash__name">{selMap.mapName}</p>
                    </div>
                    <span className="arena-md-splash__score">
                      <span className={selMap.team1Score >= selMap.team2Score ? '' : 'arena-md-splash__score-dim'}>{selMap.team1Score}</span>
                      <span className="arena-md-splash__score-sep">:</span>
                      <span className={selMap.team2Score >= selMap.team1Score ? '' : 'arena-md-splash__score-dim'}>{selMap.team2Score}</span>
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="arena-md-stats">
              <StatsTable teamName={team1Name} teamStats={team1Stats} tournamentId={tournament.id} rosterPlayers={team1?.players ?? []} />
              <StatsTable teamName={team2Name} teamStats={team2Stats} tournamentId={tournament.id} rosterPlayers={team2?.players ?? []} />
            </div>
          </section>
        )}

        {/* ── Lineups (player face tiles) ────────────────────────────────── */}
        <section className="arena-md-section">
          <p className="arena-md-section__eyebrow">Lineups</p>
          <h2 className="arena-md-section__title">Player Rosters</h2>
          <div className="arena-md-lineups">
            {([
              { team: team1, name: team1Name, logo: team1?.logo, avatar: 'rgba(255,70,85,0.18)', avatarColor: '#ff4655' },
              { team: team2, name: team2Name, logo: team2?.logo, avatar: 'rgba(139,92,246,0.18)', avatarColor: '#a78bfa' },
            ] as const).map((side, idx) => (
              <div key={idx} className="arena-md-lineup">
                <div className="arena-md-lineup__head">
                  <span className="arena-md-lineup__crest">
                    {side.logo
                      ? <img src={side.logo} alt={side.name} />
                      : <span className="arena-md-lineup__crest-text">{teamInitials(side.name)}</span>}
                  </span>
                  <span className="arena-md-lineup__name">{side.name}</span>
                </div>
                {side.team && side.team.players.length > 0 ? (
                  <div className="arena-md-lineup__grid">
                    {side.team.players.map(player => (
                      <button
                        key={player.id}
                        type="button"
                        onClick={() => navigate(`/player/${tournament.id}/${player.id}`)}
                        className="arena-md-player"
                        title={player.role ? `${player.name} · ${player.role.toUpperCase()}` : player.name}
                      >
                        <span className="arena-md-player__role" style={player.role ? getRoleStyle(player.role) : { color: 'var(--arena-text-dim)' }}>
                          {player.role ? player.role.toUpperCase() : '—'}
                        </span>
                        <span className="arena-md-player__photo">
                          {player.photo
                            ? <img src={player.photo} alt={player.name} />
                            : <span className="arena-md-player__initials" style={{ background: side.avatar, color: side.avatarColor }}>{teamInitials(player.name)}</span>}
                        </span>
                        <span className="arena-md-player__name">{player.name}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="arena-md-lineup__empty">No players listed</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── Head-to-Head & Past Matches ────────────────────────────────── */}
        {hasHistory && (
          <section className="arena-md-section">
            <p className="arena-md-section__eyebrow">Form</p>
            <h2 className="arena-md-section__title">Head-to-Head</h2>

            {/* H2H banner */}
            <div className="arena-md-h2h">
              <div className="arena-md-h2h__side">
                <span className="arena-md-lineup__crest arena-md-h2h__crest">
                  {team1?.logo ? <img src={team1.logo} alt={team1Name} /> : <span className="arena-md-lineup__crest-text">{teamInitials(team1Name)}</span>}
                </span>
                <span className="arena-md-h2h__team">{team1Name}</span>
              </div>
              <div className="arena-md-h2h__center">
                {headToHead.length > 0 ? (
                  <>
                    <span className="arena-md-h2h__tally">
                      {headToHead.filter(h => h.won).length}
                      <span className="arena-md-h2h__tally-sep">–</span>
                      {headToHead.filter(h => !h.won).length}
                    </span>
                    <span className="arena-md-h2h__tally-label">{team1Name} record</span>
                  </>
                ) : (
                  <span className="arena-md-h2h__none">No previous encounters</span>
                )}
              </div>
              <div className="arena-md-h2h__side arena-md-h2h__side--right">
                <span className="arena-md-h2h__team">{team2Name}</span>
                <span className="arena-md-lineup__crest arena-md-h2h__crest">
                  {team2?.logo ? <img src={team2.logo} alt={team2Name} /> : <span className="arena-md-lineup__crest-text">{teamInitials(team2Name)}</span>}
                </span>
              </div>
            </div>

            {/* H2H match list */}
            {headToHead.length > 0 && (
              <div className="arena-md-history" style={{ marginBottom: '1.5rem' }}>
                {headToHead.map(h => <HistoryRow key={h.id} h={h} onClick={() => navigate(`/tournament-match/${h.id}`)} />)}
              </div>
            )}

            {/* Past matches, two columns */}
            {(past1.length > 0 || past2.length > 0) && (
              <div className="arena-md-past">
                <div>
                  <p className="arena-md-media__label">{team1Name} — Last {past1.length}</p>
                  <div className="arena-md-history">
                    {past1.length > 0
                      ? past1.map(h => <HistoryRow key={h.id} h={h} onClick={() => navigate(`/tournament-match/${h.id}`)} />)
                      : <p className="arena-md-media__empty">No recent matches</p>}
                  </div>
                </div>
                <div>
                  <p className="arena-md-media__label">{team2Name} — Last {past2.length}</p>
                  <div className="arena-md-history">
                    {past2.length > 0
                      ? past2.map(h => <HistoryRow key={h.id} h={h} onClick={() => navigate(`/tournament-match/${h.id}`)} />)
                      : <p className="arena-md-media__empty">No recent matches</p>}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Stream popup modal */}
      {streamPopup && (
        <div className="arena-md-modal" onClick={() => setStreamPopup(null)}>
          <div className="arena-md-modal__inner" onClick={e => e.stopPropagation()}>
            <button onClick={() => setStreamPopup(null)} className="arena-md-modal__close" aria-label="Close stream">
              <X className="w-6 h-6" />
            </button>
            <div className="arena-md-modal__frame">
              <iframe
                src={`${streamPopup}?autoplay=1`}
                title="Match stream"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}

// Parse the inline role style string into a React style object.
function getRoleStyle(role?: string): { color?: string; background?: string } {
  const decl = getRoleColor(role);
  const style: { color?: string; background?: string } = {};
  for (const part of decl.split(';')) {
    const [k, v] = part.split(':');
    if (k && v) {
      if (k.trim() === 'color') style.color = v.trim();
      else style.background = v.trim();
    }
  }
  return style;
}
