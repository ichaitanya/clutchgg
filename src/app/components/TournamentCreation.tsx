import { useState } from 'react';
import { Plus, X, Upload, ChevronRight, ChevronLeft, Trash2, Loader, ExternalLink } from 'lucide-react';
import * as ChallongeAPI from '../services/challongeApi';

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

export interface Tournament {
  id: string;
  name: string;
  overview: string;
  teams: TeamInTournament[];
  bracket?: BracketData;
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

// ── Bracket Creation Modal ─────────────────────────────────────────────────

function BracketCreationModal({
  tournament,
  onClose,
  onSuccess,
}: {
  tournament: Tournament;
  onClose: () => void;
  onSuccess: (bracketData: BracketData) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bracketResult, setBracketResult] = useState<any>(null);
  const [tournamentType, setTournamentType] = useState<'single elimination' | 'double elimination' | 'round robin' | 'swiss'>('single elimination');

  const handleCreateBracket = async () => {
    if (tournament.teams.length === 0) {
      setError('No teams in this tournament');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const teamNames = tournament.teams.map(t => t.name);
      const result = await ChallongeAPI.createFullTournament(
        tournament.name,
        teamNames,
        tournamentType
      );

      setBracketResult(result);
      console.log('Bracket created successfully:', result);
    } catch (err: any) {
      setError(err.message || 'Failed to create bracket');
      console.error('Error creating bracket:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <h3 className="text-white font-bold text-base">Create Tournament Bracket</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {bracketResult ? (
            // Success State
            <div className="space-y-4">
              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4">
                <p className="text-green-400 text-sm font-semibold mb-2">✓ Bracket Created Successfully!</p>
                <p className="text-gray-300 text-xs mb-3">{tournament.teams.length} teams added to the bracket</p>
              </div>

              <div className="space-y-2">
                <p className="text-gray-400 text-xs font-medium">Tournament Details:</p>
                <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3 space-y-2 text-xs">
                  <div>
                    <p className="text-gray-500">Name</p>
                    <p className="text-white font-semibold">{bracketResult.name}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Tournament ID</p>
                    <p className="text-white font-mono text-xs break-all">{bracketResult.tournamentId}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Bracket URL</p>
                    <p className="text-[#ff4655] font-semibold">{bracketResult.bracketUrl}</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const bracketData: BracketData = {
                      challongeId: bracketResult.tournamentId,
                      challongeUrl: bracketResult.tournamentUrl,
                      bracketUrl: bracketResult.bracketUrl,
                      createdAt: new Date().toISOString(),
                    };
                    onSuccess(bracketData);
                  }}
                  className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2"
                >
                  Save & Close
                </button>
                <a
                  href={bracketResult.bracketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" /> View Bracket
                </a>
              </div>
            </div>
          ) : (
            // Creation State
            <div className="space-y-4">
              <div>
                <p className="text-gray-300 text-sm mb-3">
                  Create a bracket on Challonge for <span className="font-semibold text-white">{tournament.name}</span>
                </p>
                <p className="text-gray-500 text-xs">
                  {tournament.teams.length} team{tournament.teams.length !== 1 ? 's' : ''} will be added to the bracket
                </p>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-2 font-medium">
                  Bracket Type *
                </label>
                <select
                  value={tournamentType}
                  onChange={(e) => setTournamentType(e.target.value as any)}
                  className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                >
                  <option value="single elimination">Single Elimination</option>
                  <option value="double elimination">Double Elimination</option>
                  <option value="round robin">Round Robin</option>
                  <option value="swiss">Swiss</option>
                </select>
              </div>

              {error && (
                <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3">
                  <p className="text-red-400 text-xs">{error}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateBracket}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader className="w-4 h-4 animate-spin" /> Creating...
                    </>
                  ) : (
                    <>Create Bracket</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
    }
  );
  const [currentTeam, setCurrentTeam] = useState<TeamInTournament | null>(null);
  const [editingTeamIndex, setEditingTeamIndex] = useState<number | null>(null);
  const [showBracketModal, setShowBracketModal] = useState(false);

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
            {tournament.teams.length > 0 && !tournament.bracket && (
              <button
                onClick={() => setShowBracketModal(true)}
                className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Create Bracket
              </button>
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
      
      {/* Bracket Creation Modal */}
      {showBracketModal && (
        <BracketCreationModal
          tournament={tournament}
          onClose={() => setShowBracketModal(false)}
          onSuccess={handleBracketCreated}
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
export type { Tournament, BracketData, TeamInTournament, TournamentPlayer };
