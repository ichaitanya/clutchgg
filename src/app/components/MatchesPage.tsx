import { useState, useEffect } from 'react';
import { Header } from './Header';
import { LiveMatch } from './LiveMatch';
import { useNavigate } from 'react-router-dom';
import type { AdminData } from './AdminPanel';

const STORAGE_KEY = 'vct_admin_data';

export function MatchesPage() {
  const navigate = useNavigate();
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setAdminData(JSON.parse(stored));
    } catch {}
  }, []);

  // Derive matches from admin data
  const liveMatches = adminData
    ? adminData.matches.filter(m => m.status === 'live' && m.visible)
    : [];

  const upcomingMatches = adminData
    ? adminData.matches.filter(m => m.status === 'upcoming' && m.visible)
    : [];

  const completedMatches = adminData
    ? adminData.matches.filter(m => m.status === 'completed' && m.visible)
    : [];

  // Default matches if no admin data
  const defaultLive = [
    { id: '1', team1: 'Paper Rex', team2: 'Fnatic', score1: 11, score2: 8, map: 'Bind - Round 19/24', viewers: '125K', status: 'live' as const, tournament: '', date: '', time: '', visible: true },
    { id: '2', team1: 'Loud', team2: 'Evil Geniuses', score1: 9, score2: 6, map: 'Haven - Round 15/24', viewers: '98K', status: 'live' as const, tournament: '', date: '', time: '', visible: true },
  ];

  const defaultUpcoming = [
    { id: '3', team1: 'Team Liquid', team2: 'DRX', score1: 0, score2: 0, map: '', viewers: '', status: 'upcoming' as const, tournament: 'VCT Masters - Playoffs', date: 'May 20', time: '14:00 PST', visible: true },
    { id: '4', team1: '100 Thieves', team2: 'Sentinels', score1: 0, score2: 0, map: '', viewers: '', status: 'upcoming' as const, tournament: 'VCT Masters - Playoffs', date: 'May 20', time: '17:00 PST', visible: true },
    { id: '5', team1: 'NRG', team2: 'Cloud9', score1: 0, score2: 0, map: '', viewers: '', status: 'upcoming' as const, tournament: 'VCT Masters - Playoffs', date: 'May 21', time: '12:00 PST', visible: true },
  ];

  return (
    <div className="min-h-screen bg-[#0d0f16]">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Live Matches */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white text-2xl font-bold flex items-center gap-2">
              <div className="w-1 h-8 bg-[#ff4655] rounded" />
              Live Matches
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveMatches && liveMatches.length > 0 ? (
              liveMatches.map(m => (
                <LiveMatch
                  key={m.id}
                  team1={m.team1}
                  team2={m.team2}
                  score1={m.score1}
                  score2={m.score2}
                  map={m.map}
                  viewers={m.viewers}
                  matchId={m.id}
                />
              ))
            ) : !adminData ? (
              defaultLive.map(m => (
                <LiveMatch
                  key={m.id}
                  team1={m.team1}
                  team2={m.team2}
                  score1={m.score1}
                  score2={m.score2}
                  map={m.map}
                  viewers={m.viewers}
                  matchId={m.id}
                />
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-gray-600 text-sm bg-[#151821] rounded-xl border border-[#2a2d3a]">
                No live matches right now
              </div>
            )}
          </div>
        </section>

        {/* Upcoming Matches */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white text-2xl font-bold flex items-center gap-2">
              <div className="w-1 h-8 bg-[#ff4655] rounded" />
              Upcoming Matches
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingMatches && upcomingMatches.length > 0 ? (
              upcomingMatches.map(m => (
                <div key={m.id} className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4 cursor-pointer hover:border-[#ff4655]/30 transition-colors" onClick={() => navigate(`/match/${m.id}`)}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-700 rounded flex items-center justify-center text-white text-xs font-bold">
                          {m.team1.substring(0, 2)}
                        </div>
                        <span className="text-white text-sm">{m.team1}</span>
                      </div>
                      <span className="text-gray-500 text-xs mx-4">vs</span>
                      <div className="flex items-center gap-3">
                        <span className="text-white text-sm">{m.team2}</span>
                        <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-700 rounded flex items-center justify-center text-white text-xs font-bold">
                          {m.team2.substring(0, 2)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 pt-3 border-t border-[#2a2d3a]">
                    <div className="flex justify-between">
                      <span>{m.tournament}</span>
                      <span>{m.date} {m.time}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : !adminData ? (
              defaultUpcoming.map(m => (
                <div key={m.id} className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4 cursor-pointer hover:border-[#ff4655]/30 transition-colors" onClick={() => navigate(`/match/${m.id}`)}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-700 rounded flex items-center justify-center text-white text-xs font-bold">
                          {m.team1.substring(0, 2)}
                        </div>
                        <span className="text-white text-sm">{m.team1}</span>
                      </div>
                      <span className="text-gray-500 text-xs mx-4">vs</span>
                      <div className="flex items-center gap-3">
                        <span className="text-white text-sm">{m.team2}</span>
                        <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-700 rounded flex items-center justify-center text-white text-xs font-bold">
                          {m.team2.substring(0, 2)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 pt-3 border-t border-[#2a2d3a]">
                    <div className="flex justify-between">
                      <span>{m.tournament}</span>
                      <span>{m.date} {m.time}</span>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full text-center py-12 text-gray-600 text-sm bg-[#151821] rounded-xl border border-[#2a2d3a]">
                No upcoming matches scheduled
              </div>
            )}
          </div>
        </section>

        {/* Completed Matches */}
        {completedMatches && completedMatches.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-2xl font-bold flex items-center gap-2">
                <div className="w-1 h-8 bg-[#ff4655] rounded" />
                Completed Matches
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {completedMatches.map(m => (
                <div key={m.id} className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4 cursor-pointer hover:border-[#ff4655]/30 transition-colors" onClick={() => navigate(`/match/${m.id}`)}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-700 rounded-md flex items-center justify-center text-white font-bold text-xs">
                          {m.team1.substring(0, 2)}
                        </div>
                        <span className="text-white font-semibold text-sm">{m.team1}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-md flex items-center justify-center text-white font-bold text-xs">
                          {m.team2.substring(0, 2)}
                        </div>
                        <span className="text-white font-semibold text-sm">{m.team2}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="text-xl font-bold text-white">{m.score1}</div>
                      <div className="text-xl font-bold text-white">{m.score2}</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 text-center pt-3 border-t border-[#2a2d3a]">
                    {m.map}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
