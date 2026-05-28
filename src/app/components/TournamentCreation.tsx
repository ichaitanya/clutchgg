import { useState } from 'react';
import { Plus, X, Upload, ChevronRight, ChevronLeft, Trash2, Loader, ExternalLink } from 'lucide-react';
import * as ChallongeAPI from '../services/challongeApiDirect';
import { BracketConfigurationModal } from './BracketConfigurationModal';
import { TwoStageTournamentModal } from './TwoStageTournamentModal';

// ── Types ──────────────────────────────────────────────────────────────────

export type PlayerRole = 'igl' | 'duelist' | 'controller' | 'sentinel' | 'initiator';

export interface TournamentPlayer {
  id: string;
  name: string;
  role?: PlayerRole;
  photo?: string; // base64 or URL
}

export interface TeamInTournament {
  id: string;
  name: string;
  logo?: string; // base64 or URL
  players: TournamentPlayer[];
}

export interface TournamentEvent {
  type: 'online' | 'offline' | 'hybrid';
  location?: string;
  startDate: string;
  endDate: string;
  maxTeams: number;
  registeredTeams?: string[]; // Array of team IDs
}

export interface BracketMatch {
  id: string;
  team1Id: string;
  team2Id: string;
  team1Name: string;
  team2Name: string;
  winner?: string; // team ID of winner
  round: number;
  position: number; // Position in the round
  date?: string; // YYYY-MM-DD format
  time?: string; // HH:MM format
}

export interface GroupStageTeam {
  id: string;
  name: string;
  wins?: number;
  losses?: number;
}

export interface Group {
  id: string;
  name: string;
  teams: GroupStageTeam[];
}

export interface GroupStage {
  groups: Group[];
  teamsQualifyingPerGroup: number; // Number of teams from each group that qualify
}

export interface BracketGenerated {
  rounds: BracketMatch[][];
  customizationHistory: Array<{
    timestamp: string;
    changes: string;
  }>;
}

export interface Tournament {
  id: string;
  name: string;
  overview: string;
  teams: TeamInTournament[];
  event?: TournamentEvent;
  bracket?: BracketData;
  generatedBracket?: BracketGenerated;
  groupStage?: GroupStage;
  knockoutBracket?: BracketGenerated; // For second stage
  status: 'planning' | 'registration' | 'in-progress' | 'completed';
}

export interface BracketData {
  challongeId: string;
  challongeUrl: string;
  bracketUrl: string;
  createdAt: string;
}

// ── Player Details Modal ───────────────────────────────────────────────────

function PlayerDetailsForm({
  player,
  onSave,
  onCancel,
  isMandatory,
}: {
  player: TournamentPlayer | null;
  onSave: (player: TournamentPlayer) => void;
  onCancel: () => void;
  isMandatory: boolean;
}) {
  const [form, setForm] = useState<TournamentPlayer>(
    player || { id: Math.random().toString(36).slice(2, 9), name: '', role: undefined }
  );
  const [photoPreview, setPhotoPreview] = useState(player?.photo || '');

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setPhotoPreview(base64);
        setForm(f => ({ ...f, photo: base64 }));
      };
      reader.readAsDataURL(file);
    }
  };

  const isValid = form.name.trim() !== '';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <h3 className="text-white font-bold text-base">
            {player ? 'Edit Player' : 'Add Player'}
          </h3>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Player Photo */}
          <div>
            <label className="block text-xs text-gray-400 mb-2 font-medium">
              Player Photo <span className="text-gray-600">(Optional)</span>
            </label>
            <div className="flex items-center gap-3">
              {photoPreview && (
                <div className="w-16 h-16 rounded-lg overflow-hidden border border-[#2a2d3a]">
                  <img
                    src={photoPreview}
                    alt="preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <label className="flex-1 flex items-center justify-center gap-2 bg-[#0d0f16] border border-dashed border-[#2a2d3a] rounded-lg py-6 cursor-pointer hover:border-[#ff4655]/50 transition-colors">
                <Upload className="w-4 h-4 text-gray-500" />
                <span className="text-xs text-gray-500">Upload photo</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Player Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Player Name {!isMandatory && <span className="text-gray-600">(Optional)</span>}
            </label>
            <input
              type="text"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              placeholder="e.g. jinggg"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Player Role */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Role <span className="text-gray-600">(Optional)</span>
            </label>
            <select
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={form.role || ''}
              onChange={e => setForm(f => ({ ...f, role: e.target.value as PlayerRole || undefined }))}
            >
              <option value="">Select a role...</option>
              <option value="igl">IGL (In-Game Leader)</option>
              <option value="duelist">Duelist</option>
              <option value="controller">Controller</option>
              <option value="sentinel">Sentinel</option>
              <option value="initiator">Initiator</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-[#2a2d3a]">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={!isValid}
            className="flex-1 py-2 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add Players Screen ─────────────────────────────────────────────────────

function AddPlayersScreen({
  team,
  onSave,
  onBack,
}: {
  team: TeamInTournament;
  onSave: (team: TeamInTournament) => void;
  onBack: () => void;
}) {
  const [teamData, setTeamData] = useState(team);
  const [editingPlayerIndex, setEditingPlayerIndex] = useState<number | null>(null);
  const [editingIsNew, setEditingIsNew] = useState(false);

  const mandatorySlots = 5;
  const optionalSlots = 3;
  const totalSlots = mandatorySlots + optionalSlots;

  // Ensure we have enough slots
  const players = [
    ...teamData.players,
    ...Array(Math.max(0, totalSlots - teamData.players.length))
      .fill(null)
      .map((_, i) => ({
        id: `slot-${i}`,
        name: '',
        role: undefined as PlayerRole | undefined,
        photo: undefined,
      })),
  ].slice(0, totalSlots);

  const handleAddPlayer = (index: number) => {
    setEditingPlayerIndex(index);
    setEditingIsNew(true);
  };

  const handleEditPlayer = (index: number) => {
    if (players[index]?.name) {
      setEditingPlayerIndex(index);
      setEditingIsNew(false);
    }
  };

  const handleSavePlayer = (player: TournamentPlayer) => {
    if (editingPlayerIndex !== null) {
      const newPlayers = [...teamData.players];
      newPlayers[editingPlayerIndex] = player;
      setTeamData(t => ({ ...t, players: newPlayers }));
      setEditingPlayerIndex(null);
    }
  };

  const handleRemovePlayer = (index: number) => {
    setTeamData(t => ({
      ...t,
      players: t.players.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 hover:bg-[#1e2130] rounded-lg transition-colors text-gray-500 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-white font-bold text-lg">Add Players</h2>
          <p className="text-gray-500 text-sm">{teamData.name}</p>
        </div>
      </div>

      {/* Player Slots */}
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
        <div className="mb-4">
          <p className="text-gray-400 text-sm">
            Mandatory: <span className="text-white font-semibold">{teamData.players.length}</span> / {mandatorySlots}
          </p>
          <div className="w-full bg-[#0d0f16] h-2 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-[#ff4655] transition-all"
              style={{ width: `${Math.min((teamData.players.length / mandatorySlots) * 100, 100)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          {players.map((player, i) => {
            const isMandatory = i < mandatorySlots;
            const hasPlayer = player && player.name;

            return (
              <div
                key={i}
                className={`border-2 border-dashed rounded-lg p-4 transition-all ${
                  hasPlayer
                    ? 'border-[#ff4655] bg-[#ff4655]/5'
                    : isMandatory
                    ? 'border-[#2a2d3a] hover:border-[#ff4655]/50 bg-[#0d0f16]'
                    : 'border-[#1e2130] hover:border-[#2a2d3a] bg-[#0d0f16]/50'
                }`}
              >
                {hasPlayer ? (
                  <div className="space-y-3">
                    {player.photo && (
                      <div className="w-full h-24 rounded-lg overflow-hidden">
                        <img
                          src={player.photo}
                          alt={player.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div>
                      <p className="text-white font-semibold text-sm truncate">
                        {player.name}
                      </p>
                      {player.role && (
                        <p className="text-gray-400 text-xs uppercase tracking-wider">
                          {player.role}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEditPlayer(i)}
                        className="flex-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] py-1 rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRemovePlayer(i)}
                        className="px-2 text-gray-500 hover:text-[#ff4655] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleAddPlayer(i)}
                    className="w-full h-24 flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-[#ff4655] transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    <span className="text-xs">
                      {isMandatory ? 'Add player' : 'Optional'}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
        >
          Back
        </button>
        <button
          onClick={() => onSave(teamData)}
          disabled={teamData.players.length < mandatorySlots}
          className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <ChevronRight className="w-4 h-4" /> Next Team
        </button>
      </div>

      {/* Player Details Modal */}
      {editingPlayerIndex !== null && (
        <PlayerDetailsForm
          player={players[editingPlayerIndex] || null}
          onSave={handleSavePlayer}
          onCancel={() => setEditingPlayerIndex(null)}
          isMandatory={editingPlayerIndex < mandatorySlots}
        />
      )}
    </div>
  );
}

// ── Add Team Screen ────────────────────────────────────────────────────────

function AddTeamScreen({
  team,
  onSave,
  onBack,
}: {
  team: TeamInTournament | null;
  onSave: (team: TeamInTournament) => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState<TeamInTournament>(
    team || {
      id: Math.random().toString(36).slice(2, 9),
      name: '',
      logo: undefined,
      players: [],
    }
  );
  const [logoPreview, setLogoPreview] = useState(team?.logo || '');

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setLogoPreview(base64);
        setForm(f => ({ ...f, logo: base64 }));
      };
      reader.readAsDataURL(file);
    }
  };

  const isValid = form.name.trim() !== '';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="p-2 hover:bg-[#1e2130] rounded-lg transition-colors text-gray-500 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-white font-bold text-lg">Add Team</h2>
          <p className="text-gray-500 text-sm">Create a new team for the tournament</p>
        </div>
      </div>

      {/* Team Form */}
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-5">
        {/* Team Logo */}
        <div>
          <label className="block text-xs text-gray-400 mb-2 font-medium">
            Team Logo <span className="text-gray-600">(Optional)</span>
          </label>
          <div className="flex items-center gap-3">
            {logoPreview && (
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-[#2a2d3a]">
                <img
                  src={logoPreview}
                  alt="logo"
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <label className="flex-1 flex items-center justify-center gap-2 bg-[#0d0f16] border border-dashed border-[#2a2d3a] rounded-lg py-6 cursor-pointer hover:border-[#ff4655]/50 transition-colors">
              <Upload className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-500">Upload logo</span>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {/* Team Name */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Team Name *
          </label>
          <input
            type="text"
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            placeholder="e.g. Paper Rex"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
        >
          Back
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!isValid}
          className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          Add Players <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Match Edit Modal ───────────────────────────────────────────────────────

function MatchEditModal({
  match,
  onSave,
  onCancel,
}: {
  match: BracketMatch;
  onSave: (match: BracketMatch) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BracketMatch>(match);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <h2 className="text-white font-bold text-lg">Edit Match Schedule</h2>
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Match Info */}
          <div className="bg-[#0d0f16] rounded-lg p-4 border border-[#2a2d3a]">
            <p className="text-gray-400 text-xs mb-2">Match</p>
            <p className="text-white font-semibold text-sm">
              {form.team1Name} vs {form.team2Name}
            </p>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Date</label>
            <input
              type="date"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={form.date || ''}
              onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
            />
          </div>

          {/* Time */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Time</label>
            <input
              type="time"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={form.time || ''}
              onChange={(e) => setForm(f => ({ ...f, time: e.target.value }))}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(form)}
              className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2"
            >
              Save <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Bracket Creation Modal ─────────────────────────────────────────────────

// ── Create Tournament Screen ───────────────────────────────────────────────

function CreateTournamentScreen({
  onComplete,
  initialTournament,
  isEditing = false,
}: {
  onComplete: (tournament: Tournament) => void;
  initialTournament?: Tournament;
  isEditing?: boolean;
}) {
  const [step, setStep] = useState<'tournament' | 'teamList' | 'teamForm' | 'players'>(
    'tournament'
  );
  const [tournament, setTournament] = useState<Tournament>(
    initialTournament || {
      id: Math.random().toString(36).slice(2, 9),
      name: '',
      overview: '',
      teams: [],
      status: 'planning',
    }
  );
  const [currentTeam, setCurrentTeam] = useState<TeamInTournament | null>(null);
  const [editingTeamIndex, setEditingTeamIndex] = useState<number | null>(null);
  const [showBracketModal, setShowBracketModal] = useState(false);
  const [showTwoStageTournamentModal, setShowTwoStageTournamentModal] = useState(false);
  const [editingMatch, setEditingMatch] = useState<BracketMatch | null>(null);
  const [isGeneratingSecondStage, setIsGeneratingSecondStage] = useState(false);

  const handleTournamentSave = (name: string, overview: string) => {
    setTournament(t => ({ ...t, name, overview }));
    setCurrentTeam(null);
    setStep('teamList');
  };

  const handleTeamFormSave = (team: TeamInTournament) => {
    if (editingTeamIndex !== null) {
      // Update existing team
      const newTeams = [...tournament.teams];
      newTeams[editingTeamIndex] = team;
      setTournament(t => ({ ...t, teams: newTeams }));
      setCurrentTeam(team); // Update currentTeam with edited team
    } else {
      // Add new team
      setCurrentTeam(team);
    }
    setStep('players');
  };

  const handlePlayersSave = (team: TeamInTournament) => {
    if (editingTeamIndex !== null) {
      // Update team with new players
      const newTeams = [...tournament.teams];
      newTeams[editingTeamIndex] = team;
      setTournament(t => ({ ...t, teams: newTeams }));
      setEditingTeamIndex(null);
    } else {
      // Add new team
      setTournament(t => ({
        ...t,
        teams: [...t.teams, team],
      }));
    }
    setCurrentTeam(null);
    setStep('teamList');
  };

  const handleDeleteTeam = (index: number) => {
    setTournament(t => ({
      ...t,
      teams: t.teams.filter((_, i) => i !== index),
    }));
  };

  const handleAddTeamComplete = () => {
    onComplete(tournament);
  };

  const handleBracketCreated = (bracketData: BracketData) => {
    setTournament(t => ({ ...t, bracket: bracketData }));
    setShowBracketModal(false);
  };

  const handleBracketConfigurationGenerated = (bracket: BracketGenerated) => {
    setTournament(t => ({ ...t, generatedBracket: bracket }));
    setShowBracketModal(false);
  };

  const handleMatchEdit = (updatedMatch: BracketMatch) => {
    if (!tournament.generatedBracket) return;

    const newBracket = {
      ...tournament.generatedBracket,
      rounds: tournament.generatedBracket.rounds.map(round =>
        round.map(match =>
          match.id === updatedMatch.id ? updatedMatch : match
        )
      ),
    };

    setTournament(t => ({ ...t, generatedBracket: newBracket }));
    setEditingMatch(null);
  };

  const handleTwoStageTournamentComplete = (groupStage: GroupStage) => {
    setTournament(t => ({ ...t, groupStage }));
    setShowTwoStageTournamentModal(false);
    setIsGeneratingSecondStage(true);
    setShowBracketModal(true);
  };

  const handleSecondStageBracketGenerated = (bracket: BracketGenerated) => {
    setTournament(t => ({ ...t, knockoutBracket: bracket }));
    setShowBracketModal(false);
    setIsGeneratingSecondStage(false);
  };

  return (
    <div>
      {step === 'tournament' && (
        <TournamentForm onSave={handleTournamentSave} isEditing={isEditing} initialTournament={tournament} />
      )}
      {step === 'teamList' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-white font-bold text-lg">{tournament.name}</h2>
            <p className="text-gray-500 text-sm">{tournament.overview}</p>
            {isEditing && (
              <button
                onClick={() => setStep('tournament')}
                className="mt-2 text-xs text-[#ff4655] hover:text-[#ff3344] font-semibold flex items-center gap-1"
              >
                <ChevronRight className="w-3 h-3" /> Edit Tournament Details
              </button>
            )}
          </div>

          {/* Teams List */}
          <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">Teams</h3>
            {tournament.teams.length === 0 ? (
              <p className="text-gray-500 text-sm">No teams added yet</p>
            ) : (
              <div className="space-y-2">
                {tournament.teams.map((t, i) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between bg-[#0d0f16] rounded-lg p-3 border border-[#2a2d3a]"
                  >
                    <div className="flex items-center gap-3">
                      {t.logo && (
                        <div className="w-8 h-8 rounded overflow-hidden">
                          <img
                            src={t.logo}
                            alt={t.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div>
                        <p className="text-white text-sm font-semibold">{t.name}</p>
                        <p className="text-gray-500 text-xs">
                          {t.players.length} players
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setCurrentTeam(t);
                          setEditingTeamIndex(i);
                          setStep('teamForm');
                        }}
                        className="px-3 py-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTeam(i)}
                        className="px-2 text-gray-600 hover:text-[#ff4655] transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bracket Section */}
          {tournament.bracket && (
            <div className="bg-[#151821] border border-green-700/50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Tournament Bracket</h3>
                <div className="px-2.5 py-1 rounded-lg bg-green-900/30 border border-green-700/50">
                  <p className="text-xs text-green-400 font-semibold">✓ Active</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-gray-500 text-xs mb-1">Bracket URL</p>
                  <a
                    href={tournament.bracket.bracketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#ff4655] hover:text-[#ff3344] font-semibold flex items-center gap-2 w-fit"
                  >
                    {tournament.bracket.bracketUrl} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-1">Created</p>
                  <p className="text-white text-xs">{new Date(tournament.bracket.createdAt).toLocaleString()}</p>
                </div>
              </div>
            </div>
          )}

          {/* Generated Bracket Matches Section */}
          {tournament.generatedBracket && (
            <div className="bg-[#151821] border border-[#ff4655]/50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Bracket Matches</h3>
                <div className="px-2.5 py-1 rounded-lg bg-[#ff4655]/10 border border-[#ff4655]/30">
                  <p className="text-xs text-[#ff4655] font-semibold">
                    {tournament.generatedBracket.rounds.reduce((sum, round) => sum + round.length, 0)} matches
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {tournament.generatedBracket.rounds.map((round, roundIdx) => (
                  <div key={roundIdx}>
                    <p className="text-gray-400 text-xs font-semibold mb-2">Round {roundIdx + 1}</p>
                    <div className="space-y-2">
                      {round.map((match) => (
                        <div
                          key={match.id}
                          className="flex items-center justify-between bg-[#0d0f16] rounded-lg p-3 border border-[#2a2d3a] hover:border-[#ff4655]/30 transition-colors"
                        >
                          <div className="flex-1">
                            <p className="text-white text-sm font-semibold">
                              {match.team1Name} vs {match.team2Name}
                            </p>
                            {(match.date || match.time) && (
                              <p className="text-gray-500 text-xs mt-1">
                                {match.date && `${match.date}`}
                                {match.date && match.time && ' • '}
                                {match.time && `${match.time}`}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => setEditingMatch(match)}
                            className="ml-3 px-3 py-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] rounded transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Group Stage Section */}
          {tournament.groupStage && (
            <div className="bg-[#151821] border border-blue-700/50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Group Stage</h3>
                <div className="px-2.5 py-1 rounded-lg bg-blue-900/30 border border-blue-700/50">
                  <p className="text-xs text-blue-400 font-semibold">
                    {tournament.groupStage.groups.length} groups • {tournament.groupStage.teamsQualifyingPerGroup} qualify per group
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {tournament.groupStage.groups.map((group) => (
                  <div key={group.id} className="bg-[#0d0f16] rounded-lg p-4 border border-[#2a2d3a]">
                    <h4 className="text-white font-semibold text-sm mb-3">{group.name}</h4>
                    <div className="space-y-2">
                      {group.teams.length === 0 ? (
                        <p className="text-gray-500 text-xs">No teams assigned</p>
                      ) : (
                        group.teams.map((team) => (
                          <div key={team.id} className="flex items-center justify-between bg-[#151821] rounded p-2 text-sm">
                            <span className="text-gray-300">{team.name}</span>
                            {team.wins !== undefined && team.losses !== undefined && (
                              <span className="text-gray-500 text-xs">
                                {team.wins}W - {team.losses}L
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Knockout Stage Section */}
          {tournament.knockoutBracket && (
            <div className="bg-[#151821] border border-purple-700/50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Knockout Stage (2nd Stage)</h3>
                <div className="px-2.5 py-1 rounded-lg bg-purple-900/30 border border-purple-700/50">
                  <p className="text-xs text-purple-400 font-semibold">
                    {tournament.knockoutBracket.rounds.reduce((sum, round) => sum + round.length, 0)} matches
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {tournament.knockoutBracket.rounds.map((round, roundIdx) => (
                  <div key={roundIdx}>
                    <p className="text-gray-400 text-xs font-semibold mb-2">Round {roundIdx + 1}</p>
                    <div className="space-y-2">
                      {round.map((match) => (
                        <div
                          key={match.id}
                          className="flex items-center justify-between bg-[#0d0f16] rounded-lg p-3 border border-[#2a2d3a] hover:border-purple-700/30 transition-colors"
                        >
                          <div className="flex-1">
                            <p className="text-white text-sm font-semibold">
                              {match.team1Name} vs {match.team2Name}
                            </p>
                            {(match.date || match.time) && (
                              <p className="text-gray-500 text-xs mt-1">
                                {match.date && `${match.date}`}
                                {match.date && match.time && ' • '}
                                {match.time && `${match.time}`}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => setEditingMatch(match)}
                            className="ml-3 px-3 py-1 text-xs bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            {isEditing && (
              <button
                onClick={() => onComplete(tournament)}
                className="flex-1 min-w-[120px] py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => {
                setCurrentTeam(null);
                setEditingTeamIndex(null);
                setStep('teamForm');
              }}
              className="flex-1 min-w-[120px] py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Team
            </button>
            {tournament.teams.length > 0 && !tournament.bracket && !tournament.generatedBracket && !tournament.groupStage && !isEditing && (
              <div className="flex gap-2 flex-wrap w-full">
                <button
                  onClick={() => setShowBracketModal(true)}
                  className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Single Stage Bracket
                </button>
                <button
                  onClick={() => setShowTwoStageTournamentModal(true)}
                  className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Two Stage Tournament
                </button>
              </div>
            )}
            {tournament.teams.length > 0 && (
              <button
                onClick={handleAddTeamComplete}
                className="flex-1 min-w-[120px] py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
              >
                {isEditing ? 'Done' : 'Create Tournament'}
              </button>
            )}
          </div>
        </div>
      )}
      {step === 'teamForm' && (
        <AddTeamScreen
          team={currentTeam}
          onSave={handleTeamFormSave}
          onBack={() => setStep('teamList')}
        />
      )}
      {step === 'players' && currentTeam && (
        <AddPlayersScreen
          team={currentTeam}
          onSave={handlePlayersSave}
          onBack={() => {
            setCurrentTeam(null);
            setStep('teamList');
          }}
        />
      )}
      
      {/* Two-Stage Tournament Modal */}
      {showTwoStageTournamentModal && (
        <TwoStageTournamentModal
          teams={tournament.teams}
          onClose={() => setShowTwoStageTournamentModal(false)}
          onComplete={handleTwoStageTournamentComplete}
        />
      )}

      {/* Bracket Creation Modal */}
      {showBracketModal && (
        <BracketConfigurationModal
          onClose={() => {
            setShowBracketModal(false);
            setIsGeneratingSecondStage(false);
          }}
          onGenerate={isGeneratingSecondStage ? handleSecondStageBracketGenerated : handleBracketConfigurationGenerated}
          isSecondStage={isGeneratingSecondStage}
          qualifiedTeamsCount={isGeneratingSecondStage && tournament.groupStage ? tournament.groupStage.groups.length * tournament.groupStage.teamsQualifyingPerGroup : undefined}
        />
      )}

      {/* Match Edit Modal */}
      {editingMatch && (
        <MatchEditModal
          match={editingMatch}
          onSave={handleMatchEdit}
          onCancel={() => setEditingMatch(null)}
        />
      )}
    </div>
  );
}

// ── Tournament Form ────────────────────────────────────────────────────────

function TournamentForm({
  onSave,
  isEditing = false,
  initialTournament,
}: {
  onSave: (name: string, overview: string) => void;
  isEditing?: boolean;
  initialTournament?: Tournament;
}) {
  const [name, setName] = useState(initialTournament?.name || '');
  const [overview, setOverview] = useState(initialTournament?.overview || '');

  const isValid = name.trim() !== '' && overview.trim() !== '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-white font-bold text-lg">
          {isEditing ? 'Edit Tournament' : 'Create Tournament'}
        </h2>
        <p className="text-gray-500 text-sm">
          {isEditing ? 'Update tournament details' : 'Set up a new tournament and add teams'}
        </p>
      </div>

      {/* Form */}
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-5">
        {/* Name */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Tournament Name *
          </label>
          <input
            type="text"
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            placeholder="e.g. VCT Masters Bangkok 2025"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        {/* Overview */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Overview / Description *
          </label>
          <textarea
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors resize-none"
            placeholder="Describe the tournament..."
            rows={4}
            value={overview}
            onChange={e => setOverview(e.target.value)}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => window.location.reload()}
          className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
        >
          {isEditing ? 'Cancel' : 'Cancel'}
        </button>
        <button
          onClick={() => onSave(name, overview)}
          disabled={!isValid}
          className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isEditing ? 'Save' : 'Continue'} <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Main Export ────────────────────────────────────────────────────────────

export { CreateTournamentScreen };
