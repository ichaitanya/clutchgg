import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowLeft, Trophy } from 'lucide-react';
import { Header } from './Header';
import type { Match } from './AdminPanel';

export interface PlayerStats {
  id: string;
  name: string;
  team: string;
  kills: number;
  deaths: number;
  assists: number;
  acs: number; // Average Combat Score
}

export interface MatchScoreboard {
  matchId: string;
  team1: string;
  team2: string;
  score1: number;
  score2: number;
  map: string;
  rounds: number;
  team1Players: PlayerStats[];
  team2Players: PlayerStats[];
}

const SCOREBOARD_KEY = 'vct_match_scoreboards';

// Default scoreboard data
const defaultScoreboards: MatchScoreboard[] = [
  {
    matchId: '1',
    team1: 'Paper Rex',
    team2: 'Fnatic',
    score1: 13,
    score2: 11,
    map: 'Bind',
    rounds: 24,
    team1Players: [
      { id: '1', name: 'jinggg', team: 'PRX', kills: 24, deaths: 18, assists: 5, acs: 284 },
      { id: '2', name: 'mindfreak', team: 'PRX', kills: 19, deaths: 16, assists: 8, acs: 256 },
      { id: '3', name: 'f0rsaken', team: 'PRX', kills: 22, deaths: 14, assists: 6, acs: 278 },
      { id: '4', name: 'davai', team: 'PRX', kills: 18, deaths: 19, assists: 10, acs: 238 },
      { id: '5', name: 'crws', team: 'PRX', kills: 16, deaths: 20, assists: 12, acs: 221 },
    ],
    team2Players: [
      { id: '6', name: 'Derke', team: 'FNC', kills: 26, deaths: 16, assists: 4, acs: 298 },
      { id: '7', name: 'Boaster', team: 'FNC', kills: 14, deaths: 18, assists: 11, acs: 198 },
      { id: '8', name: 'Alfa', team: 'FNC', kills: 20, deaths: 17, assists: 7, acs: 268 },
      { id: '9', name: 'Fit1nho', team: 'FNC', kills: 17, deaths: 19, assists: 9, acs: 242 },
      { id: '10', name: 'Brave', team: 'FNC', kills: 15, deaths: 21, assists: 11, acs: 215 },
    ],
  },
];

export function MatchScoreboard() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [scoreboard, setScoreboard] = useState<MatchScoreboard | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCOREBOARD_KEY);
      let scoreboards = stored ? JSON.parse(stored) : defaultScoreboards;
      
      if (!Array.isArray(scoreboards) || scoreboards.length === 0) {
        scoreboards = defaultScoreboards;
        localStorage.setItem(SCOREBOARD_KEY, JSON.stringify(defaultScoreboards));
      }

      const found = scoreboards.find((s: MatchScoreboard) => s.matchId === matchId);
      if (found) {
        setScoreboard(found);
      } else if (scoreboards.length > 0) {
        setScoreboard(scoreboards[0]);
      }
    } catch {
      setScoreboard(defaultScoreboards[0]);
    }
  }, [matchId]);

  if (!scoreboard) {
    return (
      <div className="min-h-screen bg-[#0d0f16] flex items-center justify-center">
        <div className="text-gray-400">Loading scoreboard...</div>
      </div>
    );
  }

  const allPlayers = [...scoreboard.team1Players, ...scoreboard.team2Players];
  const mvp = allPlayers.reduce((prev, current) => (prev.acs > current.acs) ? prev : current);

  return (
    <div className="min-h-screen bg-[#0d0f16] flex flex-col">
      <Header />
      <div className="p-6 flex-1">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 text-gray-400 hover:text-white mb-4 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </button>

          <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-8">
                <div className="text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center text-white font-bold text-xl mb-2">
                    {scoreboard.team1.substring(0, 2)}
                  </div>
                  <h2 className="text-white font-bold text-lg">{scoreboard.team1}</h2>
                </div>

                <div className="text-center">
                  <div className="text-5xl font-bold text-[#ff4655] mb-2">{scoreboard.score1}</div>
                  <div className="text-gray-400 text-sm">Round {scoreboard.rounds}</div>
                </div>

                <div className="text-center text-gray-400">vs</div>

                <div className="text-center">
                  <div className="text-5xl font-bold text-[#ff4655] mb-2">{scoreboard.score2}</div>
                  <div className="text-gray-400 text-sm">Round {scoreboard.rounds}</div>
                </div>

                <div className="text-center">
                  <div className="w-16 h-16 bg-gradient-to-br from-red-500 to-red-700 rounded-lg flex items-center justify-center text-white font-bold text-xl mb-2">
                    {scoreboard.team2.substring(0, 2)}
                  </div>
                  <h2 className="text-white font-bold text-lg">{scoreboard.team2}</h2>
                </div>
              </div>
            </div>

            <div className="text-center text-gray-400 text-sm">
              Map: <span className="text-white font-semibold">{scoreboard.map}</span>
            </div>
          </div>
        </div>

        {/* MVP Section */}
        <div className="mb-8 bg-gradient-to-r from-[#ff4655]/20 to-[#ff6670]/20 border border-[#ff4655]/30 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className="w-6 h-6 text-[#ff4655]" />
            <h3 className="text-white font-bold text-lg">Match MVP</h3>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-yellow-400 to-orange-600 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {mvp.name.substring(0, 1)}
            </div>
            <div>
              <div className="text-white font-bold text-lg">{mvp.name}</div>
              <div className="text-gray-400 text-sm">{mvp.team}</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-[#ff4655] font-bold text-lg">{mvp.acs} ACS</div>
              <div className="text-gray-400 text-sm">
                {mvp.kills}K - {mvp.deaths}D - {mvp.assists}A
              </div>
            </div>
          </div>
        </div>

        {/* Scoreboards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Team 1 */}
          <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg overflow-hidden">
            <div className="bg-[#151821] px-4 py-3 border-b border-[#2a2d3a]">
              <h3 className="text-white font-bold text-lg">{scoreboard.team1}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase bg-[#0d0f16]">
                    <th className="px-4 py-3 text-left">Player</th>
                    <th className="px-4 py-3 text-center">K</th>
                    <th className="px-4 py-3 text-center">D</th>
                    <th className="px-4 py-3 text-center">A</th>
                    <th className="px-4 py-3 text-center">ACS</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreboard.team1Players.map((player) => (
                    <tr key={player.id} className="border-t border-[#2a2d3a] hover:bg-[#151821] transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <div className="text-white font-semibold text-sm">{player.name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-green-400 font-semibold">{player.kills}</td>
                      <td className="px-4 py-3 text-center text-red-400 font-semibold">{player.deaths}</td>
                      <td className="px-4 py-3 text-center text-blue-400 font-semibold">{player.assists}</td>
                      <td className="px-4 py-3 text-center">
                        <div className={`font-bold ${player.acs >= 250 ? 'text-[#ff4655]' : 'text-gray-300'}`}>
                          {player.acs}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Team 2 */}
          <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg overflow-hidden">
            <div className="bg-[#151821] px-4 py-3 border-b border-[#2a2d3a]">
              <h3 className="text-white font-bold text-lg">{scoreboard.team2}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-xs uppercase bg-[#0d0f16]">
                    <th className="px-4 py-3 text-left">Player</th>
                    <th className="px-4 py-3 text-center">K</th>
                    <th className="px-4 py-3 text-center">D</th>
                    <th className="px-4 py-3 text-center">A</th>
                    <th className="px-4 py-3 text-center">ACS</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreboard.team2Players.map((player) => (
                    <tr key={player.id} className="border-t border-[#2a2d3a] hover:bg-[#151821] transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <div className="text-white font-semibold text-sm">{player.name}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-green-400 font-semibold">{player.kills}</td>
                      <td className="px-4 py-3 text-center text-red-400 font-semibold">{player.deaths}</td>
                      <td className="px-4 py-3 text-center text-blue-400 font-semibold">{player.assists}</td>
                      <td className="px-4 py-3 text-center">
                        <div className={`font-bold ${player.acs >= 250 ? 'text-[#ff4655]' : 'text-gray-300'}`}>
                          {player.acs}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Stats Legend */}
        <div className="mt-8 bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-400">K =</span>
              <span className="text-green-400 font-semibold ml-2">Kills</span>
            </div>
            <div>
              <span className="text-gray-400">D =</span>
              <span className="text-red-400 font-semibold ml-2">Deaths</span>
            </div>
            <div>
              <span className="text-gray-400">A =</span>
              <span className="text-blue-400 font-semibold ml-2">Assists</span>
            </div>
            <div>
              <span className="text-gray-400">ACS =</span>
              <span className="text-gray-300 font-semibold ml-2">Avg Combat Score</span>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
