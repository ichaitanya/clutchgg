import { useState, useEffect } from 'react';
import { Header } from './Header';
import { LiveMatch } from './LiveMatch';
import { useNavigate } from 'react-router-dom';
import { TournamentDetailsDisplay } from './TournamentDetailsDisplay';
import type { AdminData } from './AdminPanel';
import type { Tournament } from './TournamentCreation';

const STORAGE_KEY = 'vct_admin_data';

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

export function MatchesPage() {
  const navigate = useNavigate();
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

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

  // Extract tournament matches grouped by tournament
  const tournamentMatches = adminData
    ? adminData.tournaments
      .map(tournament => ({
        tournament,
        matches: tournament.generatedBracket
          ? tournament.generatedBracket.rounds.flat().map(match => ({
              ...match,
              status: getMatchStatus(match.date, match.time),
              tournamentName: tournament.name,
            }))
          : [],
      }))
      .filter(t => t.matches.length > 0)
    : [];

  return (
    <div className="min-h-screen bg-[#0d0f16]">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Tournaments Section */}
        {adminData?.tournaments && adminData.tournaments.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-2xl font-bold flex items-center gap-2">
                <div className="w-1 h-8 bg-[#ff4655] rounded" />
                Active Tournaments
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {adminData.tournaments
                .filter(t => t.status !== 'completed')
                .map(tournament => (
                  <div
                    key={tournament.id}
                    onClick={() => setSelectedTournament(tournament)}
                    className="bg-[#151821] border border-[#2a2d3a] rounded-lg p-4 cursor-pointer hover:border-[#ff4655]/50 transition-all"
                  >
                    <h3 className="text-white font-bold text-sm mb-2">{tournament.name}</h3>
                    <p className="text-gray-500 text-xs mb-4 line-clamp-2">
                      {tournament.overview}
                    </p>
                    
                    <div className="space-y-2 py-3 border-y border-[#2a2d3a]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Teams</span>
                        <span className="text-white font-semibold">{tournament.teams.length}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Bracket</span>
                        <span className={tournament.generatedBracket ? 'text-[#4ade80]' : 'text-gray-600'}>
                          {tournament.generatedBracket ? '✓' : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Status</span>
                        <span className="text-[#ff4655] capitalize font-semibold">{tournament.status}</span>
                      </div>
                    </div>

                    <button className="w-full mt-3 py-2 px-3 bg-[#ff4655]/10 hover:bg-[#ff4655]/20 text-[#ff4655] text-xs font-semibold rounded-lg transition-colors">
                      View Details
                    </button>
                  </div>
                ))}
            </div>
          </section>
        )}
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

        {/* Tournament Matches Section */}
        {tournamentMatches && tournamentMatches.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-white text-2xl font-bold flex items-center gap-2">
                <div className="w-1 h-8 bg-[#ff4655] rounded" />
                Tournament Matches
              </h2>
            </div>
            <div className="space-y-8">
              {tournamentMatches.map((group) => (
                <div key={group.tournament.id} className="space-y-4">
                  {/* Tournament Header */}
                  <div className="bg-gradient-to-r from-[#ff4655]/20 to-[#ff4655]/5 border border-[#ff4655]/30 rounded-lg p-4">
                    <h3 className="text-white font-bold text-lg">{group.tournament.name}</h3>
                    <p className="text-gray-400 text-xs mt-1">
                      {group.matches.length} match{group.matches.length !== 1 ? 'es' : ''} • {group.tournament.teams.length} teams
                    </p>
                  </div>

                  {/* Matches Grouped by Status */}
                  {['live', 'upcoming', 'completed'].map((status) => {
                    const statusMatches = group.matches.filter((m) => m.status === status);
                    if (statusMatches.length === 0) return null;

                    const statusConfig = {
                      live: { label: '🔴 Live', color: '#ff4655' },
                      upcoming: { label: '⏰ Upcoming', color: '#3b82f6' },
                      completed: { label: '✓ Completed', color: '#9ca3af' },
                    };

                    return (
                      <div key={status} className="space-y-2">
                        <div className="flex items-center gap-2 px-4">
                          <span
                            className="text-xs font-bold"
                            style={{ color: statusConfig[status as keyof typeof statusConfig]?.color }}
                          >
                            {statusConfig[status as keyof typeof statusConfig]?.label}
                          </span>
                          <div className="flex-1 h-px bg-[#2a2d3a]" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {statusMatches.map((match) => (
                            <div
                              key={match.id}
                              className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4 hover:border-[#ff4655]/30 transition-colors"
                            >
                              <div className="space-y-3">
                                {/* Teams */}
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded text-xs font-bold bg-[#ff4655]/20 text-[#ff4655] flex items-center justify-center">
                                      {match.team1Name.substring(0, 1)}
                                    </div>
                                    <span className="text-white text-sm font-semibold flex-1 truncate">
                                      {match.team1Name}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded text-xs font-bold bg-[#3b82f6]/20 text-[#3b82f6] flex items-center justify-center">
                                      {match.team2Name.substring(0, 1)}
                                    </div>
                                    <span className="text-white text-sm font-semibold flex-1 truncate">
                                      {match.team2Name}
                                    </span>
                                  </div>
                                </div>

                                {/* Time */}
                                {(match.date || match.time) && (
                                  <div className="pt-2 border-t border-[#2a2d3a]">
                                    <p className="text-gray-400 text-xs">
                                      {match.date && (
                                        <span>{new Date(`${match.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                      )}
                                      {match.date && match.time && <span> • </span>}
                                      {match.time && <span>{match.time}</span>}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Tournament Details Modal */}
      {selectedTournament && (
        <TournamentDetailsDisplay
          tournament={selectedTournament}
          onClose={() => setSelectedTournament(null)}
        />
      )}
    </div>
  );
}
