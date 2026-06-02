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
import { ArrowRight } from 'lucide-react';
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
  const upcomingMatches = (() => {
    const all = tournamentBracketMatches.length > 0
      ? tournamentBracketMatches.filter(m => m.status === 'upcoming')
      : adminData
      ? adminData.matches.filter(m => m.status === 'upcoming' && m.visible)
      : null;
    return all ? all.slice(0, 10) : null;
  })();

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

  // First paragraph of an article body, used as the Editorial card excerpt.
  const newsExcerpt = (n: { body?: { type: string; text?: string }[] }) => {
    const para = n.body?.find(b => b.type === 'paragraph' && b.text);
    return para?.text ?? '';
  };

  // Editorial fallback cards when the app data hasn't loaded yet.
  const fallbackNews = [
    { id: 'f1', title: 'Paper Rex dominate in opening match with flawless attacking rounds', category: 'MATCH RECAP', timeAgo: '2 hours ago', imageUrl: 'https://images.unsplash.com/photo-1558008258-7ff8888b42b0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080', excerpt: '' },
    { id: 'f2', title: 'Masters playoffs bracket revealed: Top seeds face tough competition', category: 'TOURNAMENT', timeAgo: '5 hours ago', imageUrl: 'https://images.unsplash.com/photo-1548686304-5c3be888a00b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080', excerpt: '' },
    { id: 'f3', title: 'Roster shuffle: Star duelist joins championship contender', category: 'BREAKING', timeAgo: '8 hours ago', imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080', excerpt: '' },
  ];

  // Standings table (shared markup for auto-standings groups and manual standings).
  const StandingsTable = ({ rows, highlightTop }: { rows: StandRow[]; highlightTop: number }) => (
    <table className="w-full">
      <thead>
        <tr className="border-b border-[#2b2b2b]">
          <th className="px-2 py-2 text-left text-[#f5f3f3] text-[10px] font-inter font-bold">#</th>
          <th className="px-2 py-2 text-left text-[#f5f3f3] text-[10px] font-inter font-bold">Team</th>
          <th className="px-2 py-2 text-right text-[#f5f3f3] text-[10px] font-inter font-bold">W</th>
          <th className="px-2 py-2 text-right text-[#f5f3f3] text-[10px] font-inter font-bold">L</th>
          <th className="px-2 py-2 text-right text-[#f5f3f3] text-[10px] font-inter font-bold">Win%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(team => {
          const total = team.wins + team.losses;
          const wr = total === 0 ? '0%' : `${Math.round((team.wins / total) * 100)}%`;
          const top = team.rank <= highlightTop;
          return (
            <tr key={team.id} className="border-b border-[#2b2b2b]/60">
              <td className={`px-2 py-3 text-sm font-inter font-bold ${top ? 'text-[#ff4655]' : 'text-white'}`}>
                {String(team.rank).padStart(2, '0')}
              </td>
              <td className="px-2 py-3 text-sm font-inter font-bold">
                <Link to={`/teams/${team.id}`} className="text-white hover:text-[#ff4655] transition-colors">{team.name}</Link>
              </td>
              <td className="px-2 py-3 text-right text-sm font-inter font-bold text-green-400">{team.wins}</td>
              <td className="px-2 py-3 text-right text-sm font-inter font-bold text-red-400">{team.losses}</td>
              <td className="px-2 py-3 text-right text-sm font-inter text-[#e5e2e1]">{wr}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Normalize manual standings into the same shape used by StandingsTable.
  const manualRows: StandRow[] | null = standings
    ? standings.map(t => ({ id: t.id, rank: t.rank, name: t.name, wins: t.wins, losses: t.losses }))
    : null;

  return (
    <div className="min-h-screen bg-[#0e0e0e] font-inter">
      <Header />

      {/* Hero */}
      <HeroSection heroLink={adminData?.heroLink} />

      {/* Upcoming Matches + Standings */}
      <section className="max-w-[1436px] mx-auto px-6 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upcoming Matches */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="flex items-end justify-between border-b-2 border-[#2b2b2b] pb-4">
              <h2 className="font-chivo text-2xl">
                <span className="text-white">Upcoming </span>
                <span className="text-[#ff4655]">Matches</span>
              </h2>
              <Link to="/matches" className="text-[#ff4655] text-[11px] font-inter hover:underline">Full Schedule</Link>
            </div>
            <div className="flex flex-col gap-4">
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
                <div className="text-center py-8 text-gray-500 text-sm bg-[#1c1b1b] border border-[#2b2b2b]">
                  No upcoming matches scheduled
                </div>
              )}
            </div>
          </div>

          {/* Standings */}
          <div className="flex flex-col gap-6">
            <div className="border-b-2 border-[#2b2b2b] pb-4">
              <h2 className="font-chivo text-2xl text-white">Standings</h2>
            </div>
            {autoStandings ? (
              <div className="bg-[#1c1b1b] border border-[#2b2b2b] p-6 flex flex-col gap-6">
                <p className="text-[#ff4655] text-[10px] font-inter">{autoStandings.tournamentName}</p>
                {autoStandings.groups.map(group => (
                  <div key={group.title} className="flex flex-col gap-2">
                    {autoStandings.groups.length > 1 && (
                      <p className="text-[#ff4655] text-[10px] font-inter font-bold uppercase tracking-wider">{group.title}</p>
                    )}
                    <StandingsTable rows={group.rows} highlightTop={2} />
                  </div>
                ))}
              </div>
            ) : manualRows ? (
              <div className="bg-[#1c1b1b] border border-[#2b2b2b] p-6 flex flex-col gap-6">
                <p className="text-[#ff4655] text-[10px] font-inter">Group Standings</p>
                <StandingsTable rows={manualRows} highlightTop={3} />
              </div>
            ) : (
              <Standings />
            )}
          </div>
        </div>
      </section>

      {/* Top Performance — ranked by average ACS from tournament stats */}
      <section className="bg-[#0e0e0e] border-t border-b border-[#2b2b2b] py-20">
        <div className="max-w-[1436px] mx-auto px-6 flex flex-col gap-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-[#ff4655] text-[11px] font-inter">Season Leaders</p>
            <h2 className="font-chivo text-3xl text-white">Top Performance</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {topByAcs.length > 0 ? (
              topByAcs.slice(0, 4).map(player => {
                const card = (
                  <>
                    <p className="text-[#f5f3f3] text-[9px] font-inter uppercase tracking-wide">{player.teamName}</p>
                    <p className="text-[#e5e2e1] text-xl font-chivo">{player.playerName}</p>
                    <div className="grid grid-cols-2 gap-4 border-t border-[#2b2b2b] pt-4">
                      <div>
                        <p className="text-[#f5f3f3] text-[9px] font-inter">ACS</p>
                        <p className="text-white text-lg font-chivo">{Math.round(player.acs)}</p>
                      </div>
                      <div>
                        <p className="text-[#f5f3f3] text-[9px] font-inter">K/D/A</p>
                        <p className="text-white text-lg font-chivo">{player.kills}/{player.deaths}/{player.assists}</p>
                      </div>
                    </div>
                  </>
                );
                const cls = "bg-[#1c1b1b] border border-[#2b2b2b] p-6 flex flex-col gap-4 hover:border-[#ff4655]/40 transition-colors";
                return player.tournamentId && player.rosterPlayerId ? (
                  <Link key={player.playerId} to={`/player/${player.tournamentId}/${player.rosterPlayerId}`} className={cls}>
                    {card}
                  </Link>
                ) : (
                  <div key={player.playerId} className={cls}>{card}</div>
                );
              })
            ) : (
              (adminData?.players && adminData.players.length > 0
                ? [...adminData.players].sort((a, b) => a.rank - b.rank)
                : [
                    { id: '1', rank: 1, name: 'jinggg', team: 'PRX', rating: 1.42, kills: 275, deaths: 189 },
                    { id: '2', rank: 2, name: 'Derke', team: 'FNC', rating: 1.38, kills: 268, deaths: 195 },
                    { id: '3', rank: 3, name: 'aspas', team: 'LOUD', rating: 1.35, kills: 261, deaths: 198 },
                    { id: '4', rank: 4, name: 'Demon1', team: 'EG', rating: 1.31, kills: 245, deaths: 192 },
                  ]
              ).slice(0, 4).map(player => (
                <div key={player.id} className="bg-[#1c1b1b] border border-[#2b2b2b] p-6 flex flex-col gap-4">
                  <p className="text-[#f5f3f3] text-[9px] font-inter uppercase tracking-wide">{player.team}</p>
                  <p className="text-[#e5e2e1] text-xl font-chivo">{player.name}</p>
                  <div className="grid grid-cols-2 gap-4 border-t border-[#2b2b2b] pt-4">
                    <div>
                      <p className="text-[#f5f3f3] text-[9px] font-inter">Rating</p>
                      <p className="text-white text-lg font-chivo">{player.rating.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-[#f5f3f3] text-[9px] font-inter">K/D</p>
                      <p className="text-white text-lg font-chivo">{player.kills}/{player.deaths}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Editorial */}
      <section className="py-20">
        <div className="max-w-[1436px] mx-auto px-6 flex flex-col gap-10">
          <div className="flex items-end justify-between border-b-2 border-[#2b2b2b] pb-6">
            <div className="flex flex-col gap-1">
              <h2 className="font-chivo text-2xl text-white">Editorial</h2>
              <p className="text-[#efeeed] text-sm font-inter">High-performance analysis and intel.</p>
            </div>
            <Link to="/matches" className="flex items-center gap-2 text-[#ff4655] text-[11px] font-inter hover:underline">
              Archives <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {news && news.length > 0 ? (
              news.slice(0, 3).map(n => (
                <NewsCard key={n.id} id={n.id} title={n.title} category={n.category} timeAgo={n.timeAgo} imageUrl={n.imageUrl} link={n.link} excerpt={newsExcerpt(n)} />
              ))
            ) : !adminData ? (
              fallbackNews.map(n => (
                <NewsCard key={n.id} title={n.title} category={n.category} timeAgo={n.timeAgo} imageUrl={n.imageUrl} excerpt={n.excerpt} />
              ))
            ) : (
              <div className="md:col-span-3 text-center py-8 text-gray-500 text-sm bg-[#1c1b1b] border border-[#2b2b2b]">
                No news articles
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Enter the Arena CTA */}
      <section className="bg-[#111] border-t border-[#2b2b2b] py-24">
        <div className="max-w-[1436px] mx-auto px-4 flex flex-col items-center gap-10 text-center">
          <h2 className="font-chivo text-5xl md:text-6xl">
            <span className="text-white">Enter the </span>
            <span className="text-[#ff4655]">Arena</span>
          </h2>
          <Link
            to="/matches"
            className="bg-[#ff4655] hover:bg-[#ff3344] text-white text-[13px] font-inter px-14 py-5 transition-colors"
          >
            View Tournaments
          </Link>
        </div>
      </section>
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
