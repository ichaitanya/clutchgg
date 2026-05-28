import { useState, useEffect } from 'react';
import { X, MapPin, Users, Calendar, Trophy, CheckCircle, AlertCircle } from 'lucide-react';
import type { Tournament } from './TournamentCreation';

interface TournamentRegistrationProps {
  tournaments: Tournament[];
}

function TournamentCard({
  tournament,
  onRegisterClick,
}: {
  tournament: Tournament;
  onRegisterClick: (tournament: Tournament) => void;
}) {
  const isRegistrationOpen = tournament.status === 'registration' || tournament.status === 'planning';
  const isFull =
    tournament.event &&
    tournament.event.registeredTeams &&
    tournament.event.registeredTeams.length >= tournament.event.maxTeams;

  return (
    <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl overflow-hidden hover:border-[#ff4655]/50 transition-all">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#ff4655] to-[#ff6670] p-4">
        <h3 className="text-white font-bold text-lg">{tournament.name}</h3>
      </div>

      {/* Content */}
      <div className="p-6 space-y-4">
        <p className="text-gray-400 text-sm">{tournament.overview}</p>

        {/* Tournament Details */}
        {tournament.event && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Trophy className="w-4 h-4 text-[#ff4655]" />
              <span className="text-gray-400">Type: </span>
              <span className="text-white font-semibold capitalize">{tournament.event.type}</span>
            </div>

            {tournament.event.location && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-[#ff4655]" />
                <span className="text-gray-400">Location: </span>
                <span className="text-white font-semibold">{tournament.event.location}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-[#ff4655]" />
              <span className="text-gray-400">Dates: </span>
              <span className="text-white font-semibold">
                {new Date(tournament.event.startDate).toLocaleDateString()} -{' '}
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Users className="w-4 h-4 text-[#ff4655]" />
              <span className="text-gray-400">Slots: </span>
              <span className="text-white font-semibold">
                {tournament.event.registeredTeams?.length || 0} / {tournament.event.maxTeams}
              </span>
            </div>
          </div>
        )}

        {/* Registered Teams */}
        {tournament.event?.registeredTeams && tournament.event.registeredTeams.length > 0 && (
          <div className="bg-[#0d0f16] rounded-lg p-4">
            <p className="text-xs text-gray-500 font-semibold mb-2 uppercase">
              Registered Teams ({tournament.event.registeredTeams.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {tournament.event.registeredTeams.map((teamId) => {
                const team = tournament.teams.find((t) => t.id === teamId);
                return (
                  <div
                    key={teamId}
                    className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg px-3 py-1 text-xs text-white font-semibold flex items-center gap-2"
                  >
                    {team?.logo && (
                      <div className="w-4 h-4 rounded overflow-hidden">
                        <img src={team.logo} alt={team?.name} className="w-full h-full object-cover" />
                      </div>
                    )}
                    {team?.name || 'Unknown Team'}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bracket Status */}
        {tournament.generatedBracket && (
          <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs text-green-400 font-semibold">Bracket Generated</span>
          </div>
        )}

        {/* Status Badge */}
        <div className="flex items-center justify-between">
          <div>
            {isRegistrationOpen && !isFull ? (
              <span className="text-xs text-[#ff4655] font-semibold px-2 py-1 bg-[#ff4655]/10 rounded">
                Registration Open
              </span>
            ) : isFull ? (
              <span className="text-xs text-yellow-500 font-semibold px-2 py-1 bg-yellow-500/10 rounded">
                Full
              </span>
            ) : (
              <span className="text-xs text-gray-500 font-semibold px-2 py-1 bg-[#1e2130] rounded">
                {tournament.status.toUpperCase()}
              </span>
            )}
          </div>
        </div>

        {/* Register Button */}
        <button
          onClick={() => onRegisterClick(tournament)}
          disabled={!isRegistrationOpen || isFull}
          className="w-full py-3 rounded-lg bg-[#ff4655] hover:bg-[#ff3344] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2"
        >
          {isFull ? (
            <>
              <AlertCircle className="w-4 h-4" /> Tournament Full
            </>
          ) : isRegistrationOpen ? (
            <>
              <Users className="w-4 h-4" /> Register Team
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4" /> Registration Closed
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function RegistrationModal({
  tournament,
  onClose,
}: {
  tournament: Tournament | null;
  onClose: () => void;
}) {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [useExisting, setUseExisting] = useState(true);

  if (!tournament) return null;

  const handleRegister = () => {
    if (useExisting && selectedTeamId) {
      // Simulate registration
      localStorage.setItem(
        `tournament_registration_${tournament.id}`,
        JSON.stringify({ teamId: selectedTeamId, timestamp: new Date().toISOString() })
      );
      alert(`Team registered successfully for ${tournament.name}!`);
      onClose();
    } else if (!useExisting && teamName.trim()) {
      // Simulate registration with new team
      localStorage.setItem(
        `tournament_registration_${tournament.id}`,
        JSON.stringify({ teamName: teamName.trim(), timestamp: new Date().toISOString() })
      );
      alert(`Team "${teamName}" registered successfully for ${tournament.name}!`);
      onClose();
    }
  };

  const isFull =
    tournament.event &&
    tournament.event.registeredTeams &&
    tournament.event.registeredTeams.length >= tournament.event.maxTeams;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <h3 className="text-white font-bold text-base">Register for Tournament</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {isFull ? (
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
              <p className="text-yellow-400 text-sm font-semibold">
                This tournament has reached its maximum team capacity.
              </p>
            </div>
          ) : (
            <>
              <p className="text-gray-300 text-sm">
                Register your team for <span className="font-semibold text-white">{tournament.name}</span>
              </p>

              {/* Registration Type Toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setUseExisting(true)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                    useExisting
                      ? 'bg-[#ff4655] text-white'
                      : 'bg-[#1e2130] text-gray-400 hover:text-white'
                  }`}
                >
                  Existing Team
                </button>
                <button
                  onClick={() => setUseExisting(false)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-all ${
                    !useExisting
                      ? 'bg-[#ff4655] text-white'
                      : 'bg-[#1e2130] text-gray-400 hover:text-white'
                  }`}
                >
                  New Team
                </button>
              </div>

              {useExisting ? (
                <div>
                  <label className="block text-xs text-gray-400 mb-2 font-medium">
                    Select Team *
                  </label>
                  <select
                    value={selectedTeamId || ''}
                    onChange={(e) => setSelectedTeamId(e.target.value || null)}
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                  >
                    <option value="">Choose a team...</option>
                    {tournament.teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-2">
                    {tournament.teams.length === 0
                      ? 'No teams available. Contact the organizer.'
                      : `${tournament.teams.length} team(s) available`}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-gray-400 mb-2 font-medium">
                    Team Name *
                  </label>
                  <input
                    type="text"
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                    placeholder="Enter your team name"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRegister}
                  disabled={useExisting ? !selectedTeamId : !teamName.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Register
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function TournamentRegistration({ tournaments }: TournamentRegistrationProps) {
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

  const activeTournaments = tournaments.filter(
    (t) => t.status === 'planning' || t.status === 'registration'
  );
  const inProgressTournaments = tournaments.filter((t) => t.status === 'in-progress');
  const completedTournaments = tournaments.filter((t) => t.status === 'completed');

  return (
    <div className="space-y-12">
      {/* Active Tournaments */}
      {activeTournaments.length > 0 && (
        <section className="space-y-6">
          <div>
            <h2 className="text-white font-bold text-2xl flex items-center gap-2 mb-2">
              <Trophy className="w-6 h-6 text-[#ff4655]" />
              Available Tournaments
            </h2>
            <p className="text-gray-500">Register your team and compete today</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {activeTournaments.map((tournament) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                onRegisterClick={setSelectedTournament}
              />
            ))}
          </div>
        </section>
      )}

      {/* In Progress Tournaments */}
      {inProgressTournaments.length > 0 && (
        <section className="space-y-6">
          <div>
            <h2 className="text-white font-bold text-2xl flex items-center gap-2 mb-2">
              <Trophy className="w-6 h-6 text-yellow-500" />
              In Progress
            </h2>
            <p className="text-gray-500">Watch the action unfold</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {inProgressTournaments.map((tournament) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                onRegisterClick={setSelectedTournament}
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed Tournaments */}
      {completedTournaments.length > 0 && (
        <section className="space-y-6">
          <div>
            <h2 className="text-white font-bold text-2xl flex items-center gap-2 mb-2">
              <Trophy className="w-6 h-6 text-green-500" />
              Completed Tournaments
            </h2>
            <p className="text-gray-500">Past tournaments and champions</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {completedTournaments.map((tournament) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
                onRegisterClick={setSelectedTournament}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {tournaments.length === 0 && (
        <div className="text-center py-20">
          <Trophy className="w-16 h-16 text-gray-600 mx-auto mb-4" />
          <h2 className="text-white font-bold text-xl mb-2">No Tournaments Available</h2>
          <p className="text-gray-500">Check back soon for exciting tournaments!</p>
        </div>
      )}

      {/* Registration Modal */}
      <RegistrationModal tournament={selectedTournament} onClose={() => setSelectedTournament(null)} />
    </div>
  );
}
