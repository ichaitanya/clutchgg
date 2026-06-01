import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, User, Trophy, Shield } from 'lucide-react';
import { Header } from './Header';
import type {
  Tournament,
  TeamInTournament,
  TournamentPlayer,
  MatchPlayerStat,
} from './TournamentCreation';
import { getStageOptions, statMatchesPlayer } from './StatsPage';
import { getTournaments } from '../services/db';

// One played map's stat line for this player, tagged with where it happened.
interface PlayerMapStat extends MatchPlayerStat {
  matchId: string;
  stageLabel: string;
  opponentName: string;
  mapName: string;
  date?: string;
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
          out.push({
            ...s,
            matchId: match.id,
            stageLabel: stage.label,
            opponentName: opponentName || teamNameById[opponentId] || 'TBD',
            mapName: map.mapName || '—',
            date: match.date,
          });
        }
      }
    }
  }
  return out;
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

export function PlayerPage() {
  const { tournamentId = '', playerId = '' } = useParams();
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTournaments()
      .then(setTournaments)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tournament = useMemo(
    () => tournaments.find(t => t.id === tournamentId) || null,
    [tournaments, tournamentId],
  );

  const found = useMemo(
    () => (tournament ? findPlayer(tournament, playerId) : null),
    [tournament, playerId],
  );

  const mapStats = useMemo(() => {
    if (!tournament || !found) return [];
    return collectPlayerMapStats(tournament, found.player, found.team.id);
  }, [tournament, found]);

  const agg = useMemo(() => aggregate(mapStats), [mapStats]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-[#ff4655] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!tournament || !found) {
    return (
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <main className="max-w-5xl mx-auto px-4 py-16 text-center">
          <User className="w-12 h-12 mx-auto text-gray-600 mb-4" />
          <p className="text-gray-400 mb-4">Player not found</p>
          <button
            onClick={() => navigate('/teams')}
            className="text-[#ff4655] text-sm hover:underline"
          >
            Back to Teams
          </button>
        </main>
      </div>
    );
  }

  const { player, team } = found;

  const summaryCards: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'ACS', value: Math.round(agg.acs).toString(), highlight: true },
    { label: 'K/D', value: agg.kd.toFixed(2) },
    { label: 'HS%', value: `${Math.round(agg.hsPercent)}%` },
    { label: 'Maps', value: agg.mapsPlayed.toString() },
  ];

  return (
    <div className="min-h-screen bg-[#0d0f16] pb-16">
      <Header />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Back */}
        <button
          onClick={() => navigate('/teams')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm">Back to Teams</span>
        </button>

        {/* Player header */}
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            {/* Photo */}
            {player.photo ? (
              <div className="w-32 h-32 rounded-xl overflow-hidden bg-[#0d0f16] flex-shrink-0">
                <img src={player.photo} alt={player.name} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-32 h-32 rounded-xl bg-gradient-to-br from-[#ff4655]/20 to-[#ff4655]/5 flex items-center justify-center flex-shrink-0">
                <User className="w-12 h-12 text-gray-600" />
              </div>
            )}

            {/* Identity */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-white font-bold text-3xl">{player.name}</h1>
              {player.riotId && (
                <p className="text-gray-500 text-sm mt-1 font-mono">{player.riotId}</p>
              )}
              <div className="flex items-center justify-center sm:justify-start gap-3 mt-3 flex-wrap">
                <span className="flex items-center gap-1.5 text-gray-300 text-sm">
                  <Shield className="w-4 h-4 text-[#ff4655]" />
                  {team.name}
                </span>
                <span className="flex items-center gap-1.5 text-gray-300 text-sm">
                  <Trophy className="w-4 h-4 text-[#ff4655]" />
                  {tournament.name}
                </span>
                {player.role && (
                  <span className={`text-xs uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${getRoleColor(player.role)}`}>
                    {player.role}
                  </span>
                )}
              </div>
              {agg.agents.length > 0 && (
                <p className="text-gray-500 text-xs mt-3">
                  Agents played: <span className="text-gray-300">{agg.agents.join(', ')}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Summary stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {summaryCards.map(card => (
            <div
              key={card.label}
              className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-5 text-center"
            >
              <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">{card.label}</p>
              <p className={`font-bold text-2xl ${card.highlight ? 'text-[#ff4655]' : 'text-white'}`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {/* Match / map history */}
        <div>
          <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
            <div className="w-1 h-6 bg-[#ff4655] rounded" />
            Match History
          </h2>

          {mapStats.length === 0 ? (
            <div className="text-center py-12 bg-[#151821] border border-[#2a2d3a] rounded-xl">
              <p className="text-gray-400 mb-1">No stats recorded yet</p>
              <p className="text-gray-600 text-sm">
                Stats appear here once match scoreboards are applied for this player.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#2a2d3a]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#151821] text-gray-400 text-xs uppercase">
                    <th className="px-4 py-3 text-left">Stage</th>
                    <th className="px-4 py-3 text-left">Opponent</th>
                    <th className="px-4 py-3 text-left">Map</th>
                    <th className="px-4 py-3 text-left">Agent</th>
                    <th className="px-4 py-3 text-center w-28">K / D / A</th>
                    <th className="px-4 py-3 text-center w-20">ACS</th>
                    <th className="px-4 py-3 text-center w-20">HS%</th>
                  </tr>
                </thead>
                <tbody>
                  {mapStats.map((s, i) => (
                    <tr
                      key={`${s.playerId}-${i}`}
                      onClick={() => navigate(`/tournament-match/${s.matchId}`)}
                      className="border-t border-[#2a2d3a] bg-[#0d0f16] hover:bg-[#151821] transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 text-purple-400">{s.stageLabel}</td>
                      <td className="px-4 py-3 text-white">{s.opponentName}</td>
                      <td className="px-4 py-3 text-gray-300">{s.mapName}</td>
                      <td className="px-4 py-3 text-gray-400">{s.agent || '—'}</td>
                      <td className="px-4 py-3 text-center text-gray-300">
                        {s.kills} / {s.deaths} / {s.assists}
                      </td>
                      <td className="px-4 py-3 text-center text-white font-semibold">{s.acs}</td>
                      <td className="px-4 py-3 text-center text-gray-300">{s.hsPercent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
