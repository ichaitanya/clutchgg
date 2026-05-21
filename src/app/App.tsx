import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { LiveMatch } from './components/LiveMatch';
import { UpcomingMatch } from './components/UpcomingMatch';
import { Standings } from './components/Standings';
import { NewsCard } from './components/NewsCard';
import { AdminPanel } from './components/AdminPanel';
import { TrendingUp, Settings } from 'lucide-react';
import type { AdminData } from './components/AdminPanel';

const STORAGE_KEY = 'vct_admin_data';

export default function App() {
  const [showAdmin, setShowAdmin] = useState(false);
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
      {showAdmin && (
        <AdminPanel
          onClose={() => setShowAdmin(false)}
          onDataChange={handleDataChange}
        />
      )}

      <Header />

      {/* Admin toggle button */}
      <div className="fixed bottom-6 left-6 z-40">
        <button
          onClick={() => setShowAdmin(true)}
          className="flex items-center gap-2 bg-[#1e2130] hover:bg-[#2a2d3a] border border-[#2a2d3a] hover:border-[#ff4655]/40 text-gray-400 hover:text-[#ff4655] text-sm font-medium px-4 py-2.5 rounded-xl transition-all shadow-xl"
        >
          <Settings className="w-4 h-4" />
          Admin Panel
        </button>
      </div>

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
                    />
                  ))
                ) : !adminData ? (
                  <>
                    <LiveMatch team1="Paper Rex" team2="Fnatic" score1={11} score2={8} map="Bind - Round 19/24" viewers="125K" />
                    <LiveMatch team1="Loud" team2="Evil Geniuses" score1={9} score2={6} map="Haven - Round 15/24" viewers="98K" />
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
                    />
                  ))
                ) : !adminData ? (
                  <>
                    <UpcomingMatch team1="Team Liquid" team2="DRX" tournament="VCT Masters - Playoffs" date="May 20" time="14:00 PST" />
                    <UpcomingMatch team1="100 Thieves" team2="Sentinels" tournament="VCT Masters - Playoffs" date="May 20" time="17:00 PST" />
                    <UpcomingMatch team1="NRG" team2="Cloud9" tournament="VCT Masters - Playoffs" date="May 21" time="12:00 PST" />
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

            {/* Top Players (always static) */}
            <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-[#ff4655]" />
                <h3 className="text-white font-semibold">Top Players</h3>
              </div>
              <div className="space-y-3">
                {[
                  { name: "Mercury", team: "F5", rating: 1.42, kd: "275/189" },
                  { name: "Mercury", team: "F5", rating: 1.38, kd: "268/195" },
                  { name: "Tswagg", team: "F5", rating: 1.35, kd: "261/198" },
                  { name: "KunduOP", team: "F5", rating: 0.81, kd: "69/96" },
                ].map((player, index) => (
                  <div key={index} className="flex items-center justify-between p-2 rounded hover:bg-[#151821] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <div className="text-white text-sm font-semibold">{player.name}</div>
                        <div className="text-gray-400 text-xs">{player.team}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[#ff4655] text-sm font-bold">{player.rating}</div>
                      <div className="text-gray-400 text-xs">{player.kd}</div>
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
