import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { UpcomingMatch } from './components/UpcomingMatch';
import { Standings } from './components/Standings';
import { NewsCard } from './components/NewsCard';
import { AdminPanel } from './components/AdminPanel';
import { MatchScoreboard } from './components/MatchScoreboard';
import { MatchesPage } from './components/MatchesPage';
import { TournamentMatchPage } from './components/TournamentMatchPage';
import { TeamsPage } from './components/TeamsPage';
import { StatsPage, getTopPlayersByAcs } from './components/StatsPage';
import { computeRRStandings } from './components/BracketDisplay';
import { PlayerPage } from './components/PlayerPage';
import { ArticlePage } from './components/ArticlePage';
import { TournamentPage } from './components/TournamentPage';
import { TrendingUp } from 'lucide-react';
import type { AdminData } from './components/AdminPanel';
import { loadAdminData } from './services/db';


// Helper function to determine match status
function getMatchStatus(date?: string, time?: string) {
  if (!date) return 'upcoming';
  
  try {
    const matchDateTime = new Date(`${date}T${time || '00:00'}`);
    const now = new Date();
    const diffMs = matchDateTime.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    // Match is live if within 3 hours
    if (diffHours > -3 && diffHours < 3) return 'live';
    // Match is past if more than 3 hours ago
    if (diffHours < -3) return 'completed';
    // Otherwise upcoming
    return 'upcoming';
  } catch {
    return 'upcoming';
  }
}

function Home() {
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    loadAdminData().then(setAdminData).catch(() => {});
  }, []);

  const handleDataChange = (data: AdminData) => setAdminData(data);

  // Extract matches from tournament brackets
  const tournamentBracketMatches = adminData
    ? adminData.tournaments
      .flatMap(tournament =>
        tournament.generatedBracket
          ? tournament.generatedBracket.rounds.flat().map(match => ({
              ...match,
              status: getMatchStatus(match.date, match.time),
              tournamentName: tournament.name,
            }))
          : []
      )
    : [];

  // Derive display data: first try tournament brackets, then fall back to admin matches
  const upcomingMatches =
    tournamentBracketMatches.length > 0
      ? tournamentBracketMatches.filter(m => m.status === 'upcoming')
      : adminData
      ? adminData.matches.filter(m => m.status === 'upcoming' && m.visible)
      : null;

  const standings = adminData ? adminData.standings : null;
  const news = adminData ? adminData.news.filter(n => n.visible) : null;

  // Auto-standings: if a tournament is round-robin or group-based, compute its
  // standings tables directly for the homepage (instead of manual standings).
  type StandRow = { id: string; rank: number; name: string; wins: number; losses: number };
  const autoStandings: { tournamentName: string; groups: { title: string; rows: StandRow[] }[] } | null = (() => {
    if (!adminData) return null;
    // If the admin picked a tournament for homepage standings, consider only it;
    // otherwise fall back to the first round-robin / group-stage tournament.
    const selectedId = adminData.standingsTournamentId;
    const candidates = selectedId
      ? adminData.tournaments.filter(t => t.id === selectedId)
      : adminData.tournaments;
    for (const t of candidates) {
      // Group stage: one table per group.
      if (t.stage1Config?.format === 'groupstage' && t.stage1Bracket && (t.stage1Config.groups?.length ?? 0) > 0) {
        const groups = (t.stage1Config.groups ?? []).map(g => {
          const matches = t.stage1Bracket!.rounds.flat().filter(m => m.id.includes(`gs_${g.id}_`));
          const rrTeams = g.teams.map(tm => ({ id: tm.id, name: tm.name }));
          const rows = computeRRStandings([matches], rrTeams).map((r, i) => ({
            id: r.teamId, rank: i + 1, name: r.teamName, wins: r.wins, losses: r.losses,
          }));
          return { title: g.name, rows };
        }).filter(g => g.rows.length > 0);
        if (groups.length > 0) return { tournamentName: t.name, groups };
      }
      // Round robin (single-stage generatedBracket or stage1Bracket).
      const rr = [t.generatedBracket, t.stage1Bracket].find(b => b?.bracketType === 'roundrobin');
      if (rr) {
        const rows = computeRRStandings(rr.rounds, rr.rrTeams ?? []).map((r, i) => ({
          id: r.teamId, rank: i + 1, name: r.teamName, wins: r.wins, losses: r.losses,
        }));
        if (rows.length > 0) return { tournamentName: t.name, groups: [{ title: 'Standings', rows }] };
      }
    }
    return null;
  })();

  // Top players ranked by average ACS, computed from applied tournament match
  // stats. Falls back to admin-entered / placeholder players when no stats exist.
  const topByAcs = adminData ? getTopPlayersByAcs(adminData.tournaments, 5) : [];

  return (
    <div className="min-h-screen bg-[#0d0f16]">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6">
        <HeroSection heroLink={adminData?.heroLink} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
          <div className="lg:col-span-2 space-y-6">

            {/* Matches */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white text-xl font-bold flex items-center gap-2">
                  <div className="w-1 h-6 bg-[#ff4655] rounded" />
                  Matches
                </h2>
                <Link to="/matches" className="text-[#ff4655] text-sm hover:underline">View all</Link>
              </div>
              <div className="space-y-3">
                {upcomingMatches && upcomingMatches.length > 0 ? (
                  upcomingMatches.map(m => {
                    const isTournamentMatch = 'team1Name' in m;
                    const team1 = 'team1Name' in m ? m.team1Name : m.team1;
                    const team2 = 'team2Name' in m ? m.team2Name : m.team2;
                    const tournament = 'tournamentName' in m ? m.tournamentName : m.tournament;
                    const date = 'date' in m ? m.date : '';
                    const time = 'time' in m ? m.time : '';
                    return (
                      <UpcomingMatch
                        key={m.id}
                        team1={team1}
                        team2={team2}
                        tournament={tournament || ''}
                        date={date || ''}
                        time={time || ''}
                        matchId={m.id}
                        isTournamentMatch={isTournamentMatch}
                      />
                    );
                  })
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
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {news && news.length > 0 ? (
                  news.map(n => (
                    <NewsCard key={n.id} id={n.id} title={n.title} category={n.category} timeAgo={n.timeAgo} imageUrl={n.imageUrl} link={n.link} />
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
            {autoStandings ? (
              <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg overflow-hidden">
                <div className="bg-[#151821] px-4 py-3 border-b border-[#2a2d3a]">
                  <h3 className="text-white font-semibold">Standings</h3>
                  <p className="text-gray-500 text-xs mt-0.5">{autoStandings.tournamentName}</p>
                </div>
                <div className="divide-y divide-[#2a2d3a]">
                  {autoStandings.groups.map(group => (
                    <div key={group.title}>
                      {autoStandings.groups.length > 1 && (
                        <p className="px-4 pt-3 pb-1 text-xs font-bold text-[#ff4655] uppercase tracking-wider">{group.title}</p>
                      )}
                      <table className="w-full">
                        <thead className="bg-[#151821]">
                          <tr className="text-gray-400 text-xs uppercase">
                            <th className="px-4 py-2.5 text-left">#</th>
                            <th className="px-4 py-2.5 text-left">Team</th>
                            <th className="px-4 py-2.5 text-center">W</th>
                            <th className="px-4 py-2.5 text-center">L</th>
                            <th className="px-4 py-2.5 text-center">Win%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map(team => {
                            const total = team.wins + team.losses;
                            const wr = total === 0 ? '0%' : `${Math.round((team.wins / total) * 100)}%`;
                            return (
                              <tr key={team.id} className="border-t border-[#2a2d3a] hover:bg-[#151821] transition-colors">
                                <td className="px-4 py-2.5">
                                  <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${team.rank <= 2 ? 'bg-[#ff4655] text-white' : 'bg-[#2a2d3a] text-gray-400'}`}>
                                    {team.rank}
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 text-sm">
                                  <Link to={`/teams/${team.id}`} className="text-white hover:text-[#ff4655] transition-colors">{team.name}</Link>
                                </td>
                                <td className="px-4 py-2.5 text-center text-green-400 text-sm font-semibold">{team.wins}</td>
                                <td className="px-4 py-2.5 text-center text-red-400 text-sm font-semibold">{team.losses}</td>
                                <td className="px-4 py-2.5 text-center text-gray-300 text-sm">{wr}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              </div>
            ) : standings ? (
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

             {/* Top Players — ranked by average ACS from tournament stats */}
                        <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-5 h-5 text-[#ff4655]" />
                              <h3 className="text-white font-semibold">Top Players</h3>
                            </div>
                            <span className="text-gray-500 text-xs uppercase tracking-wider">by ACS</span>
                          </div>
                          <div className="space-y-3">
                            {topByAcs.length > 0 ? (
                              topByAcs.map((player, index) => {
                                const rowInner = (
                                  <>
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 bg-gradient-to-br from-yellow-500 to-orange-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                                        {index + 1}
                                      </div>
                                      <div>
                                        <div className="text-white text-sm font-semibold">{player.playerName}</div>
                                        <div className="text-gray-400 text-xs">{player.teamName}</div>
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-[#ff4655] text-sm font-bold">{Math.round(player.acs)}</div>
                                      <div className="text-gray-400 text-xs">{player.kills}/{player.deaths}/{player.assists}</div>
                                    </div>
                                  </>
                                );
                                const rowClass = "flex items-center justify-between p-2 rounded hover:bg-[#151821] transition-colors";
                                return player.tournamentId && player.rosterPlayerId ? (
                                  <Link key={player.playerId} to={`/player/${player.tournamentId}/${player.rosterPlayerId}`} className={rowClass}>
                                    {rowInner}
                                  </Link>
                                ) : (
                                  <div key={player.playerId} className={rowClass}>
                                    {rowInner}
                                  </div>
                                );
                              })
                            ) : (adminData?.players && adminData.players.length > 0
                              ? [...adminData.players].sort((a, b) => a.rank - b.rank)
                              : [
                                  { id: '1', rank: 1, name: 'jinggg', team: 'PRX', rating: 1.42, kills: 275, deaths: 189 },
                                  { id: '2', rank: 2, name: 'Derke', team: 'FNC', rating: 1.38, kills: 268, deaths: 195 },
                                  { id: '3', rank: 3, name: 'aspas', team: 'LOUD', rating: 1.35, kills: 261, deaths: 198 },
                                  { id: '4', rank: 4, name: 'Demon1', team: 'EG', rating: 1.31, kills: 245, deaths: 192 },
                                ]
                            ).map((player) => (
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
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<TeamsPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/player/:tournamentId/:playerId" element={<PlayerPage />} />
        <Route path="/news/:id" element={<ArticlePage />} />
        <Route path="/tournament/:id" element={<TournamentPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/match/:matchId" element={<MatchScoreboard />} />
        <Route path="/tournament-match/:matchId" element={<TournamentMatchPage />} />
      </Routes>
    </Router>
  );
}
