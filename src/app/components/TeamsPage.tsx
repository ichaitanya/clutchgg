import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, Users, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Tournament, TeamInTournament, TournamentPlayer } from './TournamentCreation';
import { getTournaments } from '../services/db';

type ViewMode = 'teams' | 'players';

export function TeamsPage() {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('teams');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    getTournaments().then(setTournaments).catch(() => {});
  }, []);

  // Get all teams from all tournaments
  const allTeams: (TeamInTournament & { tournamentName: string; tournamentId: string })[] = useMemo(() => {
    const teams: (TeamInTournament & { tournamentName: string; tournamentId: string })[] = [];
    tournaments.forEach(tournament => {
      tournament.teams.forEach(team => {
        teams.push({
          ...team,
          tournamentName: tournament.name,
          tournamentId: tournament.id,
        });
      });
    });
    return teams;
  }, [tournaments]);

  // Get selected team's players
  const selectedTeam = useMemo(() => {
    return allTeams.find(t => t.id === selectedTeamId);
  }, [selectedTeamId, allTeams]);

  // Initialize selected team when first team is available
  useEffect(() => {
    if (allTeams.length > 0 && !selectedTeamId && viewMode === 'teams') {
      setSelectedTeamId(allTeams[0].id);
    }
  }, [allTeams.length]);

  return (
    <div className="min-h-screen bg-[#0d0f16] pb-24">
      {/* Header */}
      <div className="bg-[#151821] border-b border-[#2a2d3a] sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-[#1e2130] rounded-lg transition-colors text-gray-500 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-white font-bold text-2xl">Teams</h1>
            <p className="text-gray-500 text-sm">
              {allTeams.length} team{allTeams.length !== 1 ? 's' : ''} across {tournaments.length} tournament{tournaments.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {allTeams.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 mx-auto text-gray-600 mb-4" />
            <p className="text-gray-400 mb-2">No teams created yet</p>
            <p className="text-gray-600 text-sm">Create tournaments and add teams in the admin panel</p>
          </div>
        ) : viewMode === 'teams' ? (
          // Teams List View
          <div className="space-y-4">
            <h2 className="text-white font-bold text-lg mb-4">All Teams</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allTeams.map(team => (
                <div
                  key={team.id}
                  onClick={() => {
                    setSelectedTeamId(team.id);
                    setViewMode('players');
                  }}
                  className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 hover:border-[#ff4655] hover:shadow-lg hover:shadow-[#ff4655]/20 transition-all cursor-pointer group"
                >
                  {/* Team Logo */}
                  {team.logo && (
                    <div className="w-full h-32 rounded-lg overflow-hidden mb-4 bg-[#0d0f16]">
                      <img
                        src={team.logo}
                        alt={team.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  )}

                  {/* Team Info */}
                  <div className="mb-4">
                    <h3 className="text-white font-bold text-lg mb-1 group-hover:text-[#ff4655] transition-colors">
                      {team.name}
                    </h3>
                    <p className="text-gray-500 text-sm">{team.tournamentName}</p>
                  </div>

                  {/* Players Count */}
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <Users className="w-4 h-4" />
                    <span>{team.players.length} players</span>
                  </div>

                  {/* View Players Link */}
                  <div className="mt-4 text-[#ff4655] text-xs font-semibold group-hover:translate-x-1 transition-transform">
                    View Players →
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : selectedTeam ? (
          // Players Details View
          <div className="space-y-6">
            {/* Back Button */}
            <button
              onClick={() => setViewMode('teams')}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>Back to Teams</span>
            </button>

            <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
              <div className="flex items-start gap-4 mb-6">
                {selectedTeam.logo && (
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-[#0d0f16]">
                    <img
                      src={selectedTeam.logo}
                      alt={selectedTeam.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div>
                  <h2 className="text-white font-bold text-2xl">{selectedTeam.name}</h2>
                  <p className="text-gray-500 text-sm">{selectedTeam.tournamentName}</p>
                  <p className="text-gray-400 text-xs mt-1">
                    {selectedTeam.players.length} player{selectedTeam.players.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>

            {/* Players Grid */}
            {selectedTeam.players.length === 0 ? (
              <div className="text-center py-12 bg-[#151821] border border-[#2a2d3a] rounded-xl">
                <User className="w-10 h-10 mx-auto text-gray-600 mb-2" />
                <p className="text-gray-400">No players added yet</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {selectedTeam.players.map(player => (
                  <div
                    key={player.id}
                    className="bg-[#151821] border border-[#2a2d3a] rounded-xl overflow-hidden hover:border-[#ff4655] transition-all group"
                  >
                    {/* Player Photo */}
                    {player.photo ? (
                      <div className="w-full h-32 bg-[#0d0f16] overflow-hidden">
                        <img
                          src={player.photo}
                          alt={player.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      </div>
                    ) : (
                      <div className="w-full h-32 bg-gradient-to-br from-[#ff4655]/20 to-[#ff4655]/5 flex items-center justify-center">
                        <User className="w-10 h-10 text-gray-600" />
                      </div>
                    )}

                    {/* Player Info */}
                    <div className="p-3 text-center">
                      <h3 className="text-white font-bold text-sm truncate">{player.name}</h3>
                      {player.role && (
                        <p className="text-[#ff4655] text-xs uppercase tracking-wider font-semibold mt-1">
                          {player.role}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </main>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-[#151821] border-t border-[#2a2d3a]">
        <div className="max-w-7xl mx-auto px-4 flex gap-3 py-3">
          <button
            onClick={() => setViewMode('teams')}
            className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              viewMode === 'teams'
                ? 'bg-[#ff4655] text-white'
                : 'bg-[#0d0f16] border border-[#2a2d3a] text-gray-400 hover:text-white hover:border-gray-500'
            }`}
          >
            <Users className="w-4 h-4" />
            All Teams
          </button>
          <button
            onClick={() => setViewMode('players')}
            disabled={allTeams.length === 0}
            className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              viewMode === 'players'
                ? 'bg-[#ff4655] text-white'
                : 'bg-[#0d0f16] border border-[#2a2d3a] text-gray-400 hover:text-white hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            <User className="w-4 h-4" />
            Players
          </button>
        </div>
      </div>
    </div>
  );
}
