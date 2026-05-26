import { useState } from 'react';
import {
  Plus,
  X,
  Edit3,
  Trash2,
  Trophy,
  Users,
  Calendar,
  Globe,
  MapPin,
  ChevronRight,
  Loader,
} from 'lucide-react';
import type { Tournament, TournamentEvent } from './TournamentCreation';
import { CreateTournamentScreen } from './TournamentCreation';
import { BracketDisplay } from './BracketDisplay';
import { BracketConfigurationModal } from './BracketConfigurationModal';

interface TournamentManagerProps {
  tournaments: Tournament[];
  onTournamentsChange: (tournaments: Tournament[]) => void;
}

function EventDetailsForm({
  event,
  onSave,
  onCancel,
}: {
  event: TournamentEvent | null;
  onSave: (event: TournamentEvent) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TournamentEvent>(
    event || {
      type: 'online',
      startDate: '',
      endDate: '',
      maxTeams: 16,
    }
  );

  return (
    <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-bold text-base flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[#ff4655]" />
          Event Details
        </h3>
        <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Event Type */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5 font-medium">Event Type</label>
        <div className="grid grid-cols-3 gap-3">
          {(['online', 'offline', 'hybrid'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setForm((f) => ({ ...f, type }))}
              className={`py-2.5 rounded-lg border-2 transition-colors font-medium text-sm capitalize ${
                form.type === type
                  ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]'
                  : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Location (if offline or hybrid) */}
      {(form.type === 'offline' || form.type === 'hybrid') && (
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">Location</label>
          <input
            type="text"
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            placeholder="e.g. Jakarta, Indonesia"
            value={form.location || ''}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          />
        </div>
      )}

      {/* Dates */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">Start Date</label>
          <input
            type="date"
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">End Date</label>
          <input
            type="date"
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            value={form.endDate}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
          />
        </div>
      </div>

      {/* Max Teams */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5 font-medium">
          Max Teams Slots
        </label>
        <div className="flex gap-2">
          {[4, 8, 16, 32, 64].map((num) => (
            <button
              key={num}
              onClick={() => setForm((f) => ({ ...f, maxTeams: num }))}
              className={`flex-1 py-2.5 rounded-lg border-2 transition-colors font-medium text-sm ${
                form.maxTeams === num
                  ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]'
                  : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50'
              }`}
            >
              {num}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all"
        >
          Save Event Details
        </button>
      </div>
    </div>
  );
}

function BracketGenerationModal({
  tournament,
  onClose,
  onGenerate,
}: {
  tournament: Tournament;
  onClose: () => void;
  onGenerate: (bracket: any) => void;
}) {
  // This is now just a wrapper for the new BracketConfigurationModal
  return (
    <BracketConfigurationModal
      onClose={onClose}
      onGenerate={onGenerate}
    />
  );
}

export function TournamentManager({
  tournaments,
  onTournamentsChange,
}: TournamentManagerProps) {
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [editingTournamentId, setEditingTournamentId] = useState<string | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [editingEventDetails, setEditingEventDetails] = useState<string | null>(null);
  const [bracketGenerationModal, setBracketGenerationModal] = useState<string | null>(null);

  const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId);
  const editingTournament = tournaments.find((t) => t.id === editingTournamentId);

  const handleSaveTournament = (tournament: Tournament) => {
    if (editingTournamentId) {
      onTournamentsChange(
        tournaments.map((t) => (t.id === editingTournamentId ? tournament : t))
      );
      setEditingTournamentId(null);
    } else {
      onTournamentsChange([...tournaments, tournament]);
      setShowCreateTournament(false);
    }
  };

  const handleDeleteTournament = (id: string) => {
    onTournamentsChange(tournaments.filter((t) => t.id !== id));
    if (selectedTournamentId === id) setSelectedTournamentId(null);
  };

  const handleGenerateBracket = (tournamentId: string, bracket: any) => {
    const tournament = tournaments.find((t) => t.id === tournamentId);
    if (!tournament || !bracket) return;

    const updatedTournament = { ...tournament, generatedBracket: bracket, status: 'in-progress' as const };
    onTournamentsChange(
      tournaments.map((t) => (t.id === tournamentId ? updatedTournament : t))
    );
    setSelectedTournamentId(tournamentId);
    setBracketGenerationModal(null);
  };

  if (showCreateTournament || editingTournamentId) {
    return (
      <CreateTournamentScreen
        initialTournament={editingTournament}
        isEditing={!!editingTournamentId}
        onComplete={(tournament) => {
          handleSaveTournament(tournament);
        }}
      />
    );
  }

  if (selectedTournament) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSelectedTournamentId(null)}
            className="p-2 hover:bg-[#1e2130] rounded-lg transition-colors text-gray-500 hover:text-white"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
          </button>
          <div className="flex-1">
            <h2 className="text-white font-bold text-lg">{selectedTournament.name}</h2>
            <p className="text-gray-500 text-sm">{selectedTournament.overview}</p>
          </div>
          <button
            onClick={() => setEditingTournamentId(selectedTournament.id)}
            className="p-2 hover:bg-[#1e2130] rounded-lg transition-colors text-gray-500 hover:text-white"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>

        {/* Event Details */}
        {selectedTournament.event ? (
          <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#ff4655]" />
                Event Details
              </h3>
              <button
                onClick={() => setEditingEventDetails(selectedTournament.id)}
                className="px-3 py-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] rounded transition-colors"
              >
                Edit
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-500 text-xs mb-1">Type</p>
                <p className="text-white text-sm font-semibold capitalize">
                  {selectedTournament.event.type}
                </p>
              </div>
              {selectedTournament.event.location && (
                <div>
                  <p className="text-gray-500 text-xs mb-1">Location</p>
                  <p className="text-white text-sm font-semibold flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {selectedTournament.event.location}
                  </p>
                </div>
              )}
              <div>
                <p className="text-gray-500 text-xs mb-1">Start Date</p>
                <p className="text-white text-sm font-semibold">
                  {new Date(selectedTournament.event.startDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">End Date</p>
                <p className="text-white text-sm font-semibold">
                  {new Date(selectedTournament.event.endDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Max Teams</p>
                <p className="text-white text-sm font-semibold">
                  {selectedTournament.event.registeredTeams?.length || 0} / {selectedTournament.event.maxTeams}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#151821] border border-dashed border-[#2a2d3a] rounded-xl p-6">
            <p className="text-gray-500 text-sm text-center mb-4">No event details set</p>
            <button
              onClick={() => setEditingEventDetails(selectedTournament.id)}
              className="w-full py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all"
            >
              Add Event Details
            </button>
          </div>
        )}

        {/* Bracket Section */}
        {selectedTournament.generatedBracket ? (
          <BracketDisplay
            bracket={selectedTournament.generatedBracket}
            teams={selectedTournament.teams}
            onBracketChange={(bracket) => {
              const updated = { ...selectedTournament, generatedBracket: bracket };
              onTournamentsChange(
                tournaments.map((t) => (t.id === selectedTournament.id ? updated : t))
              );
            }}
            editable={true}
          />
        ) : selectedTournament.teams.length > 0 ? (
          <div className="bg-[#151821] border border-dashed border-[#2a2d3a] rounded-xl p-6">
            <p className="text-gray-500 text-sm text-center mb-4">
              {selectedTournament.teams.length} teams registered. Ready to generate bracket?
            </p>
            <button
              onClick={() => setBracketGenerationModal(selectedTournament.id)}
              className="w-full py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
            >
              <Trophy className="w-4 h-4" /> Generate Bracket
            </button>
          </div>
        ) : (
          <div className="bg-[#151821] border border-dashed border-[#2a2d3a] rounded-xl p-6">
            <p className="text-gray-500 text-sm text-center">
              No teams registered yet. Bracket will be generated once teams register.
            </p>
          </div>
        )}

        {/* Bracket Generation Modal */}
        {bracketGenerationModal && (
          <BracketGenerationModal
            tournament={tournaments.find((t) => t.id === bracketGenerationModal)!}
            onClose={() => setBracketGenerationModal(null)}
            onGenerate={(bracket) => handleGenerateBracket(bracketGenerationModal, bracket)}
          />
        )}

        {/* Event Details Form Modal */}
        {editingEventDetails && editingEventDetails === selectedTournament.id && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
              <EventDetailsForm
                event={selectedTournament.event || null}
                onSave={(event) => {
                  onTournamentsChange(
                    tournaments.map((t) =>
                      t.id === editingEventDetails ? { ...t, event, status: 'registration' } : t
                    )
                  );
                  setEditingEventDetails(null);
                }}
                onCancel={() => setEditingEventDetails(null)}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <Trophy className="w-5 h-5 text-[#ff4655]" />
            Tournaments
          </h2>
          <p className="text-gray-500 text-sm">Manage tournaments and brackets</p>
        </div>
        <button
          onClick={() => setShowCreateTournament(true)}
          className="py-2.5 px-4 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Tournament
        </button>
      </div>

      {/* Tournaments List */}
      {tournaments.length === 0 ? (
        <div className="bg-[#151821] border border-dashed border-[#2a2d3a] rounded-xl p-12 text-center">
          <Trophy className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-500 text-sm mb-4">No tournaments created yet</p>
          <button
            onClick={() => setShowCreateTournament(true)}
            className="inline-flex py-2.5 px-4 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all gap-2"
          >
            <Plus className="w-4 h-4" /> Create First Tournament
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tournaments.map((tournament) => (
            <div
              key={tournament.id}
              className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-4 hover:border-[#ff4655]/50 transition-all cursor-pointer"
            >
              <div className="mb-4">
                <h3 className="text-white font-bold text-sm">{tournament.name}</h3>
                <p className="text-gray-500 text-xs mt-1 line-clamp-2">
                  {tournament.overview}
                </p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 mb-4 py-3 border-y border-[#2a2d3a]">
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Teams</p>
                  <p className="text-white font-bold">{tournament.teams.length}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Status</p>
                  <p className="text-[#ff4655] font-bold capitalize text-xs">
                    {tournament.status}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Bracket</p>
                  <p className="text-white font-bold text-xs">
                    {tournament.generatedBracket ? '✓' : '—'}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedTournamentId(tournament.id)}
                  className="flex-1 py-2 rounded-lg bg-[#0d0f16] hover:border-[#ff4655] border border-[#2a2d3a] text-white text-xs font-semibold transition-all flex items-center justify-center gap-1"
                >
                  <ChevronRight className="w-3 h-3" /> View
                </button>
                <button
                  onClick={() => setEditingTournamentId(tournament.id)}
                  className="px-3 py-2 rounded-lg bg-[#0d0f16] border border-[#2a2d3a] text-gray-500 hover:text-[#ff4655] transition-all"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleDeleteTournament(tournament.id)}
                  className="px-3 py-2 rounded-lg bg-[#0d0f16] border border-[#2a2d3a] text-gray-500 hover:text-red-500 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
