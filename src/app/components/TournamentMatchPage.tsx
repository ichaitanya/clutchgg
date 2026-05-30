import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, Trophy, Users, Shield, Clock, Calendar, Map, Loader } from 'lucide-react';
import { Header } from './Header';
import type { AdminData } from './AdminPanel';
import type { Tournament, BracketMatch, TeamInTournament, MatchPlayerStat, MatchMapResult } from './TournamentCreation';
import { fetchMatchDataFromAPI } from './TournamentCreation';

const STORAGE_KEY = 'vct_admin_data';

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
          status: match.winner ? 'completed' : getMatchStatus(match.date, match.time),
        };
      }
    }
  }
  return null;
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

function StatsTable({ teamName, teamId, stats, accentColor }: {
  teamName: string;
  teamId: string;
  stats: MatchPlayerStat[];
  accentColor: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('acs');
  const teamStats = stats.filter(s => s.teamId === teamId);
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
              return (
                <tr key={s.playerId} className={`border-b border-[#2a2d3a] last:border-0 ${i % 2 === 0 ? 'bg-[#0d0f16]/40' : ''}`}>
                  <td className="px-5 py-3">
                    <span className="text-white font-semibold text-sm">{s.playerName}</span>
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
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) { setNotFound(true); return; }
      const adminData: AdminData = JSON.parse(stored);
      if (!matchId) { setNotFound(true); return; }
      const result = findMatchInTournaments(matchId, adminData.tournaments ?? []);
      if (result) setCtx(result);
      else setNotFound(true);
    } catch {
      setNotFound(true);
    }
  }, [matchId]);

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

  const handleFetchMatchData = async () => {
    setIsFetching(true);
    setFetchError(null);
    try {
      const result = await fetchMatchDataFromAPI(team1, team2, match);
      if (!result) {
        setFetchError('No recent match found with both teams.');
        setIsFetching(false);
        return;
      }

      // Update match with fetched data
      const adminData: AdminData = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const updatedTournaments = adminData.tournaments?.map(t => {
        if (t.id !== tournament.id) return t;
        return {
          ...t,
          generatedBracket: t.generatedBracket ? updateBracketMatch(t.generatedBracket, match.id, result) : undefined,
          stage1Bracket: t.stage1Bracket ? updateBracketMatch(t.stage1Bracket, match.id, result) : undefined,
          stage2Bracket: t.stage2Bracket ? updateBracketMatch(t.stage2Bracket, match.id, result) : undefined,
        };
      }) ?? [];

      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...adminData, tournaments: updatedTournaments }));

      // Update context
      const updated = findMatchInTournaments(match.id, updatedTournaments);
      if (updated) setCtx(updated);

      setIsFetching(false);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch match data');
      setIsFetching(false);
    }
  };

  const updateBracketMatch = (bracket: { rounds: BracketMatch[][] }, matchId: string, result: { maps: MatchMapResult[]; playerStats: MatchPlayerStat[] }) => {
    return {
      rounds: bracket.rounds.map(round =>
        round.map(m => m.id === matchId ? { ...m, maps: result.maps, playerStats: result.playerStats } : m)
      ),
    };
  };

  const team1Name = team1?.name ?? match.team1Name;
  const team2Name = team2?.name ?? match.team2Name;
  const isCompleted = status === 'completed' || !!match.winner;
  const team1Won = match.winner === match.team1Id;
  const team2Won = match.winner === match.team2Id;

  const { s1, s2 } = deriveScore(match);

  const hasMaps = match.maps && match.maps.length > 0;

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
  // Per-map stats: if maps carry their own playerStats, use the selected map's stats.
  const mapsWithStats = (match.maps ?? []).some(m => m.playerStats && m.playerStats.length > 0);
  const safeMapIndex = Math.min(selectedMapIndex, (match.maps?.length ?? 1) - 1);
  const selectedMapStats = mapsWithStats ? match.maps?.[safeMapIndex]?.playerStats : undefined;
  const effectiveStats: MatchPlayerStat[] =
    (selectedMapStats && selectedMapStats.length > 0)
      ? selectedMapStats
      : (match.playerStats && match.playerStats.length > 0)
      ? match.playerStats
      : buildDefaultStats();
  const hasAnyTeamPlayers = (team1?.players.length ?? 0) > 0 || (team2?.players.length ?? 0) > 0;

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

          {/* Fetch Match Data button */}
          <div className="border-t border-[#2a2d3a] px-6 py-3 flex flex-col gap-3 items-center">
            <button
              onClick={handleFetchMatchData}
              disabled={isFetching}
              className="px-4 py-2 text-sm bg-[#ff4655]/20 hover:bg-[#ff4655]/30 disabled:opacity-50 disabled:cursor-not-allowed text-[#ff4655] border border-[#ff4655]/50 rounded-lg transition-colors font-semibold flex items-center gap-2"
            >
              {isFetching && <Loader className="w-4 h-4 animate-spin" />}
              {isFetching ? 'Fetching...' : 'Fetch Match Data'}
            </button>
            {fetchError && (
              <p className="text-xs text-[#ff4655] bg-[#ff4655]/10 px-3 py-2 rounded border border-[#ff4655]/30">
                {fetchError}
              </p>
            )}
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

        {/* ── Player Stats ───────────────────────────────────────────────── */}
        {hasAnyTeamPlayers && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-4 h-4 text-gray-400" />
              <h2 className="text-gray-300 text-sm font-bold uppercase tracking-wider">Player Stats</h2>
              {mapsWithStats && (match.maps?.length ?? 0) > 1 && (
                <span className="ml-2 text-[#ff4655] text-xs font-bold uppercase tracking-wider">
                  · {match.maps?.[safeMapIndex]?.mapName || `Map ${safeMapIndex + 1}`}
                </span>
              )}
            </div>
            <div className="space-y-4">
              <StatsTable
                teamName={team1Name}
                teamId={match.team1Id}
                stats={effectiveStats}
                accentColor="#ff4655"
              />
              <StatsTable
                teamName={team2Name}
                teamId={match.team2Id}
                stats={effectiveStats}
                accentColor="#a78bfa"
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
                  <div key={player.id} className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2d3a] last:border-0 hover:bg-[#0d0f16] transition-colors">
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
                  <div key={player.id} className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2d3a] last:border-0 hover:bg-[#0d0f16] transition-colors">
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
    </div>
  );
}
