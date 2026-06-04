import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { UpcomingMatch } from './components/UpcomingMatch';
import { Standings } from './components/Standings';
import { NewsCard } from './components/NewsCard';
import { Footer } from './components/Footer';
// Utilities used directly by the home page stay eager (they pull no heavy deps).
import { getTopPlayersByAcs } from './components/StatsPage';
import { computeRRStandings } from './components/BracketDisplay';
import { ArrowRight } from 'lucide-react';
import type { AdminData } from './components/AdminPanel';
import type { BracketGenerated, BracketMatch } from './components/TournamentCreation';
import { loadAdminData } from './services/db';

// Route pages are code-split so a first-time visitor only downloads the home
// page's JS. The heavy admin editor (TournamentCreation, Excel/Challonge import,
// brackets) and the per-route pages load on demand when navigated to. This keeps
// the initial bundle small and first paint fast.
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })));
const MatchScoreboard = lazy(() => import('./components/MatchScoreboard').then(m => ({ default: m.MatchScoreboard })));
const MatchesPage = lazy(() => import('./components/MatchesPage').then(m => ({ default: m.MatchesPage })));
const TournamentsPage = lazy(() => import('./components/TournamentsPage').then(m => ({ default: m.TournamentsPage })));
const NewsPage = lazy(() => import('./components/NewsPage').then(m => ({ default: m.NewsPage })));
const TournamentMatchPage = lazy(() => import('./components/TournamentMatchPage').then(m => ({ default: m.TournamentMatchPage })));
const TeamsPage = lazy(() => import('./components/TeamsPage').then(m => ({ default: m.TeamsPage })));
const StatsPage = lazy(() => import('./components/StatsPage').then(m => ({ default: m.StatsPage })));
const PlayerPage = lazy(() => import('./components/PlayerPage').then(m => ({ default: m.PlayerPage })));
const ArticlePage = lazy(() => import('./components/ArticlePage').then(m => ({ default: m.ArticlePage })));
const TournamentPage = lazy(() => import('./components/TournamentPage').then(m => ({ default: m.TournamentPage })));
const ContactPage = lazy(() => import('./components/ContactPage').then(m => ({ default: m.ContactPage })));


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

// A series is decided once a team reaches ceil(maxMaps/2) map wins (e.g. 2 in a
// BO3), or all maps are played and someone is ahead.
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

// Winner-aware status: a recorded winner or a map-decided result is completed
// regardless of the scheduled date; otherwise fall back to the date.
function getEffectiveStatus(match: BracketMatch): 'upcoming' | 'live' | 'completed' {
  if (match.winner || isMatchDecidedByMaps(match)) return 'completed';
  return getMatchStatus(match.date, match.time);
}

// Names standing in for an undecided bracket slot (winner-of, TBD, empty seats).
function isPlaceholderSlot(name: string): boolean {
  if (!name) return true;
  const n = name.trim();
  return (
    n === '' ||
    n === 'Select Team' ||
    n === 'TBD' ||
    n === 'LB TBD' ||
    n === 'WB Champion' ||
    n === 'LB Champion' ||
    n.startsWith('Team Slot') ||
    n.startsWith('Winner') ||
    n.startsWith('Loser')
  );
}

function Home() {
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Retry indefinitely with capped exponential backoff. A transient stall or
    // timeout should never leave the page permanently blank — we keep trying
    // (500ms, 1s, 2s, 4s, then 8s forever) until data arrives or we unmount.
    function load(attempt: number) {
      loadAdminData()
        .then(d => { if (!cancelled) setAdminData(d); })
        .catch(() => {
          if (cancelled) return;
          const delay = Math.min(500 * 2 ** (attempt - 1), 8000);
          setTimeout(() => load(attempt + 1), delay);
        });
    }
    load(1);
    return () => { cancelled = true; };
  }, []);

  const handleDataChange = (data: AdminData) => setAdminData(data);

  // Extract matches from every tournament bracket (single-stage + both stages),
  // attaching the tournament name and each team's logo (resolved from the roster
  // by id, then by name). Placeholder slots are filtered out by the consumer.
  const tournamentBracketMatches = adminData
    ? adminData.tournaments
      .flatMap(tournament => {
        const brackets = [
          tournament.generatedBracket,
          tournament.stage1Bracket,
          tournament.stage2Bracket,
        ].filter(Boolean) as BracketGenerated[];
        const logoFor = (teamId: string, teamName: string) => {
          const byId = tournament.teams.find(tm => tm.id === teamId);
          if (byId?.logo) return byId.logo;
          const norm = teamName.trim().toLowerCase();
          return tournament.teams.find(tm => tm.name.trim().toLowerCase() === norm)?.logo;
        };
        return brackets.flatMap(b =>
          b.rounds.flat().map(match => ({
            ...match,
            status: getEffectiveStatus(match),
            tournamentName: tournament.name,
            team1Logo: logoFor(match.team1Id, match.team1Name),
            team2Logo: logoFor(match.team2Id, match.team2Name),
          }))
        );
      })
    : [];

  // Derive display data: first try tournament brackets, then fall back to admin matches
  const upcomingMatches = (() => {
    const all = tournamentBracketMatches.length > 0
      ? tournamentBracketMatches.filter(m =>
          m.status === 'upcoming' &&
          !isPlaceholderSlot(m.team1Name) &&
          !isPlaceholderSlot(m.team2Name))
      : adminData
      ? adminData.matches.filter(m => m.status === 'upcoming' && m.visible)
      : null;
    return all ? all.slice(0, 6) : null;
  })();

  const standings = adminData ? adminData.standings : null;
  const news = adminData ? adminData.news.filter(n => n.visible) : null;

  // Auto-standings: if a tournament is round-robin or group-based, compute its
  // standings tables directly for the homepage (instead of manual standings).
  type StandRow = { id: string; rank: number; name: string; wins: number; losses: number };
  const autoStandings: { tournament: any; tournamentId: string; tournamentName: string; groups: { title: string; rows: StandRow[] }[] } | null = (() => {
    if (!adminData) return null;
    // If the admin picked a spotlight tournament, consider only it;
    // otherwise fall back to the first round-robin / group-stage tournament.
    const selectedId = adminData.spotlightTournamentId;
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
        if (groups.length > 0) return { tournament: t, tournamentId: t.id, tournamentName: t.name, groups };
      }
      // Round robin (single-stage generatedBracket or stage1Bracket).
      const rr = [t.generatedBracket, t.stage1Bracket].find(b => b?.bracketType === 'roundrobin');
      if (rr) {
        const rows = computeRRStandings(rr.rounds, rr.rrTeams ?? []).map((r, i) => ({
          id: r.teamId, rank: i + 1, name: r.teamName, wins: r.wins, losses: r.losses,
        }));
        if (rows.length > 0) return { tournament: t, tournamentId: t.id, tournamentName: t.name, groups: [{ title: 'Standings', rows }] };
      }
    }
    return null;
  })();

  // Spotlight tournament (for hero section + stands). Works for any format, not just RRB/group.
  const spotlightTournament = adminData && adminData.spotlightTournamentId
    ? adminData.tournaments.find(t => t.id === adminData.spotlightTournamentId) ?? null
    : null;

  // Top players ranked by average ACS, computed from applied tournament match
  // stats. Scoped to the spotlight tournament (if one is selected); otherwise
  // considers all tournaments. Falls back to admin-entered / placeholder players
  // when no stats exist.
  const topByAcs = adminData
    ? getTopPlayersByAcs(spotlightTournament ? [spotlightTournament] : adminData.tournaments, 5)
    : [];

  // First paragraph of an article body, used as the Editorial card excerpt.
  // Strips @[label](ref) mention syntax and other markdown artifacts before display.
  const newsExcerpt = (n: { body?: { type: string; text?: string }[] }) => {
    const para = n.body?.find(b => b.type === 'paragraph' && b.text);
    if (!para?.text) return '';
    return para.text
      .replace(/@\[([^\]]*)\]\([^)]*\)/g, '$1') // @[label](ref) → label
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // [label](url) → label
      .replace(/[*_`#]/g, '')                    // stray markdown chars
      .trim();
  };

  // Editorial fallback cards when the app data hasn't loaded yet.
  const fallbackNews = [
    { id: 'f1', title: 'Paper Rex dominate in opening match with flawless attacking rounds', category: 'MATCH RECAP', timeAgo: '2 hours ago', imageUrl: 'https://images.unsplash.com/photo-1558008258-7ff8888b42b0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080', excerpt: '' },
    { id: 'f2', title: 'Masters playoffs bracket revealed: Top seeds face tough competition', category: 'TOURNAMENT', timeAgo: '5 hours ago', imageUrl: 'https://images.unsplash.com/photo-1548686304-5c3be888a00b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080', excerpt: '' },
    { id: 'f3', title: 'Roster shuffle: Star duelist joins championship contender', category: 'BREAKING', timeAgo: '8 hours ago', imageUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1080', excerpt: '' },
  ];

  // Standings table (shared markup for auto-standings groups and manual standings).
  // highlightTop: how many rows get red shading (6 for RR, 2 for group stage).
  const StandingsTable = ({ rows, highlightTop }: { rows: StandRow[]; highlightTop: number }) => (
    <table className="arena-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>W</th>
          <th>L</th>
          <th>Win%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(team => {
          const total = team.wins + team.losses;
          const wr = total === 0 ? '0%' : `${Math.round((team.wins / total) * 100)}%`;
          const inTop = team.rank <= highlightTop;
          // Top rows: fully visible, rank-1 gets left accent bar via --1 modifier.
          // Rows beyond cutoff: stepped opacity fade.
          const fadeStep = Math.min(team.rank - highlightTop, 4);
          const rowClass = inTop
            ? `arena-rank-row arena-rank-row--${team.rank}`
            : `arena-rank-row--fade-${fadeStep}`;
          const isFirst = team.rank === 1;
          return (
            <tr key={team.id} className={rowClass}>
              <td className={isFirst ? 'arena-rank--top' : 'arena-rank'}>
                {String(team.rank).padStart(2, '0')}
              </td>
              <td>
                <Link to={`/teams/${team.id}`} className="transition-colors">{team.name}</Link>
              </td>
              <td>{team.wins}</td>
              <td>{team.losses}</td>
              <td className={isFirst ? 'arena-winpct--top' : ''}>{wr}</td>
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
      <HeroSection heroLink={adminData?.heroLink} heroVideo={adminData?.heroVideo} standingsTournamentId={spotlightTournament?.id} spotlightTournament={spotlightTournament} />

      {/* Upcoming Matches + Standings */}
      <section className="arena-section">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Upcoming Matches */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div className="arena-section-header">
              <h2 className="arena-heading">
                Upcoming <span style={{ color: 'var(--arena-accent)' }}>Matches</span>
              </h2>
              <Link to="/matches" className="arena-btn--ghost">Full Schedule</Link>
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
                  const team1Logo = 'team1Logo' in m ? m.team1Logo : undefined;
                  const team2Logo = 'team2Logo' in m ? m.team2Logo : undefined;
                  const format = 'format' in m ? m.format : undefined;
                  return (
                    <UpcomingMatch
                      key={m.id}
                      team1={team1}
                      team2={team2}
                      team1Logo={team1Logo}
                      team2Logo={team2Logo}
                      tournament={tournament || ''}
                      format={format}
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
            <div className="arena-section-header">
              <h2 className="arena-heading">Standings</h2>
            </div>
            {autoStandings ? (
              <div className="arena-standings flex flex-col gap-3">
                <Link to={`/tournament/${autoStandings.tournamentId}`} className="arena-standings__title">
                  {autoStandings.tournamentName}
                </Link>
                {autoStandings.groups.map(group => (
                  <div key={group.title} className="flex flex-col gap-2">
                    {autoStandings.groups.length > 1 && (
                      <p className="arena-standings__tournament">{group.title}</p>
                    )}
                    {/* RR = single group → shade top 6; group stage → shade top 2 per group */}
                    <StandingsTable rows={group.rows} highlightTop={autoStandings.groups.length === 1 ? 6 : 2} />
                  </div>
                ))}
              </div>
            ) : manualRows ? (
              <div className="arena-standings flex flex-col gap-3">
                <p className="arena-standings__tournament">Group Standings</p>
                <StandingsTable rows={manualRows} highlightTop={6} />
              </div>
            ) : (
              <Standings />
            )}
          </div>
        </div>
      </section>

      {/* Top Performance — ranked by average ACS from tournament stats */}
      <section className="arena-perf-section">
        <div className="max-w-[1436px] mx-auto px-6 flex flex-col gap-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="arena-label">Season Leaders</p>
            <h2 className="arena-heading arena-heading--lg">Top Performance</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {topByAcs.length > 0 ? (
              topByAcs.slice(0, 4).map(player => {
                const card = (
                  <>
                    <p className="arena-player-card__team">{player.teamName}</p>
                    <p className="arena-player-card__name">{player.playerName}</p>
                    <div className="arena-player-card__stats">
                      <div>
                        <p className="arena-player-card__stat-label">ACS</p>
                        <p className="arena-player-card__stat-value">{Math.round(player.acs)}</p>
                      </div>
                      <div>
                        <p className="arena-player-card__stat-label">K/D/A</p>
                        <p className="arena-player-card__stat-value">{player.kills}/{player.deaths}/{player.assists}</p>
                      </div>
                    </div>
                  </>
                );
                return player.tournamentId && player.rosterPlayerId ? (
                  <Link key={player.playerId} to={`/player/${player.tournamentId}/${player.rosterPlayerId}`} className="arena-player-card">
                    {card}
                  </Link>
                ) : (
                  <div key={player.playerId} className="arena-player-card">{card}</div>
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
                <div key={player.id} className="arena-player-card">
                  <p className="arena-player-card__team">{player.team}</p>
                  <p className="arena-player-card__name">{player.name}</p>
                  <div className="arena-player-card__stats">
                    <div>
                      <p className="arena-player-card__stat-label">Rating</p>
                      <p className="arena-player-card__stat-value">{player.rating.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="arena-player-card__stat-label">K/D</p>
                      <p className="arena-player-card__stat-value">{player.kills}/{player.deaths}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Editorial */}
      <section className="arena-section" style={{ borderBottom: '1px solid #2b2b2b' }}>
        <div className="max-w-[1436px] mx-auto flex flex-col gap-10">
          <div className="arena-section-header">
            <div className="flex flex-col gap-1">
              <h2 className="arena-heading">Editorial</h2>
              <p className="arena-body--sm">High-performance analysis and intel.</p>
            </div>
            <Link to="/news" className="arena-btn--ghost flex items-center gap-2">
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
      <section className="arena-cta">
        <div className="max-w-[1436px] mx-auto flex flex-col items-center gap-10">
          <h2 className="arena-cta__title">
            ENTER THE <span className="accent">CLUTCH</span>
          </h2>
              <Link
                to="/contact"
                className="arena-btn arena-btn--primary"
                style={{ letterSpacing: '0.1em', padding: '1.25rem 3.5rem' }}
              >
                Register Your Tournament
              </Link>
          </div>
        </section>

      <Footer />
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
      <Suspense fallback={<div className="min-h-screen bg-[#0e0e0e]" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/matches" element={<MatchesPage />} />
          <Route path="/tournaments" element={<TournamentsPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId" element={<TeamsPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/player/:tournamentId/:playerId" element={<PlayerPage />} />
          <Route path="/news/:id" element={<ArticlePage />} />
          <Route path="/tournament/:id" element={<TournamentPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/match/:matchId" element={<MatchScoreboard />} />
          <Route path="/tournament-match/:matchId" element={<TournamentMatchPage />} />
          <Route path="/contact" element={<ContactPage />} />
        </Routes>
      </Suspense>
    </Router>
  );
}
