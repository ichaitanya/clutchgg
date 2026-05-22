import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { LiveMatch } from './components/LiveMatch';
import { UpcomingMatch } from './components/UpcomingMatch';
import { Standings } from './components/Standings';
import { NewsCard } from './components/NewsCard';
import { AdminPanel } from './components/AdminPanel';
import { MatchScoreboard } from './components/MatchScoreboard';
import { MatchesPage } from './components/MatchesPage';
import { TrendingUp } from 'lucide-react';
import type { AdminData } from './components/AdminPanel';

const STORAGE_KEY = 'vct_admin_data';

function Home() {
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setAdminData(JSON.parse(stored));
    } catch {}
  }, []);

  const handleDataChange = (data: AdminData) => setAdminData(data);

  // Derive display data from admin data if available
  const liveMatches = adminData
    ? adminData.matches.filter(m => m.status === 'live' && m.visible)
    : null;
  const upcomingMatches = adminData
    ? adminData.matches.filter(m => m.status === 'upcoming' && m.visible)
    : null;
  const standings = adminData ? adminData.standings : null;
  const news = adminData ? adminData.news.filter(n => n.visible) : null;

  return (
    <div className="min-h-screen bg-[#0d0f16]">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <HeroSection />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 space-y-6">

            {/* Live Matches */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white text-xl font-bold flex items-center gap-2">
                  <div className="w-1 h-6 bg-[#ff4655] rounded" />
                  Live Matches
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {liveMatches && liveMatches.length > 0 ? (
                  liveMatches.map(m => (
                    <LiveMatch
                      key={m.id}
                      team1={m.team1} team2={m.team2}
                      score1={m.score1} score2={m.score2}
                      map={m.map} viewers={m.viewers}
                      matchId={m.id}
                    />
                  ))
                ) : !adminData ? (
                  <>
                    <LiveMatch team1="Paper Rex" team2="Fnatic" score1={11} score2={8} map="Bind - Round 19/24" viewers="125K" matchId="1" />
                    <LiveMatch team1="Loud" team2="Evil Geniuses" score1={9} score2={6} map="Haven - Round 15/24" viewers="98K" matchId="2" />
                  </>
                ) : (
                  <div className="col-span-2 text-center py-8 text-gray-600 text-sm bg-[#151821] rounded-xl border border-[#2a2d3a]">
                    No live matches right now
                  </div>
                )}
              </div>
            </section>

            {/* Upcoming Matches */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white text-xl font-bold flex items-center gap-2">
                  <div className="w-1 h-6 bg-[#ff4655] rounded" />
                  Upcoming Matches
                </h2>
                <button className="text-[#ff4655] text-sm hover:underline">View all</button>
              </div>
              <div className="space-y-3">
                {upcomingMatches && upcomingMatches.length > 0 ? (
                  upcomingMatches.map(m => (
                    <UpcomingMatch
                      key={m.id}
                      team1={m.team1} team2={m.team2}
                      tournament={m.tournament}
                      date={m.date} time={m.time}
                      matchId={m.id}
                    />
                  ))
                ) : !adminData ? (
                  <>
                    <UpcomingMatch team1="Team Liquid" team2="DRX" tournament="VCT Masters - Playoffs" date="May 20" time="14:00 PST" matchId="3" />
                    <UpcomingMatch team1="100 Thieves" team2="Sentinels" tournament="VCT Masters - Playoffs" date="May 20" time="17:00 PST" matchId="4" />
                    <UpcomingMatch team1="NRG" team2="Cloud9" tournament="VCT Masters - Playoffs" date="May 21" time="12:00 PST" matchId="5" />
                  </>
                ) : (
                  <div className="text-center py-8 text-gray-600 text-sm bg-[#151821] rounded-xl border border-[#2a2d3a]">
                    No upcoming matches scheduled
                  </div>
                )}
              </div>
            </section>

            {/* Latest News */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white text-xl font-bold flex items-center gap-2">
                  <div className="w-1 h-6 bg-[#ff4655] rounded" />
                  Latest News
                </h2>
                <button className="text-[#ff4655] text-sm hover:underline">View all</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {news && news.length > 0 ? (
                  news.map(n => (
                    <NewsCard key={n.id} title={n.title} category={n.category} timeAgo={n.timeAgo} imageUrl={n.imageUrl} />
                  ))
                ) : !adminData ? (
                  <>
                    <NewsCard title="Paper Rex dominate in opening match with flawless attacking rounds" category="MATCH RECAP" timeAgo="2 hours ago" imageUrl="https://images.unsplash.com/photo-1558008258-7ff8888b42b0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080" />
                    <NewsCard title="Masters playoffs bracket revealed: Top seeds face tough competition" category="TOURNAMENT" timeAgo="5 hours ago" imageUrl="https://images.unsplash.com/photo-1548686304-5c3be888a00b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080" />
                  </>
                ) : (
                  <div className="col-span-2 text-center py-8 text-gray-600 text-sm bg-[#151821] rounded-xl border border-[#2a2d3a]">
                    No news articles
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {standings ? (
              <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg overflow-hidden">
                <div className="bg-[#151821] px-4 py-3 border-b border-[#2a2d3a]">
                  <h3 className="text-white font-semibold">Group Standings</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#151821]">
                      <tr className="text-gray-400 text-xs uppercase">
                        <th className="px-4 py-3 text-left">Rank</th>
                        <th className="px-4 py-3 text-left">Team</th>
                        <th className="px-4 py-3 text-center">W</th>
                        <th className="px-4 py-3 text-center">L</th>
                        <th className="px-4 py-3 text-center">Win%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((team, index) => {
                        const total = team.wins + team.losses;
                        const wr = total === 0 ? '0%' : `${Math.round((team.wins / total) * 100)}%`;
                        return (
                          <tr key={team.id} className="border-t border-[#2a2d3a] hover:bg-[#151821] transition-colors">
                            <td className="px-4 py-3">
                              <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${team.rank <= 3 ? 'bg-[#ff4655] text-white' : 'bg-[#2a2d3a] text-gray-400'}`}>
                                {team.rank}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded bg-gradient-to-br ${index % 3 === 0 ? 'from-blue-500 to-blue-700' : index % 3 === 1 ? 'from-red-500 to-red-700' : 'from-purple-500 to-purple-700'} flex items-center justify-center text-white text-xs font-bold`}>
                                  {team.name.substring(0, 2)}
                                </div>
                                <span className="text-white text-sm">{team.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center text-green-400 text-sm font-semibold">{team.wins}</td>
                            <td className="px-4 py-3 text-center text-red-400 text-sm font-semibold">{team.losses}</td>
                            <td className="px-4 py-3 text-center text-gray-300 text-sm">{wr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <Standings />
            )}

             {/* Top Players — driven by admin data if available */}
                        <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4">
                          <div className="flex items-center gap-2 mb-4">
                            <TrendingUp className="w-5 h-5 text-[#ff4655]" />
                            <h3 className="text-white font-semibold">Top Players</h3>
                          </div>
                          <div className="space-y-3">
                            {(adminData?.players && adminData.players.length > 0
                              ? [...adminData.players].sort((a, b) => a.rank - b.rank)
                              : [
                                  { id: '1', rank: 1, name: 'jinggg', team: 'PRX', rating: 1.42, kills: 275, deaths: 189 },
                                  { id: '2', rank: 2, name: 'Derke', team: 'FNC', rating: 1.38, kills: 268, deaths: 195 },
                                  { id: '3', rank: 3, name: 'aspas', team: 'LOUD', rating: 1.35, kills: 261, deaths: 198 },
                                  { id: '4', rank: 4, name: 'Demon1', team: 'EG', rating: 1.31, kills: 245, deaths: 192 },
                                ]
                            ).map((player, index) => (
                              <div key={player.id} className="flex items-center justify-between p-2 rounded hover:bg-[#151821] transition-colors">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                                    {player.rank}
                                  </div>
                                  <div>
                                    <div className="text-white text-sm font-semibold">{player.name}</div>
                                    <div className="text-gray-400 text-xs">{player.team}</div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="text-[#ff4655] text-sm font-bold">{player.rating.toFixed(2)}</div>
                                  <div className="text-gray-400 text-xs">{player.kills}/{player.deaths}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </main>
                </div>
  );
}

function AdminPage() {
  return (
    <div className="min-h-screen bg-[#0d0f16]">
      <AdminPanel onClose={() => {}} onDataChange={() => {}} />
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/matches" element={<MatchesPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/match/:matchId" element={<MatchScoreboard />} />
      </Routes>
    </Router>
  );
}
