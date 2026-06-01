import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, Users, User } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from './Header';
import type { Tournament, TeamInTournament, TournamentPlayer } from './TournamentCreation';
import { getTournaments } from '../services/db';

type ViewMode = 'teams' | 'players';

export function TeamsPage() {
  const navigate = useNavigate();
  const { teamId: routeTeamId } = useParams();
  const [viewMode, setViewMode] = useState<ViewMode>(routeTeamId ? 'players' : 'teams');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(routeTeamId ?? null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    getTournaments().then(setTournaments).catch(() => {});
  }, []);

  // Deep link: when arriving at /teams/:teamId, open that team's players view.
  useEffect(() => {
    if (routeTeamId) {
      setSelectedTeamId(routeTeamId);
      setViewMode('players');
    }
  }, [routeTeamId]);

  // Get all teams from all tournaments — deduplicated.
  // A team that appears in multiple tournaments is only listed once. Two teams
  // are considered the same when they share the same (normalized) name AND the
  // same set of players. If the name matches but the rosters differ, both are
  // kept (they're treated as distinct teams that happen to share a name).
  const allTeams: (TeamInTournament & { tournamentName: string; tournamentId: string })[] = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();

    // A roster fingerprint: sorted, normalized player names. Same players in any
    // order produce the same signature.
    const rosterSignature = (players: TournamentPlayer[]) =>
      players
        .map(p => norm(p.name))
        .filter(Boolean)
        .sort()
        .join('|');

    const teams: (TeamInTournament & { tournamentName: string; tournamentId: string })[] = [];
    const seen = new Set<string>(); // `${name}::${rosterSignature}`

    tournaments.forEach(tournament => {
      tournament.teams.forEach(team => {
        const key = `${norm(team.name)}::${rosterSignature(team.players)}`;
        if (seen.has(key)) return; // same name + same players → already added
        seen.add(key);
        teams.push({
          ...team,
          tournamentName: tournament.name,
          tournamentId: tournament.id,
        });
      });
    });
    return teams;
  }, [tournaments]);

  // Get selected team's players. Prefer the deduped list, but fall back to
  // searching every tournament's roster so deep links (e.g. from an article
  // mention) resolve even when dedup kept a different id for that team.
  const selectedTeam = useMemo(() => {
    const fromList = allTeams.find(t => t.id === selectedTeamId);
    if (fromList) return fromList;
    for (const t of tournaments) {
      const team = t.teams.find(tm => tm.id === selectedTeamId);
      if (team) return { ...team, tournamentName: t.name, tournamentId: t.id };
    }
    return undefined;
  }, [selectedTeamId, allTeams, tournaments]);

  // Initialize selected team when first team is available
  useEffect(() => {
    if (allTeams.length > 0 && !selectedTeamId && viewMode === 'teams') {
      setSelectedTeamId(allTeams[0].id);
    }
  }, [allTeams.length]);

  return (
    <div className="min-h-screen bg-[#0d0f16] pb-12">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Page title */}
        <div className="flex items-center gap-4 mb-6">
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
                    onClick={() => navigate(`/player/${selectedTeam.tournamentId}/${player.id}`)}
                    className="bg-[#151821] border border-[#2a2d3a] rounded-xl overflow-hidden hover:border-[#ff4655] transition-all group cursor-pointer"
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
    </div>
  );
}
