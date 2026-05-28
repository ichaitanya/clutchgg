import { useState } from 'react';
import { Plus, X, Upload, ChevronRight, ChevronLeft, Trash2, ExternalLink, Swords, Grid3x3 } from 'lucide-react';
import * as ChallongeAPI from '../services/challongeApiDirect';
import { BracketConfigurationModal } from './BracketConfigurationModal';
import { TwoStageTournamentModal } from './TwoStageTournamentModal';
import { ExcelImportModal } from './ExcelImportModal';
import {
  generateSimplifiedSingleEliminationBracket,
  generateSimplifiedDoubleEliminationBracket,
  generateSimplifiedRoundRobinBracket,
} from '../utils/bracketUtils';

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
  bracketSection?: 'winners' | 'losers' | 'grand-final';
  // Routing: which match/slot does winner/loser feed into
  winnerGoesTo?: { matchId: string; slot: 1 | 2 };
  loserGoesTo?: { matchId: string; slot: 1 | 2 };
  // True if team was auto-populated by a previous match result (not manually assigned)
  autoPopulated?: boolean;
  // True if this slot needs a team to be manually selected
  needsAssignment?: boolean;
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

export interface RRTeamEntry {
  id: string;
  name: string;
}

export interface BracketGenerated {
  rounds: BracketMatch[][];
  bracketType?: 'single' | 'double' | 'roundrobin';
  rrTeams?: RRTeamEntry[]; // for round robin: ordered list of participating teams
  customizationHistory: Array<{
    timestamp: string;
    changes: string;
  }>;
}

export type Stage1Format = 'single' | 'double' | 'roundrobin' | 'groupstage';
export type Stage2Format = 'single' | 'double';

export interface Stage1Config {
  format: Stage1Format;
  qualifiersCount: number;
  // Only for groupstage format:
  groups?: Group[];
  teamsQualifyingPerGroup?: number;
}

export interface Tournament {
  id: string;
  name: string;
  overview: string;
  tournamentType?: 'single' | 'group';
  teams: TeamInTournament[];
  event?: TournamentEvent;
  bracket?: BracketData;
  // Two-stage tournament fields:
  stage1Config?: Stage1Config;
  stage1Bracket?: BracketGenerated;       // bracket for stage 1 (single/double/rr)
  qualifiedTeams?: TeamInTournament[];    // teams that advance to stage 2
  stage2Format?: Stage2Format;
  stage2Bracket?: BracketGenerated;       // bracket for stage 2
  // Legacy single-stage fields kept for backward compatibility:
  generatedBracket?: BracketGenerated;
  groupStage?: GroupStage;
  knockoutBracket?: BracketGenerated;
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
  existingTeamNames = [],
}: {
  team: TeamInTournament | null;
  onSave: (team: TeamInTournament) => void;
  onBack: () => void;
  existingTeamNames?: string[];
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

  const trimmedName = form.name.trim();
  const isDuplicate = existingTeamNames
    .filter(n => n.toLowerCase() !== (team?.name ?? '').toLowerCase())
    .some(n => n.toLowerCase() === trimmedName.toLowerCase());
  const isValid = trimmedName !== '' && !isDuplicate;

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
            className={`w-full bg-[#0d0f16] border rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none transition-colors ${isDuplicate ? 'border-red-500 focus:border-red-500' : 'border-[#2a2d3a] focus:border-[#ff4655]'}`}
            placeholder="e.g. Paper Rex"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
          {isDuplicate && (
            <p className="text-red-400 text-xs mt-1">A team with this name already exists.</p>
          )}
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
  teams,
  onSave,
  onCancel,
}: {
  match: BracketMatch;
  teams: TeamInTournament[];
  onSave: (match: BracketMatch) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BracketMatch>(match);

  // Allow team selection on round 0 or any match flagged as needsAssignment.
  const isFirstRound = (match.round === 0 || match.needsAssignment === true) && !match.autoPopulated;

  const isSlot = (name: string) =>
    name === 'Select Team' || name.startsWith('Team Slot') || name === 'TBD' ||
    name.startsWith('Winner') || name.startsWith('Loser') ||
    name === 'LB TBD' || name === 'WB Champion' || name === 'LB Champion';

  const TeamSelect = ({
    label,
    teamId,
    teamName,
    excludeId,
    onChange,
  }: {
    label: string;
    teamId: string;
    teamName: string;
    excludeId: string;
    onChange: (id: string, name: string) => void;
  }) => (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5 font-medium">{label}</label>
      {isSlot(teamName) ? (
        <select
          className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
          value={teamId}
          onChange={e => {
            const selected = teams.find(t => t.id === e.target.value);
            if (selected) onChange(selected.id, selected.name);
          }}
        >
          <option value={teamId} disabled>{teamName}</option>
          {teams
            .filter(t => t.id !== excludeId)
            .map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))
          }
        </select>
      ) : (
        <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm">
          {teamName}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-md w-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <h2 className="text-white font-bold text-lg">Edit Match</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {isFirstRound ? (
            <>
              <TeamSelect
                label="Team 1"
                teamId={form.team1Id}
                teamName={form.team1Name}
                excludeId={form.team2Id}
                onChange={(id, name) => setForm(f => ({ ...f, team1Id: id, team1Name: name }))}
              />
              <TeamSelect
                label="Team 2"
                teamId={form.team2Id}
                teamName={form.team2Name}
                excludeId={form.team1Id}
                onChange={(id, name) => setForm(f => ({ ...f, team2Id: id, team2Name: name }))}
              />
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 mb-1">Teams are auto-assigned based on match results.</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm">
                  {form.team1Name}
                </div>
                <span className="text-gray-600 text-xs font-bold">vs</span>
                <div className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm">
                  {form.team2Name}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Date</label>
            <input
              type="date"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={form.date || ''}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Time</label>
            <input
              type="time"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={form.time || ''}
              onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const bothAssigned = teams.some(t => t.id === form.team1Id) && teams.some(t => t.id === form.team2Id);
                onSave({ ...form, needsAssignment: bothAssigned ? false : form.needsAssignment });
              }}
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
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [editingMatch, setEditingMatch] = useState<BracketMatch | null>(null);
  const [isGeneratingSecondStage, setIsGeneratingSecondStage] = useState(false);

  const handleTournamentSave = (name: string, overview: string, tournamentType: 'single' | 'group', event: TournamentEvent) => {
    setTournament(t => ({ ...t, name, overview, tournamentType, event }));
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

  const handleTwoStageTournamentComplete = (config: Stage1Config) => {
    // Generate Stage 1 bracket immediately based on the chosen format
    let stage1Bracket: BracketGenerated | undefined;
    if (config.format === 'single') {
      stage1Bracket = generateSimplifiedSingleEliminationBracket(tournament.teams);
    } else if (config.format === 'double') {
      stage1Bracket = generateSimplifiedDoubleEliminationBracket(tournament.teams);
    } else if (config.format === 'roundrobin') {
      stage1Bracket = generateSimplifiedRoundRobinBracket(tournament.teams);
    }
    // groupstage: auto-generate round-robin matches per group
    if (config.format === 'groupstage' && config.groups) {
      const groupRounds: BracketMatch[][] = config.groups.map(group => {
        const matches: BracketMatch[] = [];
        const teams = group.teams;
        let pos = 0;
        for (let i = 0; i < teams.length; i++) {
          for (let j = i + 1; j < teams.length; j++) {
            matches.push({
              id: `gs_${group.id}_${teams[i].id}_${teams[j].id}`,
              team1Id: teams[i].id,
              team2Id: teams[j].id,
              team1Name: teams[i].name,
              team2Name: teams[j].name,
              round: config.groups!.indexOf(group),
              position: pos++,
            });
          }
        }
        return matches;
      });
      stage1Bracket = {
        rounds: groupRounds,
        bracketType: 'roundrobin',
        customizationHistory: [],
      };
    }
    setTournament(t => ({ ...t, stage1Config: config, stage1Bracket }));
    setShowTwoStageTournamentModal(false);
  };

  const handleSecondStageBracketGenerated = (bracket: BracketGenerated) => {
    setTournament(t => ({ ...t, stage2Bracket: bracket }));
    setShowBracketModal(false);
    setIsGeneratingSecondStage(false);
  };

  const handleExcelImport = (importedTeams: TeamInTournament[]) => {
    setTournament(t => ({ ...t, teams: [...t.teams, ...importedTeams] }));
    setShowExcelImportModal(false);
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

          {/* Event Details Card */}
          {tournament.event && (
            <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
              <h3 className="text-white font-semibold mb-4 text-sm">Event Details</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-gray-500 text-xs mb-2 font-medium">Event Type</p>
                  <p className="text-white text-sm font-semibold capitalize">{tournament.event.type}</p>
                </div>
                {tournament.event.location && (
                  <div>
                    <p className="text-gray-500 text-xs mb-2 font-medium">Location</p>
                    <p className="text-white text-sm font-semibold">{tournament.event.location}</p>
                  </div>
                )}
                <div>
                  <p className="text-gray-500 text-xs mb-2 font-medium">Start Date</p>
                  <p className="text-white text-sm font-semibold">
                    {new Date(tournament.event.startDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
              
              {/* Team Slots */}
              <div className="mt-5 pt-5 border-t border-[#2a2d3a]">
                <p className="text-gray-500 text-xs mb-3 font-medium">Team Registration</p>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-end gap-2 mb-2">
                      <p className="text-white text-lg font-bold">{tournament.teams.length}</p>
                      <p className="text-gray-500 text-sm">/ {tournament.event.maxTeams} teams</p>
                    </div>
                    <div className="w-full bg-[#0d0f16] rounded-full h-2 overflow-hidden border border-[#2a2d3a]">
                      <div
                        className="h-full bg-gradient-to-r from-[#ff4655] to-[#ff6670] transition-all"
                        style={{ width: `${(tournament.teams.length / tournament.event.maxTeams) * 100}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[#60a5fa] text-sm font-semibold">
                      {tournament.event.maxTeams - tournament.teams.length} slots available
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

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
                      {!isEditing && !tournament.generatedBracket && !tournament.bracket && !tournament.stage1Config && !tournament.groupStage && (
                        <button
                          onClick={() => handleDeleteTeam(i)}
                          className="px-2 text-gray-600 hover:text-[#ff4655] transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
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

          {/* Stage 1 Configuration Section */}
          {tournament.stage1Config && (
            <div className="bg-[#151821] border border-purple-700/50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Stage 1 Configuration</h3>
                <div className="px-2.5 py-1 rounded-lg bg-purple-900/30 border border-purple-700/50">
                  <p className="text-xs text-purple-400 font-semibold capitalize">
                    {tournament.stage1Config.format} · {tournament.stage1Config.qualifiersCount} qualify
                  </p>
                </div>
              </div>
              {/* Group details if groupstage */}
              {tournament.stage1Config.format === 'groupstage' && tournament.stage1Config.groups && (
                <div className="space-y-3 mb-4">
                  {tournament.stage1Config.groups.map(group => (
                    <div key={group.id} className="bg-[#0d0f16] rounded-lg p-3 border border-[#2a2d3a]">
                      <h4 className="text-white font-semibold text-xs mb-2">{group.name}</h4>
                      <div className="flex flex-wrap gap-2">
                        {group.teams.map(t => (
                          <span key={t.id} className="px-2 py-0.5 bg-[#1e2130] text-gray-300 text-xs rounded">{t.name}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!isEditing && (
                <button
                  onClick={() => setTournament(t => ({ ...t, stage1Config: undefined, stage1Bracket: undefined, qualifiedTeams: undefined, stage2Bracket: undefined }))}
                  className="w-full py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-semibold transition-all"
                >
                  Reset Stage 1 Configuration
                </button>
              )}
            </div>
          )}

          {/* Legacy group stage section (kept for backward compat) */}
          {tournament.groupStage && !tournament.stage1Config && (
            <div className="bg-[#151821] border border-blue-700/50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Group Stage Configuration</h3>
                <div className="px-2.5 py-1 rounded-lg bg-blue-900/30 border border-blue-700/50">
                  <p className="text-xs text-blue-400 font-semibold">
                    {tournament.groupStage.groups.length} groups • {tournament.groupStage.teamsQualifyingPerGroup} qualify
                  </p>
                </div>
              </div>
              <button
                onClick={() => setTournament(t => ({ ...t, groupStage: undefined, knockoutBracket: undefined }))}
                className="w-full py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-semibold transition-all"
              >
                Reset Group Stage
              </button>
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
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    setTournament(t => ({ ...t, knockoutBracket: undefined }));
                  }}
                  className="flex-1 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-semibold transition-all"
                >
                  Reset Knockout Bracket
                </button>
              </div>
            </div>
          )}

          {/* Create Bracket Section - Available when no bracket exists */}
          {!tournament.generatedBracket && !tournament.bracket && !tournament.groupStage && !tournament.stage1Config && tournament.teams.length > 0 && (
            <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
              <h3 className="text-white font-semibold mb-2">Create Tournament Bracket</h3>
              <p className="text-gray-500 text-sm mb-4">
                Set up the bracket structure and match schedule for your tournament.
              </p>
              <div className="flex gap-3 flex-wrap">
                {tournament.tournamentType === 'group' ? (
                  <button
                    onClick={() => setShowTwoStageTournamentModal(true)}
                    className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Swords className="w-4 h-4" /> Configure Stage 1
                  </button>
                ) : (
                  <button
                    onClick={() => setShowBracketModal(true)}
                    className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Swords className="w-4 h-4" /> Configure Bracket
                  </button>
                )}
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
            {!isEditing && !tournament.generatedBracket && !tournament.bracket && !tournament.groupStage && !tournament.stage1Config && (
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
            )}
            {!tournament.generatedBracket && !tournament.bracket && !tournament.groupStage && !tournament.stage1Config && (
              <button
                onClick={() => setShowExcelImportModal(true)}
                className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 transition-all flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" /> Import from Excel
              </button>
            )}
            {!isEditing && tournament.teams.length > 0 && !tournament.generatedBracket && !tournament.bracket && !tournament.groupStage && !tournament.stage1Config && (
              tournament.tournamentType === 'group' ? (
                <button
                  onClick={() => setShowTwoStageTournamentModal(true)}
                  className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
                >
                  <Swords className="w-4 h-4" /> Configure Stage 1
                </button>
              ) : (
                <button
                  onClick={() => setShowBracketModal(true)}
                  className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition-all flex items-center justify-center gap-2"
                >
                  <Swords className="w-4 h-4" /> Configure Bracket
                </button>
              )
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
          existingTeamNames={tournament.teams.map(t => t.name)}
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
          teams={tournament.teams}
        />
      )}

      {/* Match Edit Modal */}
      {editingMatch && (
        <MatchEditModal
          match={editingMatch}
          teams={tournament.teams}
          onSave={handleMatchEdit}
          onCancel={() => setEditingMatch(null)}
        />
      )}

      {/* Excel Import Modal */}
      {showExcelImportModal && (
        <ExcelImportModal
          onImport={handleExcelImport}
          onCancel={() => setShowExcelImportModal(false)}
          existingTeamNames={tournament.teams.map(t => t.name)}
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
  onSave: (name: string, overview: string, tournamentType: 'single' | 'group', event: TournamentEvent) => void;
  isEditing?: boolean;
  initialTournament?: Tournament;
}) {
  const [name, setName] = useState(initialTournament?.name || '');
  const [overview, setOverview] = useState(initialTournament?.overview || '');
  const [tournamentType, setTournamentType] = useState<'single' | 'group'>(
    initialTournament?.tournamentType || 'single'
  );
  const [eventType, setEventType] = useState<'online' | 'offline' | 'hybrid'>(
    initialTournament?.event?.type || 'online'
  );
  const [location, setLocation] = useState(initialTournament?.event?.location || '');
  const [startDate, setStartDate] = useState(initialTournament?.event?.startDate || '');
  const [maxTeams, setMaxTeams] = useState(initialTournament?.event?.maxTeams?.toString() || '8');

  const isValid = name.trim() !== '' && overview.trim() !== '' && startDate !== '' && maxTeams !== '';

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

        {/* Event Details Section */}
        <div className="border-t border-[#2a2d3a] pt-5 mt-5">
          <h3 className="text-white font-semibold text-sm mb-4">Event Details</h3>
          
          {/* Event Type */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Event Type *
            </label>
            <select
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={eventType}
              onChange={e => setEventType(e.target.value as 'online' | 'offline' | 'hybrid')}
            >
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>

          {/* Location */}
          {eventType !== 'online' && (
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                Location {eventType === 'offline' && '*'}
              </label>
              <input
                type="text"
                className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                placeholder="e.g. Bangkok, Thailand"
                value={location}
                onChange={e => setLocation(e.target.value)}
              />
            </div>
          )}

          {/* Start Date */}
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Start Date *
            </label>
            <input
              type="date"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>

          {/* Max Teams */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Maximum Teams *
            </label>
            <input
              type="number"
              min="2"
              max="128"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              placeholder="e.g. 8"
              value={maxTeams}
              onChange={e => setMaxTeams(e.target.value)}
            />
          </div>
        </div>

        {/* Tournament Format */}
        {!isEditing && (
          <div>
            <label className="block text-xs text-gray-400 mb-3 font-medium">
              Tournament Format *
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTournamentType('single')}
                className={`bg-[#0d0f16] border-2 rounded-lg p-4 transition-all text-left group ${
                  tournamentType === 'single'
                    ? 'border-purple-600 bg-purple-600/10'
                    : 'border-[#2a2d3a] hover:border-purple-600/50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className={`font-semibold text-sm ${tournamentType === 'single' ? 'text-purple-400' : 'text-white'}`}>
                      Single Stage
                    </h4>
                    <p className="text-gray-400 text-xs mt-0.5">Direct bracket</p>
                  </div>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${tournamentType === 'single' ? 'bg-purple-600/30' : 'bg-purple-600/10'}`}>
                    <Swords className="w-3.5 h-3.5 text-purple-400" />
                  </div>
                </div>
                <p className="text-gray-500 text-xs">
                  Teams compete directly in elimination or round-robin format.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setTournamentType('group')}
                className={`bg-[#0d0f16] border-2 rounded-lg p-4 transition-all text-left group ${
                  tournamentType === 'group'
                    ? 'border-blue-600 bg-blue-600/10'
                    : 'border-[#2a2d3a] hover:border-blue-600/50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className={`font-semibold text-sm ${tournamentType === 'group' ? 'text-blue-400' : 'text-white'}`}>
                      Group Stage
                    </h4>
                    <p className="text-gray-400 text-xs mt-0.5">Groups + Knockout</p>
                  </div>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center ${tournamentType === 'group' ? 'bg-blue-600/30' : 'bg-blue-600/10'}`}>
                    <Grid3x3 className="w-3.5 h-3.5 text-blue-400" />
                  </div>
                </div>
                <p className="text-gray-500 text-xs">
                  Teams compete in groups, then qualified teams face off in knockout round.
                </p>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => window.location.reload()}
          className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(name, overview, tournamentType, {
            type: eventType,
            location: location || undefined,
            startDate,
            maxTeams: parseInt(maxTeams, 10),
          })}
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
