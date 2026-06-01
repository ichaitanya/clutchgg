import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, Trophy, Users, Shield, Clock, Calendar, Map, Youtube, Play, ExternalLink, X } from 'lucide-react';
import { Header } from './Header';
import type { AdminData } from './AdminPanel';
import type { Tournament, BracketMatch, TeamInTournament, TournamentPlayer, MatchPlayerStat, MatchMapResult } from './TournamentCreation';
import { getTournaments } from '../services/db';
import { statMatchesPlayer } from './StatsPage';

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

function getRoleColor(role?: string) {
  switch (role) {
    case 'igl': return 'text-yellow-400 bg-yellow-400/10';
    case 'duelist': return 'text-red-400 bg-red-400/10';
    case 'controller': return 'text-blue-400 bg-blue-400/10';
    case 'sentinel': return 'text-green-400 bg-green-400/10';
    case 'initiator': return 'text-purple-400 bg-purple-400/10';
    default: return 'text-gray-400 bg-gray-400/10';
  }
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

// ── Sub-components ──────────────────────────────────────────────────────────
function TeamLogo({ name, gradient }: { name: string; gradient: string }) {
  return (
    <div
      className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0"
      style={{ background: gradient }}
    >
      {name.substring(0, 2).toUpperCase()}
    </div>
  );
}

type SortKey = 'kills' | 'kd' | 'acs' | 'hsPercent';

function StatsTable({ teamName, teamStats, accentColor, tournamentId, rosterPlayers }: {
  teamName: string;
  teamStats: MatchPlayerStat[];
  accentColor: string;
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
      className={`px-3 py-2.5 text-center cursor-pointer select-none transition-colors hover:text-white ${
        sortKey === key ? 'text-[#ff4655]' : ''
      }`}
      onClick={() => setSortKey(key)}
    >
      {label}{sortKey === key ? ' ↓' : ''}
    </th>
  );

  return (
    <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl overflow-hidden">
      {/* Team header */}
      <div className="px-5 py-3 border-b border-[#2a2d3a]">
        <span className="font-bold text-sm" style={{ color: accentColor }}>{teamName}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wider border-b border-[#2a2d3a]">
              <th className="px-5 py-2.5 text-left">Player</th>
              <th className="px-3 py-2.5 text-left">Agent</th>
              <SortHeader label="K" sortKey="kills" />
              <th className="px-3 py-2.5 text-center">D</th>
              <th className="px-3 py-2.5 text-center">A</th>
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
              return (
                <tr key={s.playerId} className={`border-b border-[#2a2d3a] last:border-0 ${i % 2 === 0 ? 'bg-[#0d0f16]/40' : ''}`}>
                  <td className="px-5 py-3">
                    {rosterPlayer ? (
                      <button
                        onClick={() => navigate(`/player/${tournamentId}/${rosterPlayer.id}`)}
                        className="text-white font-semibold text-sm hover:text-[#ff4655] transition-colors"
                      >
                        {s.playerName}
                      </button>
                    ) : (
                      <span className="text-white font-semibold text-sm">{s.playerName}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-gray-400 text-sm">{s.agent || '—'}</td>
                  <td className="px-3 py-3 text-center text-white font-semibold text-sm">{s.kills}</td>
                  <td className="px-3 py-3 text-center text-white font-semibold text-sm">{s.deaths}</td>
                  <td className="px-3 py-3 text-center text-white font-semibold text-sm">{s.assists}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`font-bold text-sm ${s.kd >= 1.5 ? 'text-[#4ade80]' : s.kd >= 1 ? 'text-gray-300' : 'text-gray-500'}`}>
                      {s.kd > 0 ? s.kd.toFixed(2) : (s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : '—')}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`font-bold text-sm ${isTopAcs ? 'text-[#ff4655]' : 'text-white'}`}>
                      {s.acs > 0 ? s.acs : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center text-gray-300 text-sm">
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

// ── Page ─────────────────────────────────────────────────────────────────────
export function TournamentMatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<MatchContext | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);
  // When set, a YouTube embed URL to show in the stream popup modal.
  const [streamPopup, setStreamPopup] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) { setNotFound(true); return; }
    getTournaments()
      .then(tournaments => {
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
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <p className="text-gray-400 text-lg mb-4">Match not found.</p>
          <button onClick={() => navigate('/matches')} className="text-[#ff4655] hover:underline text-sm flex items-center gap-1 mx-auto">
            <ArrowLeft className="w-4 h-4" /> Back to Schedule
          </button>
        </div>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <div className="animate-pulse text-gray-500">Loading match...</div>
        </div>
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
    // Plain object keyed by playerId — `Map` here is the lucide-react icon import,
    // not the global constructor.
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

  const statusBadge = {
    live: { label: 'LIVE', cls: 'bg-red-500/20 text-red-400 border border-red-500/50' },
    upcoming: { label: 'UPCOMING', cls: 'bg-blue-500/10 text-blue-400 border border-blue-500/30' },
    completed: { label: 'COMPLETED', cls: 'bg-gray-700/60 text-gray-300 border border-gray-600/40' },
  }[status];

  return (
    <div className="min-h-screen bg-[#0d0f16]">
      <Header />

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* Back */}
        <button
          onClick={() => navigate('/matches')}
          className="flex items-center gap-2 text-[#ff4655] hover:text-[#ff6670] transition-colors text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Schedule
        </button>

        {/* ── Match Header ───────────────────────────────────────────────── */}
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-2xl overflow-hidden">
          {/* Stage label */}
          <div className="text-center pt-6 pb-2">
            <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">{stage}</span>
          </div>

          {/* Teams + Score */}
          <div className="flex items-center justify-center gap-0 px-8 py-6">
            {/* Team 1 */}
            <div className={`flex flex-col items-center gap-3 flex-1 ${isCompleted && !team1Won ? 'opacity-40' : ''}`}>
              <TeamLogo name={team1Name} gradient={team1Won ? 'linear-gradient(135deg,#ff4655,#c0392b)' : 'linear-gradient(135deg,#3b82f6,#1d4ed8)'} />
              <div className="text-center">
                <p className={`font-black text-xl tracking-wide ${team1Won ? 'text-[#ff4655]' : 'text-white'}`}>
                  {team1Name.toUpperCase().substring(0, 6)}
                </p>
                <p className="text-gray-500 text-xs mt-0.5">{team1Name}</p>
              </div>
            </div>

            {/* Score */}
            <div className="flex flex-col items-center gap-3 px-10 flex-shrink-0">
              {isCompleted ? (
                <div className="flex items-center gap-5">
                  <span className={`text-6xl font-black ${team1Won ? 'text-white' : 'text-gray-600'}`}>{s1}</span>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-gray-600 text-2xl font-black">:</span>
                    <span className={`text-xs font-bold uppercase px-3 py-1 rounded-full ${statusBadge.cls}`}>
                      {statusBadge.label}
                    </span>
                  </div>
                  <span className={`text-6xl font-black ${team2Won ? 'text-white' : 'text-gray-600'}`}>{s2}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-5xl font-black text-gray-700">VS</span>
                  <span className={`text-xs font-bold uppercase px-3 py-1 rounded-full ${statusBadge.cls}`}>
                    {statusBadge.label}
                  </span>
                </div>
              )}

              {/* Date/Time */}
              {(match.date || match.time) && (
                <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                  {match.date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(`${match.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                  {match.time && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {match.time}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Team 2 */}
            <div className={`flex flex-col items-center gap-3 flex-1 ${isCompleted && !team2Won ? 'opacity-40' : ''}`}>
              <TeamLogo name={team2Name} gradient={team2Won ? 'linear-gradient(135deg,#ff4655,#c0392b)' : 'linear-gradient(135deg,#8b5cf6,#6d28d9)'} />
              <div className="text-center">
                <p className={`font-black text-xl tracking-wide ${team2Won ? 'text-[#ff4655]' : 'text-white'}`}>
                  {team2Name.toUpperCase().substring(0, 6)}
                </p>
                <p className="text-gray-500 text-xs mt-0.5">{team2Name}</p>
              </div>
            </div>
          </div>

          {/* Tournament info strip */}
          <div className="border-t border-[#2a2d3a] px-6 py-3 flex items-center justify-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-[#ff4655]" />
            <span className="text-gray-400 text-xs">{tournament.name}</span>
            <span className="text-gray-600 text-xs">·</span>
            <span className="text-gray-500 text-xs">Round {match.round + 1}</span>
          </div>

        </div>

        {/* ── Map Results ────────────────────────────────────────────────── */}
        {hasMaps && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Map className="w-4 h-4 text-gray-400" />
              <h2 className="text-gray-300 text-sm font-bold uppercase tracking-wider">Map Results</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {match.maps!.map((m, i) => {
                if (!isPlayedMap(m)) return null; // hide unplayed placeholder slots
                const t1wins = m.team1Score > m.team2Score;
                const t2wins = m.team2Score > m.team1Score;
                const clickable = mapsWithStats && !!m.playerStats && m.playerStats.length > 0;
                const isSelected = clickable && i === safeMapIndex;
                return (
                  <div
                    key={i}
                    onClick={() => clickable && setSelectedMapIndex(i)}
                    className={`bg-[#151821] border rounded-xl p-4 text-center transition-all ${
                      isSelected
                        ? 'border-[#ff4655] ring-1 ring-[#ff4655]/40'
                        : 'border-[#2a2d3a]'
                    } ${clickable ? 'cursor-pointer hover:border-[#ff4655]/60' : ''}`}
                  >
                    <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                      {m.mapName || `Map ${i + 1}`}
                    </p>
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <span className={`text-3xl font-black ${t1wins ? 'text-white' : 'text-gray-600'}`}>{m.team1Score}</span>
                      <span className="text-gray-600 text-xl font-bold">:</span>
                      <span className={`text-3xl font-black ${t2wins ? 'text-white' : 'text-gray-600'}`}>{m.team2Score}</span>
                    </div>
                    {(t1wins || t2wins) && (
                      <p className={`text-xs font-bold ${t1wins ? 'text-[#ff4655]' : 'text-[#a78bfa]'}`}>
                        {t1wins ? team1Name : team2Name} wins
                      </p>
                    )}
                    {clickable && (
                      <p className="text-[10px] text-gray-600 mt-2 uppercase tracking-wider">
                        {isSelected ? 'Viewing scoreboard' : 'Click for scoreboard'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Stream ─────────────────────────────────────────────────────── */}
        {match.streamUrl && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Youtube className="w-4 h-4 text-[#ff4655]" />
              <h2 className="text-gray-300 text-sm font-bold uppercase tracking-wider">Stream</h2>
            </div>
            {youtubeEmbedUrl(match.streamUrl) ? (
              <button
                onClick={() => setStreamPopup(youtubeEmbedUrl(match.streamUrl!))}
                className="group relative w-full rounded-xl overflow-hidden border border-[#2a2d3a] bg-black hover:border-[#ff4655]/50 transition-colors"
                style={{ aspectRatio: '16 / 9' }}
              >
                {youtubeThumb(match.streamUrl) ? (
                  <img
                    src={youtubeThumb(match.streamUrl)!}
                    alt="Match stream"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <Youtube className="absolute inset-0 m-auto w-12 h-12 text-gray-600" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/30 transition-colors">
                  <div className="w-16 h-16 rounded-full bg-[#ff4655] flex items-center justify-center shadow-lg">
                    <Play className="w-7 h-7 text-white fill-white ml-1" />
                  </div>
                </div>
              </button>
            ) : (
              <a
                href={match.streamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-[#151821] border border-[#2a2d3a] rounded-xl px-4 py-3 text-[#ff4655] text-sm hover:border-[#ff4655]/50 transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> Watch stream
              </a>
            )}
          </div>
        )}

        {/* ── Clips ──────────────────────────────────────────────────────── */}
        {(match.clips ?? []).length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Play className="w-4 h-4 text-[#ff4655]" />
              <h2 className="text-gray-300 text-sm font-bold uppercase tracking-wider">Clips</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(match.clips ?? []).filter(c => c.url).map(clip => {
                const thumb = youtubeThumb(clip.url);
                return (
                  <a
                    key={clip.id}
                    href={clip.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group bg-[#151821] border border-[#2a2d3a] rounded-xl overflow-hidden hover:border-[#ff4655]/50 transition-colors"
                  >
                    <div className="relative bg-black flex items-center justify-center" style={{ aspectRatio: '16 / 9' }}>
                      {thumb ? (
                        <img src={thumb} alt={clip.title || 'Clip'} className="w-full h-full object-cover" />
                      ) : (
                        <Youtube className="w-10 h-10 text-gray-600" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="w-12 h-12 rounded-full bg-[#ff4655] flex items-center justify-center">
                          <Play className="w-5 h-5 text-white fill-white ml-0.5" />
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="text-white text-sm font-semibold truncate">
                        {clip.title || 'Untitled clip'}
                      </p>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Player Stats ───────────────────────────────────────────────── */}
        {hasAnyTeamPlayers && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-gray-400" />
              <h2 className="text-gray-300 text-sm font-bold uppercase tracking-wider">Player Stats</h2>
              {mapsWithStats && (match.maps?.length ?? 0) > 1 && (
                <span className="ml-2 text-[#ff4655] text-xs font-bold uppercase tracking-wider">
                  · {isTotalView ? 'Total' : (match.maps?.[safeMapIndex]?.mapName || `Map ${safeMapIndex + 1}`)}
                </span>
              )}
            </div>

            {/* Map / Total selector — only when multiple maps carry stats */}
            {mapsWithStats && (match.maps?.length ?? 0) > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                <button
                  onClick={() => setSelectedMapIndex(-1)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isTotalView ? 'bg-[#ff4655] text-white' : 'bg-[#151821] border border-[#2a2d3a] text-gray-400 hover:text-white hover:border-[#ff4655]/50'
                  }`}
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
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        !isTotalView && safeMapIndex === i ? 'bg-[#ff4655] text-white' : 'bg-[#151821] border border-[#2a2d3a] text-gray-400 hover:text-white hover:border-[#ff4655]/50'
                      }`}
                    >
                      {m.mapName || `Map ${i + 1}`}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="space-y-4">
              <StatsTable
                teamName={team1Name}
                teamStats={team1Stats}
                accentColor="#ff4655"
                tournamentId={tournament.id}
                rosterPlayers={team1?.players ?? []}
              />
              <StatsTable
                teamName={team2Name}
                teamStats={team2Stats}
                accentColor="#a78bfa"
                tournamentId={tournament.id}
                rosterPlayers={team2?.players ?? []}
              />
            </div>
          </div>
        )}

        {/* ── Player Rosters (always shown) ─────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-4 h-4 text-gray-400" />
            <h2 className="text-gray-300 text-sm font-bold uppercase tracking-wider">Player Rosters</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Team 1 */}
            <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a2d3a] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
                <h3 className="text-white font-bold text-sm">{team1Name}</h3>
                {team1 && <span className="ml-auto text-gray-600 text-xs">{team1.players.length} players</span>}
              </div>
              {team1 && team1.players.length > 0 ? (
                team1.players.map((player, i) => (
                  <div key={player.id} onClick={() => navigate(`/player/${tournament.id}/${player.id}`)} className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2d3a] last:border-0 hover:bg-[#0d0f16] transition-colors cursor-pointer">
                    <span className="text-gray-600 text-xs w-4 text-center">{i + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#ff4655]/30 to-[#ff4655]/10 flex items-center justify-center text-[#ff4655] text-xs font-bold flex-shrink-0">
                      {player.name.substring(0, 1).toUpperCase()}
                    </div>
                    <span className="text-white text-sm font-semibold flex-1 truncate">{player.name}</span>
                    {player.role && (
                      <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${getRoleColor(player.role)}`}>
                        {player.role}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-gray-600 text-sm">No players listed</div>
              )}
            </div>

            {/* Team 2 */}
            <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2a2d3a] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#8b5cf6]" />
                <h3 className="text-white font-bold text-sm">{team2Name}</h3>
                {team2 && <span className="ml-auto text-gray-600 text-xs">{team2.players.length} players</span>}
              </div>
              {team2 && team2.players.length > 0 ? (
                team2.players.map((player, i) => (
                  <div key={player.id} onClick={() => navigate(`/player/${tournament.id}/${player.id}`)} className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2d3a] last:border-0 hover:bg-[#0d0f16] transition-colors cursor-pointer">
                    <span className="text-gray-600 text-xs w-4 text-center">{i + 1}</span>
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#8b5cf6]/30 to-[#8b5cf6]/10 flex items-center justify-center text-[#8b5cf6] text-xs font-bold flex-shrink-0">
                      {player.name.substring(0, 1).toUpperCase()}
                    </div>
                    <span className="text-white text-sm font-semibold flex-1 truncate">{player.name}</span>
                    {player.role && (
                      <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${getRoleColor(player.role)}`}>
                        {player.role}
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-gray-600 text-sm">No players listed</div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Stream popup modal */}
      {streamPopup && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setStreamPopup(null)}
        >
          <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end mb-2">
              <button
                onClick={() => setStreamPopup(null)}
                className="text-gray-300 hover:text-white transition-colors p-2"
                aria-label="Close stream"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="relative w-full rounded-xl overflow-hidden border border-[#2a2d3a] bg-black" style={{ aspectRatio: '16 / 9' }}>
              <iframe
                src={`${streamPopup}?autoplay=1`}
                title="Match stream"
                className="absolute inset-0 w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
