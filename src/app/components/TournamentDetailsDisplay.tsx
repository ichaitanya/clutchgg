import { Trophy, Users, DollarSign, Calendar, MapPin, X } from 'lucide-react';
import type { Tournament, BracketGenerated } from './TournamentCreation';

interface TournamentDetailsProps {
  tournament: Tournament;
  onClose: () => void;
}

function BracketViewer({ bracket }: { bracket: BracketGenerated }) {
  if (!bracket || bracket.rounds.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No bracket structure available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {bracket.rounds.map((round, roundIndex) => (
        <div key={roundIndex} className="space-y-3">
          <h4 className="text-white font-semibold text-sm px-2">
            Round {roundIndex + 1}
            {bracket.rounds.length > 1 && roundIndex === bracket.rounds.length - 1 && ' - Finals'}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {round.map((match) => (
              <div
                key={match.id}
                className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3"
              >
                <div className="space-y-2">
                  {/* Team 1 */}
                  <div className="flex items-center justify-between">
                    <p className="text-gray-300 text-xs font-medium truncate flex-1">
                      {match.team1Name}
                    </p>
                  </div>

                  {/* VS Divider */}
                  <div className="flex items-center justify-center py-1">
                    <div className="text-xs text-gray-600 font-semibold">VS</div>
                  </div>

                  {/* Team 2 */}
                  <div className="flex items-center justify-between">
                    <p className="text-gray-300 text-xs font-medium truncate flex-1">
                      {match.team2Name}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TournamentDetailsDisplay({ tournament, onClose }: TournamentDetailsProps) {
  // Mock prize pool data - in a real app, this would come from tournament data
  const prizePool = {
    total: '$50,000',
    first: '$25,000',
    second: '$15,000',
    third: '$10,000',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl w-full max-w-4xl my-8 flex flex-col max-h-[calc(100vh-2rem)]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#2a2d3a] sticky top-0 bg-[#151821] z-10 flex-shrink-0">
          <div>
            <h2 className="text-white font-bold text-xl flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#ff4655]" />
              {tournament.name}
            </h2>
            <p className="text-gray-500 text-sm mt-1">{tournament.overview}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {/* Event Details Section */}
          {tournament.event && (
            <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#ff4655]" />
                Event Information
              </h3>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-gray-500 text-xs mb-2 font-medium">Event Type</p>
                  <p className="text-white text-sm font-semibold capitalize">
                    {tournament.event.type}
                  </p>
                </div>
                
                {tournament.event.location && (
                  <div>
                    <p className="text-gray-500 text-xs mb-2 font-medium">Location</p>
                    <p className="text-white text-sm font-semibold flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {tournament.event.location}
                    </p>
                  </div>
                )}
                
                <div>
                  <p className="text-gray-500 text-xs mb-2 font-medium">Start Date</p>
                  <p className="text-white text-sm font-semibold">
                    {new Date(tournament.event.startDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Team Slots & Prize Pool Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Team Slots */}
            <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#ff4655]" />
                Team Slots
              </h3>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b border-[#2a2d3a]">
                  <span className="text-gray-400 text-sm">Total Slots</span>
                  <span className="text-white font-bold">
                    {tournament.event?.maxTeams || tournament.teams.length}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[#2a2d3a]">
                  <span className="text-gray-400 text-sm">Registered Teams</span>
                  <span className="text-[#ff4655] font-bold">{tournament.teams.length}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-gray-400 text-sm">Available Slots</span>
                  <span className="text-[#60a5fa] font-bold">
                    {(tournament.event?.maxTeams || 8) - tournament.teams.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Prize Pool */}
            <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-[#ff4655]" />
                Prize Pool
              </h3>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between py-2 border-b border-[#2a2d3a]">
                  <span className="text-gray-400 text-sm">Total Prize Pool</span>
                  <span className="text-white font-bold text-lg">{prizePool.total}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[#2a2d3a]">
                  <span className="text-gray-400 text-sm">1st Place</span>
                  <span className="text-[#4ade80] font-bold">{prizePool.first}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-[#2a2d3a]">
                  <span className="text-gray-400 text-sm">2nd Place</span>
                  <span className="text-[#60a5fa] font-bold">{prizePool.second}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-gray-400 text-sm">3rd Place</span>
                  <span className="text-[#f59e0b] font-bold">{prizePool.third}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bracket Structure Section */}
          {tournament.generatedBracket && (
            <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Swords className="w-4 h-4 text-[#ff4655]" />
                Bracket Structure
              </h3>
              
              <div className="bg-[#151821] rounded-lg p-4 overflow-x-auto">
                <BracketViewer bracket={tournament.generatedBracket} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Icon import fallback
function Swords(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polyline points="14 12 20 6 21 7 15 13"></polyline>
      <polyline points="10 12 4 6 3 7 9 13"></polyline>
      <line x1="12" y1="14" x2="12" y2="21"></line>
      <line x1="12" y1="3" x2="12" y2="10"></line>
    </svg>
  );
}
