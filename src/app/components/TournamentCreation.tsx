import { useState, useEffect, useMemo } from 'react';
import { Plus, X, Upload, ChevronRight, ChevronLeft, Trash2, ExternalLink, Swords, Grid3x3, Loader, Map as MapIcon, Search, Copy, Check, Youtube, Image as ImageIcon, Lock } from 'lucide-react';
import * as ChallongeAPI from '../services/challongeApiDirect';
import { BracketConfigurationModal } from './BracketConfigurationModal';
import { TwoStageTournamentModal } from './TwoStageTournamentModal';
import { ExcelImportModal } from './ExcelImportModal';
import {
  generateSimplifiedSingleEliminationBracket,
  generateSimplifiedDoubleEliminationBracket,
  generateSimplifiedRoundRobinBracket,
} from '../utils/bracketUtils';
import * as ValorantAPI from '../services/valorantApi';
import { upsertTournament, uploadImage, getTournaments } from '../services/db';
import { normalizePhotoUrl } from '../utils/excelImportUtils';
import { computeRRStandings } from './BracketDisplay';

// ── Types ──────────────────────────────────────────────────────────────────

export type PlayerRole = 'igl' | 'duelist' | 'controller' | 'sentinel' | 'initiator';

export interface PlayerAlias {
  name: string;
  riotId?: string;
}

export interface TournamentPlayer {
  id: string;
  name: string;
  riotId?: string;  // Riot ID in "name#tag" format — used for API match lookups
  role?: PlayerRole;
  photo?: string;   // base64 or URL
  // Previous names/Riot IDs the player has used. When a player renames, the old
  // name/riotId are pushed here so historical stat rows still resolve to them.
  nameHistory?: PlayerAlias[];
}

export interface TeamInTournament {
  id: string;
  name: string;
  description?: string; // optional short bio shown on the team roster page
  logo?: string; // base64 or URL
  players: TournamentPlayer[];
}

export interface PrizePoolEntry {
  position: number; // 1-based placement (1 = 1st place, etc.)
  prize: string;    // Free-form prize text, e.g. "$25,000"
}

export interface PrizePool {
  total?: string;            // Optional total prize pool, e.g. "$50,000"
  places: PrizePoolEntry[];  // One entry per winning placement, ordered by position
}

export interface TournamentEvent {
  type: 'online' | 'offline' | 'hybrid';
  location?: string;
  startDate: string;
  maxTeams: number;
  registeredTeams?: string[]; // Array of team IDs
  prizePool?: PrizePool;
}

export interface MatchMapResult {
  mapName: string;
  team1Score: number;
  team2Score: number;
  playerStats?: MatchPlayerStat[];
  matchId?: string; // Valorant match ID this map was populated from (Segment 2)
}

export interface MatchPlayerStat {
  playerId: string;
  playerName: string;
  teamId: string;
  agent?: string;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  acs: number;
  hsPercent: number;
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
  // Optional human-facing match number (e.g. Challonge's play order) used for
  // "Winner of 6" / "Loser of 11" slot references in the bracket view.
  displayNumber?: number;
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
  // Match format
  format?: 'bo1' | 'bo3' | 'bo5';
  // Match result details
  maps?: MatchMapResult[];
  playerStats?: MatchPlayerStat[];
  // Broadcast: a single live/VOD stream and any number of highlight clips.
  // YouTube links set by the admin in the match edit workflow.
  streamUrl?: string;
  clips?: MatchClip[];
}

export interface MatchClip {
  id: string;
  title: string;
  url: string; // YouTube link
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
  coverImage?: string;
}

// True once any map of a match has had Valorant stats pulled (player stats or a
// source match ID recorded). Editing such a match's structure would corrupt the
// pulled data, so the per-match editor locks these.
export function matchHasStats(match: BracketMatch): boolean {
  if (Array.isArray(match.playerStats) && match.playerStats.length > 0) return true;
  return (match.maps ?? []).some(
    m => (Array.isArray(m.playerStats) && m.playerStats.length > 0) || !!m.matchId
  );
}

// A tournament has "really begun" once either:
//   (a) stats have been pulled for at least one match in any bracket, OR
//   (b) the event's scheduled start date/time has passed.
// Once begun, organizers can no longer change the *bracket type* (regenerate the
// bracket). They keep editing teams/players and any match without pulled stats.
export function tournamentHasBegun(tournament: Tournament): boolean {
  const brackets = [
    tournament.generatedBracket,
    tournament.stage1Bracket,
    tournament.stage2Bracket,
    tournament.knockoutBracket,
  ];
  for (const b of brackets) {
    if (!b) continue;
    for (const m of b.rounds.flat()) {
      if (matchHasStats(m)) return true;
    }
  }
  // Scheduled-start check: any match whose scheduled date/time is in the past,
  // or the event start date being today/past.
  const now = Date.now();
  for (const b of brackets) {
    if (!b) continue;
    for (const m of b.rounds.flat()) {
      if (m.date) {
        const t = new Date(`${m.date}T${m.time || '00:00'}`).getTime();
        if (!Number.isNaN(t) && t <= now) return true;
      }
    }
  }
  if (tournament.event?.startDate) {
    const t = new Date(`${tournament.event.startDate}T00:00`).getTime();
    if (!Number.isNaN(t) && t <= now) return true;
  }
  return false;
}

// Replace a single match (by id) wherever it lives across the tournament's
// brackets, returning a new Tournament. Used to persist an applied scoreboard.
function applyMatchToTournament(tournament: Tournament, updatedMatch: BracketMatch): Tournament {
  const replaceIn = (b?: BracketGenerated): BracketGenerated | undefined =>
    b ? { ...b, rounds: b.rounds.map(r => r.map(m => m.id === updatedMatch.id ? updatedMatch : m)) } : b;
  return {
    ...tournament,
    generatedBracket: replaceIn(tournament.generatedBracket),
    stage1Bracket: replaceIn(tournament.stage1Bracket),
    stage2Bracket: replaceIn(tournament.stage2Bracket),
  };
}

// Prefix every match ID in a bracket with a tournament-scoped prefix so IDs
// are globally unique even when two tournaments generate the same bracket shape.
function scopeBracketIds(bracket: BracketGenerated, prefix: string): BracketGenerated {
  const idMap: Record<string, string> = {};
  const remap = (id: string) => {
    if (!id) return id;
    if (!idMap[id]) idMap[id] = `${prefix}__${id}`;
    return idMap[id];
  };
  return {
    ...bracket,
    rounds: bracket.rounds.map(round =>
      round.map(m => ({
        ...m,
        id: remap(m.id),
        winnerGoesTo: m.winnerGoesTo ? { ...m.winnerGoesTo, matchId: remap(m.winnerGoesTo.matchId) } : undefined,
        loserGoesTo: m.loserGoesTo ? { ...m.loserGoesTo, matchId: remap(m.loserGoesTo.matchId) } : undefined,
      }))
    ),
  };
}

// Write an updated tournament to Supabase (non-blocking, best-effort).
function persistTournament(updated: Tournament): void {
  upsertTournament(updated).catch((err) => console.error('[DB] upsertTournament failed:', err));
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
    player
      ? { ...player, name: player.name ?? '' }
      : { id: Math.random().toString(36).slice(2, 9), name: '', role: undefined }
  );
  const [photoPreview, setPhotoPreview] = useState(player?.photo || '');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  // Whether the current photo was auto-filled from another tournament (vs. set
  // explicitly here) — shown as a hint the admin can override.
  const [photoPrefilled, setPhotoPrefilled] = useState(false);
  // name (lowercased) → existing photo URL, gathered from every tournament.
  const [photoIndex, setPhotoIndex] = useState<Map<string, string>>(new Map());

  // Build a lookup of existing player photos across all tournaments so a player
  // who already has a photo elsewhere shows it automatically when added here.
  useEffect(() => {
    getTournaments()
      .then(ts => {
        const idx = new Map<string, string>();
        for (const t of ts) {
          for (const tm of t.teams) {
            for (const p of (tm.players ?? [])) {
              const k = (p.name ?? '').trim().toLowerCase();
              if (p.photo && k && !idx.has(k)) idx.set(k, p.photo);
            }
          }
        }
        setPhotoIndex(idx);
      })
      .catch(() => {});
  }, []);

  // Prefill the photo from the index when this player has none yet and a match
  // exists for the typed name. Only fills — never overrides an explicit photo.
  useEffect(() => {
    if (form.photo) return;
    const hit = photoIndex.get((form.name ?? '').trim().toLowerCase());
    if (hit) {
      setForm(f => ({ ...f, photo: hit }));
      setPhotoPreview(hit);
      setPhotoPrefilled(true);
    }
  }, [form.name, form.photo, photoIndex]);

  // Upload the photo to Storage and keep only the public URL in the form (no
  // base64 in the tournament blob). Shows an instant local preview meanwhile.
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoUploading(true);
    try {
      const url = await uploadImage(file, 'player-photos');
      setPhotoPreview(url);
      setForm(f => ({ ...f, photo: url }));
      setPhotoPrefilled(false);
    } catch (err) {
      console.error('Photo upload failed', err);
      alert('Photo upload failed. Please try again.');
      setPhotoPreview(player?.photo || '');
    } finally {
      setPhotoUploading(false);
    }
  };

  // Set the photo from a pasted URL (direct link or Google Drive share link).
  const applyPhotoUrl = () => {
    const url = normalizePhotoUrl(photoUrlInput);
    if (!url) return;
    setForm(f => ({ ...f, photo: url }));
    setPhotoPreview(url);
    setPhotoPrefilled(false);
    setPhotoUrlInput('');
  };

  // Clear the current photo (e.g. to remove a prefilled one).
  const clearPhoto = () => {
    setForm(f => ({ ...f, photo: undefined }));
    setPhotoPreview('');
    setPhotoPrefilled(false);
  };

  const isValid = (form.name ?? '').trim() !== '';

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
                <div className="w-16 h-16 rounded-lg overflow-hidden border border-[#2a2d3a] flex-shrink-0">
                  <img
                    src={photoPreview}
                    alt="preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <label className="flex-1 flex items-center justify-center gap-2 bg-[#0d0f16] border border-dashed border-[#2a2d3a] rounded-lg py-6 cursor-pointer hover:border-[#ff4655]/50 transition-colors">
                {photoUploading ? (
                  <>
                    <Loader className="w-4 h-4 text-[#ff4655] animate-spin" />
                    <span className="text-xs text-gray-500">Uploading…</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 text-gray-500" />
                    <span className="text-xs text-gray-500">{photoPreview ? 'Replace photo' : 'Upload photo'}</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  disabled={photoUploading}
                  className="hidden"
                />
              </label>
            </div>

            {/* Or paste an image URL (direct link or Google Drive share link). */}
            <div className="flex gap-2 mt-2">
              <input
                type="url"
                className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-xs focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
                placeholder="…or paste image URL (https:// or Google Drive link)"
                value={photoUrlInput}
                onChange={e => setPhotoUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyPhotoUrl(); } }}
              />
              <button
                type="button"
                onClick={applyPhotoUrl}
                disabled={!photoUrlInput.trim()}
                className="px-3 py-2 bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] text-xs font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Use URL
              </button>
            </div>

            {/* Status line: prefilled hint + remove control. */}
            <div className="flex items-center justify-between mt-1.5 min-h-[1rem]">
              {photoPrefilled ? (
                <span className="text-[10px] text-[#4ade80]">✓ Photo filled from another tournament — replace it above if needed.</span>
              ) : <span />}
              {photoPreview && (
                <button type="button" onClick={clearPhoto} className="text-[10px] text-gray-500 hover:text-[#ff4655] transition-colors">
                  Remove photo
                </button>
              )}
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

          {/* Riot ID — used for API lookups, not shown publicly */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Riot ID <span className="text-gray-600">(Optional)</span>
            </label>
            <input
              type="text"
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              placeholder="e.g. jinggg#NA1"
              value={form.riotId || ''}
              onChange={e => setForm(f => ({ ...f, riotId: e.target.value || undefined }))}
            />
            <p className="text-[11px] text-gray-600 mt-1">Used to pull match history from the API. Not shown on the team page or scoreboard.</p>
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
  const [teamData, setTeamData] = useState({ ...team, players: team.players ?? [] });
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
      const prev = teamData.players[editingPlayerIndex];
      const newPlayers = [...teamData.players];

      // If the player's name or Riot ID changed, push the old values into
      // nameHistory so historical stat rows still resolve to this player.
      if (prev) {
        const nameChanged   = prev.name   && prev.name.trim()   !== player.name.trim();
        const riotIdChanged = prev.riotId && prev.riotId.trim() !== (player.riotId ?? '').trim();
        let history = player.nameHistory ?? [];
        if (nameChanged || riotIdChanged) {
          const alreadyRecorded = history.some(
            a => a.name.toLowerCase() === prev.name.toLowerCase() &&
                 (a.riotId ?? '').toLowerCase() === (prev.riotId ?? '').toLowerCase()
          );
          if (!alreadyRecorded) {
            history = [{ name: prev.name, riotId: prev.riotId }, ...history];
          }
        }
        // Remove any alias whose name+riotId matches the final saved identity —
        // e.g. if they renamed A→B then back to A, "A" should not appear in history.
        history = history.filter(
          a => !(a.name.toLowerCase() === player.name.trim().toLowerCase() &&
                 (a.riotId ?? '').toLowerCase() === (player.riotId ?? '').trim().toLowerCase())
        );
        player = { ...player, nameHistory: history };
      }

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
  const [logoUploading, setLogoUploading] = useState(false);

  // Upload the logo to Storage and keep only the public URL in the form.
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoPreview(URL.createObjectURL(file));
    setLogoUploading(true);
    try {
      const url = await uploadImage(file, 'team-logos');
      setLogoPreview(url);
      setForm(f => ({ ...f, logo: url }));
    } catch (err) {
      console.error('Logo upload failed', err);
      alert('Logo upload failed. Please try again.');
      setLogoPreview(team?.logo || '');
    } finally {
      setLogoUploading(false);
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
              {logoUploading ? (
                <>
                  <Loader className="w-4 h-4 text-[#ff4655] animate-spin" />
                  <span className="text-xs text-gray-500">Uploading…</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500">Upload logo</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                disabled={logoUploading}
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

        {/* Team Description */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Description <span className="text-gray-600">(Optional)</span>
          </label>
          <textarea
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors resize-none"
            placeholder="A short bio shown on the team roster page..."
            rows={3}
            value={form.description ?? ''}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
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

// A tournament match an admin can apply a fetched scoreboard to.
export interface ApplyTarget {
  matchId: string;
  team1Name: string;
  team2Name: string;
  stage: string;
  format: 'bo1' | 'bo3' | 'bo5';
  maxMaps: number;
  maps: MatchMapResult[];
  // Rosters (Riot IDs and/or bare display names) used to suggest this match for
  // a given game based on player overlap.
  team1Roster: string[];
  team2Roster: string[];
}

// Upcoming (not decided) matches with both teams assigned to real teams, across
// all bracket sections — the eligible targets for applying a scoreboard.
function getApplyTargetMatches(tournament: Tournament): ApplyTarget[] {
  const out: ApplyTarget[] = [];
  const sections: { bracket?: BracketGenerated; stage: string }[] = [
    { bracket: tournament.generatedBracket, stage: 'Main Bracket' },
    { bracket: tournament.stage1Bracket, stage: tournament.stage1Config?.format === 'groupstage' ? 'Group Stage' : 'Stage 1' },
    { bracket: tournament.stage2Bracket, stage: 'Stage 2' },
  ];
  for (const { bracket, stage } of sections) {
    if (!bracket) continue;
    for (const m of bracket.rounds.flat()) {
      if (isTeamSlotName(m.team1Name) || isTeamSlotName(m.team2Name)) continue; // both teams real
      const format = (m.format ?? 'bo3') as 'bo1' | 'bo3' | 'bo5';
      const maxMaps = format === 'bo1' ? 1 : format === 'bo5' ? 5 : 3;
      // Skip if already decided (a team reached the needed map wins).
      let w1 = 0, w2 = 0;
      for (const mp of m.maps ?? []) {
        if (mp.team1Score > mp.team2Score) w1++;
        else if (mp.team2Score > mp.team1Score) w2++;
      }
      const needed = Math.ceil(maxMaps / 2);
      if (m.winner || w1 >= needed || w2 >= needed) continue;
      const t1 = tournament.teams.find(t => t.id === m.team1Id);
      const t2 = tournament.teams.find(t => t.id === m.team2Id);
      out.push({
        matchId: m.id,
        team1Name: m.team1Name,
        team2Name: m.team2Name,
        stage,
        format,
        maxMaps,
        maps: m.maps ?? [],
        team1Roster: (t1?.players ?? []).map(p => p.riotId || p.name),
        team2Roster: (t2?.players ?? []).map(p => p.riotId || p.name),
      });
    }
  }
  return out;
}

// ── Match Finder Modal (Segment 1) ─────────────────────────────────────────
// Admin picks one team + a player whose Riot ID we query, fetches that player's
// last 15 custom games, and lists each (score + roster overlap). Each game can
// be expanded to view its scoreboard and applied to a map slot of an upcoming
// tournament match.
function MatchFinderModal({
  teams,
  applyTargets,
  onApply,
  onClose,
}: {
  teams: TeamInTournament[];
  applyTargets: ApplyTarget[];
  onApply: (targetMatchId: string, mapSlotIndex: number, apiMatchId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [teamId, setTeamId] = useState('');
  const [playerRiotId, setPlayerRiotId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ValorantAPI.CustomGameCandidate[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Scoreboard preview state (per expanded game).
  const [openScoreboardId, setOpenScoreboardId] = useState<string | null>(null);
  const [scoreboard, setScoreboard] = useState<ValorantAPI.MatchScoreboard | null>(null);
  const [scoreboardLoading, setScoreboardLoading] = useState(false);
  const [scoreboardError, setScoreboardError] = useState<string | null>(null);

  // Apply state.
  const [applyForId, setApplyForId] = useState<string | null>(null); // which game is being applied
  const [applyTargetId, setApplyTargetId] = useState('');
  const [applySlot, setApplySlot] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyDone, setApplyDone] = useState<string | null>(null); // success message

  // Per-game cache of player Riot IDs (from the scoreboard) for suggestion scoring.
  const [playersByGame, setPlayersByGame] = useState<Record<string, string[]>>({});
  const [suggestLoading, setSuggestLoading] = useState(false);

  const team = teams.find(t => t.id === teamId);
  const sourcePlayers = (team?.players ?? []).filter(p => p.riotId);
  const applyTarget = applyTargets.find(t => t.matchId === applyTargetId);

  // Suggested targets for the game being applied: matches where BOTH teams have
  // >= 3 of their roster appearing among the game's players. Sorted by overlap.
  const SUGGEST_MIN = 3;
  const suggestions: { target: ApplyTarget; t1Found: number; t2Found: number }[] = (() => {
    if (!applyForId) return [];
    const gamePlayers = playersByGame[applyForId];
    if (!gamePlayers) return [];
    return applyTargets
      .map(target => ({
        target,
        t1Found: ValorantAPI.countRiotIdOverlap(gamePlayers, target.team1Roster),
        t2Found: ValorantAPI.countRiotIdOverlap(gamePlayers, target.team2Roster),
      }))
      .filter(s => s.t1Found >= SUGGEST_MIN && s.t2Found >= SUGGEST_MIN)
      .sort((a, b) => (b.t1Found + b.t2Found) - (a.t1Found + a.t2Found));
  })();
  const suggestedIds = new Set(suggestions.map(s => s.target.matchId));

  const handleViewScoreboard = async (matchId: string) => {
    if (openScoreboardId === matchId) { setOpenScoreboardId(null); return; }
    setOpenScoreboardId(matchId);
    setScoreboard(null);
    setScoreboardError(null);
    setScoreboardLoading(true);
    try {
      const sb = await ValorantAPI.getMatchScoreboard(matchId);
      setScoreboard(sb);
      const ids = [...sb.blue, ...sb.red].map(r => r.riotId);
      setPlayersByGame(prev => ({ ...prev, [matchId]: ids }));
    } catch (e) {
      setScoreboardError(e instanceof Error ? e.message : 'Failed to load scoreboard.');
    } finally {
      setScoreboardLoading(false);
    }
  };

  const openApply = async (matchId: string) => {
    setApplyForId(matchId);
    setApplyTargetId('');
    setApplySlot(0);
    setApplyError(null);
    setApplyDone(null);

    // Ensure we have this game's player list for suggestion scoring.
    if (!playersByGame[matchId]) {
      // Reuse the already-open scoreboard if it's this game.
      if (scoreboard && openScoreboardId === matchId) {
        const ids = [...scoreboard.blue, ...scoreboard.red].map(r => r.riotId);
        setPlayersByGame(prev => ({ ...prev, [matchId]: ids }));
      } else {
        setSuggestLoading(true);
        try {
          const sb = await ValorantAPI.getMatchScoreboard(matchId);
          const ids = [...sb.blue, ...sb.red].map(r => r.riotId);
          setPlayersByGame(prev => ({ ...prev, [matchId]: ids }));
        } catch {
          // Suggestions just won't show; the full list is still available.
        } finally {
          setSuggestLoading(false);
        }
      }
    }
  };

  const handleApply = async () => {
    setApplyError(null);
    if (!applyForId) return;
    if (!applyTargetId) { setApplyError('Select a target match.'); return; }
    setApplying(true);
    try {
      await onApply(applyTargetId, applySlot, applyForId);
      const tgt = applyTargets.find(t => t.matchId === applyTargetId);
      setApplyDone(`Applied to ${tgt?.team1Name} vs ${tgt?.team2Name} — Map ${applySlot + 1}.`);
      setApplyForId(null);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Failed to apply scoreboard.');
    } finally {
      setApplying(false);
    }
  };

  const handleFetch = async () => {
    setError(null);
    setCandidates(null);
    if (!team) { setError('Select a team first.'); return; }
    if (!playerRiotId) { setError('Select a player to query.'); return; }
    const [name, tag] = playerRiotId.split('#');
    if (!name || !tag) { setError('Selected player has an invalid Riot ID (expected name#tag).'); return; }

    const roster = team.players.map(p => p.riotId || p.name);

    setLoading(true);
    try {
      const result = await ValorantAPI.getCustomGameCandidates(name, tag, roster, 'ap', 15);
      setCandidates(result);
      if (result.length === 0) setError('No custom games found for this player in their recent history.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch custom games.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(c => (c === id ? null : c)), 1500);
    } catch {
      // Clipboard may be unavailable; selection fallback is the visible text.
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] flex-shrink-0">
          <h2 className="text-white font-bold text-lg flex items-center gap-2">
            <Search className="w-5 h-5 text-[#ff4655]" /> Find Match ID
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          <p className="text-xs text-gray-500">
            Pick a team, then a player whose Riot ID we'll query for their last 15 custom games.
            The overlap count shows how many of that team's roster appeared — use it (and the map/score/time) to spot the right match, then copy its ID.
          </p>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Team</label>
            <select
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
              value={teamId}
              onChange={e => { setTeamId(e.target.value); setPlayerRiotId(''); setCandidates(null); }}
            >
              <option value="">Select team…</option>
              {teams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Player to query (must have a Riot ID)</label>
            <select
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors disabled:opacity-50"
              value={playerRiotId}
              disabled={!team}
              onChange={e => setPlayerRiotId(e.target.value)}
            >
              <option value="">{!team ? 'Select a team first…' : 'Select player…'}</option>
              {sourcePlayers.map(p => (
                <option key={p.id} value={p.riotId}>{p.name} ({p.riotId})</option>
              ))}
            </select>
            {team && sourcePlayers.length === 0 && (
              <p className="text-xs text-yellow-500 mt-1.5">No players on this team have a Riot ID set. Add Riot IDs to query.</p>
            )}
          </div>

          <button
            onClick={handleFetch}
            disabled={loading || !team || !playerRiotId}
            className="w-full py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && <Loader className="w-4 h-4 animate-spin" />}
            {loading ? 'Fetching custom games…' : 'Fetch Last 15 Custom Games'}
          </button>

          {error && (
            <p className="text-xs text-[#ff4655] bg-[#ff4655]/10 px-3 py-2 rounded border border-[#ff4655]/30">{error}</p>
          )}

          {candidates && candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Custom Games</p>
              {candidates.map(c => {
                const present = c.rosterPlayersFound >= 2;
                const tone = c.rosterPlayersFound >= Math.min(c.rosterSize || 5, 5)
                  ? 'border-green-600/50 bg-green-900/10'
                  : present
                  ? 'border-yellow-600/40 bg-yellow-900/10'
                  : 'border-[#2a2d3a]';
                return (
                  <div key={c.matchId} className={`rounded-lg border p-3 ${tone}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold">
                          {c.map || 'Unknown map'} <span className="text-gray-500 font-normal">· {c.blueScore}–{c.redScore}</span>
                        </p>
                        <p className="text-gray-500 text-xs mt-0.5">{c.startedAt || '—'}</p>
                      </div>
                      <button
                        onClick={() => handleCopy(c.matchId)}
                        className="shrink-0 px-2.5 py-1.5 text-xs rounded border border-[#2a2d3a] text-gray-300 hover:border-[#ff4655]/50 hover:text-white transition-colors flex items-center gap-1.5"
                      >
                        {copiedId === c.matchId ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedId === c.matchId ? 'Copied' : 'Copy ID'}
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[11px] text-gray-400">
                        {team?.name ?? 'Team'} players found: <span className="text-white font-semibold">{c.rosterPlayersFound}/{c.rosterSize}</span>
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-600 font-mono mt-1.5 truncate" title={c.matchId}>{c.matchId}</p>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        onClick={() => handleViewScoreboard(c.matchId)}
                        className="px-2.5 py-1.5 text-xs rounded border border-[#2a2d3a] text-gray-300 hover:border-[#ff4655]/50 hover:text-white transition-colors"
                      >
                        {openScoreboardId === c.matchId ? 'Hide scoreboard' : 'View scoreboard'}
                      </button>
                      <button
                        onClick={() => openApply(c.matchId)}
                        className="px-2.5 py-1.5 text-xs rounded bg-[#ff4655]/20 border border-[#ff4655]/50 text-[#ff4655] hover:bg-[#ff4655]/30 transition-colors font-semibold"
                      >
                        Apply this scoreboard to match
                      </button>
                    </div>

                    {/* Scoreboard preview */}
                    {openScoreboardId === c.matchId && (
                      <div className="mt-3 border-t border-[#2a2d3a] pt-3">
                        {scoreboardLoading && (
                          <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader className="w-3.5 h-3.5 animate-spin" /> Loading scoreboard…</p>
                        )}
                        {scoreboardError && (
                          <p className="text-xs text-[#ff4655]">{scoreboardError}</p>
                        )}
                        {scoreboard && !scoreboardLoading && (
                          <div className="space-y-3">
                            <p className="text-xs text-gray-400 font-semibold">
                              {scoreboard.map} · <span className="text-blue-400">Blue {scoreboard.blueScore}</span> – <span className="text-red-400">{scoreboard.redScore} Red</span>
                            </p>
                            {([['Blue', scoreboard.blue, 'text-blue-400'], ['Red', scoreboard.red, 'text-red-400']] as const).map(([label, rows, color]) => (
                              <div key={label}>
                                <p className={`text-[11px] font-bold mb-1 ${color}`}>{label}</p>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-[11px]">
                                    <thead>
                                      <tr className="text-gray-500">
                                        <th className="text-left py-1 pr-2">Player</th>
                                        <th className="text-left py-1 pr-2">Agent</th>
                                        <th className="text-center py-1 px-1">K</th>
                                        <th className="text-center py-1 px-1">D</th>
                                        <th className="text-center py-1 px-1">A</th>
                                        <th className="text-center py-1 px-1">ACS</th>
                                        <th className="text-center py-1 px-1">HS%</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rows.map(r => (
                                        <tr key={r.riotId} className="border-t border-[#2a2d3a]/60">
                                          <td className="py-1 pr-2 text-white">{r.name}</td>
                                          <td className="py-1 pr-2 text-gray-400">{r.agent || '—'}</td>
                                          <td className="py-1 px-1 text-center text-white">{r.kills}</td>
                                          <td className="py-1 px-1 text-center text-white">{r.deaths}</td>
                                          <td className="py-1 px-1 text-center text-white">{r.assists}</td>
                                          <td className="py-1 px-1 text-center text-white">{r.acs}</td>
                                          <td className="py-1 px-1 text-center text-gray-300">{r.hsPercent}%</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Apply picker */}
                    {applyForId === c.matchId && (
                      <div className="mt-3 border-t border-[#2a2d3a] pt-3 space-y-2">
                        <p className="text-xs text-gray-400 font-semibold">Apply to an upcoming match</p>
                        {applyTargets.length === 0 ? (
                          <p className="text-[11px] text-yellow-500">No upcoming matches with both teams assigned.</p>
                        ) : (
                          <>
                            {/* Suggested matches — both teams have ≥3/5 of their roster in this game */}
                            {suggestLoading && !playersByGame[c.matchId] && (
                              <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                                <Loader className="w-3 h-3 animate-spin" /> Finding suggested matches…
                              </p>
                            )}
                            {suggestions.length > 0 && (
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-green-400 font-semibold uppercase tracking-wider">Suggested</p>
                                {suggestions.map(s => (
                                  <button
                                    key={s.target.matchId}
                                    onClick={() => { setApplyTargetId(s.target.matchId); setApplySlot(0); }}
                                    className={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${
                                      applyTargetId === s.target.matchId
                                        ? 'border-green-500 bg-green-900/20'
                                        : 'border-green-700/40 bg-green-900/10 hover:border-green-500/70'
                                    }`}
                                  >
                                    <p className="text-xs text-white font-semibold">
                                      {s.target.team1Name} vs {s.target.team2Name}
                                      <span className="text-gray-400 font-normal"> · {s.target.stage} · {s.target.format.toUpperCase()}</span>
                                    </p>
                                    <p className="text-[10px] text-green-400 mt-0.5">
                                      {s.target.team1Name}: {s.t1Found}/{s.target.team1Roster.length} · {s.target.team2Name}: {s.t2Found}/{s.target.team2Roster.length} matched
                                    </p>
                                  </button>
                                ))}
                                <p className="text-[10px] text-gray-500">Or choose any match below.</p>
                              </div>
                            )}
                            {playersByGame[c.matchId] && suggestions.length === 0 && !suggestLoading && (
                              <p className="text-[11px] text-gray-500">No strong match found (need ≥3 players from each team). Choose manually below.</p>
                            )}

                            <select
                              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-xs focus:border-[#ff4655] focus:outline-none"
                              value={applyTargetId}
                              onChange={e => { setApplyTargetId(e.target.value); setApplySlot(0); }}
                            >
                              <option value="">Select match…</option>
                              {applyTargets.map(t => (
                                <option key={t.matchId} value={t.matchId}>
                                  {suggestedIds.has(t.matchId) ? '★ ' : ''}{t.stage}: {t.team1Name} vs {t.team2Name} ({t.format.toUpperCase()})
                                </option>
                              ))}
                            </select>
                            {applyTarget && (
                              <div>
                                <label className="block text-[11px] text-gray-500 mb-1">Apply to map slot</label>
                                <select
                                  className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-xs focus:border-[#ff4655] focus:outline-none"
                                  value={applySlot}
                                  onChange={e => setApplySlot(Number(e.target.value))}
                                >
                                  {Array.from({ length: applyTarget.maxMaps }).map((_, i) => {
                                    const existing = applyTarget.maps[i];
                                    const filled = existing && existing.matchId ? ' — currently filled (will overwrite)' : '';
                                    return <option key={i} value={i}>Map {i + 1}{filled}</option>;
                                  })}
                                </select>
                              </div>
                            )}
                            {applyError && <p className="text-[11px] text-[#ff4655]">{applyError}</p>}
                            <div className="flex gap-2">
                              <button
                                onClick={handleApply}
                                disabled={applying || !applyTargetId}
                                className="flex-1 py-2 rounded-lg bg-[#ff4655] text-white text-xs font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {applying && <Loader className="w-3.5 h-3.5 animate-spin" />}
                                {applying ? 'Applying…' : 'Confirm Apply'}
                              </button>
                              <button
                                onClick={() => setApplyForId(null)}
                                className="px-3 py-2 rounded-lg border border-[#2a2d3a] text-gray-400 text-xs hover:text-white transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                  </div>
                );
              })}
              {applyDone && (
                <p className="text-xs text-green-400 bg-green-900/10 px-3 py-2 rounded border border-green-700/40 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> {applyDone}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#2a2d3a] flex-shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Match Edit Modal ───────────────────────────────────────────────────────

// Module-level so its identity is stable across MatchEditModal re-renders.
// (Defining it inside the modal remounted the whole Details tab on every
// keystroke, blurring inputs and making fields appear not to retain text.)
function isTeamSlotName(name: string) {
  return name === 'Select Team' || name.startsWith('Team Slot') || name === 'TBD' ||
    name.startsWith('Winner') || name.startsWith('Loser') ||
    name === 'LB TBD' || name === 'WB Champion' || name === 'LB Champion';
}

function MatchEditTeamSelect({
  label,
  teamId,
  teamName,
  excludeId,
  excludeIds,
  teams,
  onChange,
}: {
  label: string;
  teamId: string;
  teamName: string;
  excludeId: string;
  excludeIds?: Set<string>;
  teams: TeamInTournament[];
  onChange: (id: string, name: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1.5 font-medium">{label}</label>
      {isTeamSlotName(teamName) ? (
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
            .filter(t => t.id !== excludeId && !excludeIds?.has(t.id))
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
}

// Per-match "Fetch Match Stats" finder. Scoped to THIS match's two teams: the
// admin picks a player from either team, we fetch their recent custom games but
// keep only those where BOTH rosters have >= 2/5 players, then they view a
// scoreboard and apply a game to a chosen map slot of this match.
function MatchStatsFinder({
  team1,
  team2,
  maxMaps,
  maps,
  onApply,
}: {
  team1?: TeamInTournament;
  team2?: TeamInTournament;
  maxMaps: number;
  maps: MatchMapResult[];
  onApply: (apiMatchId: string, mapSlotIndex: number) => Promise<void>;
}) {
  const [playerRiotId, setPlayerRiotId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ValorantAPI.BothTeamsCandidate[] | null>(null);

  const [openScoreboardId, setOpenScoreboardId] = useState<string | null>(null);
  const [scoreboard, setScoreboard] = useState<ValorantAPI.MatchScoreboard | null>(null);
  const [sbLoading, setSbLoading] = useState(false);
  const [sbError, setSbError] = useState<string | null>(null);

  const [applyForId, setApplyForId] = useState<string | null>(null);
  const [applySlot, setApplySlot] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyDone, setApplyDone] = useState<string | null>(null);

  const sourcePlayers = [
    ...(team1?.players ?? []).map(p => ({ ...p, teamName: team1!.name })),
    ...(team2?.players ?? []).map(p => ({ ...p, teamName: team2!.name })),
  ].filter(p => p.riotId);

  const handleFind = async () => {
    setError(null);
    setCandidates(null);
    if (!team1 || !team2) { setError('Both teams must be assigned first.'); return; }
    if (!playerRiotId) { setError('Select a player to query.'); return; }
    const [name, tag] = playerRiotId.split('#');
    if (!name || !tag) { setError('Selected player has an invalid Riot ID (expected name#tag).'); return; }

    const team1Roster = team1.players.map(p => p.riotId || p.name);
    const team2Roster = team2.players.map(p => p.riotId || p.name);
    setLoading(true);
    try {
      const result = await ValorantAPI.getCustomGamesForBothTeams(name, tag, team1Roster, team2Roster, 'ap', 15, 2);
      setCandidates(result);
      if (result.length === 0) setError('No custom games found where both teams have at least 2 players. Try another player.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch custom games.');
    } finally {
      setLoading(false);
    }
  };

  const handleViewScoreboard = async (matchId: string) => {
    if (openScoreboardId === matchId) { setOpenScoreboardId(null); return; }
    setOpenScoreboardId(matchId);
    setScoreboard(null);
    setSbError(null);
    setSbLoading(true);
    try {
      setScoreboard(await ValorantAPI.getMatchScoreboard(matchId));
    } catch (e) {
      setSbError(e instanceof Error ? e.message : 'Failed to load scoreboard.');
    } finally {
      setSbLoading(false);
    }
  };

  const handleApply = async () => {
    if (!applyForId) return;
    setApplyError(null);
    setApplying(true);
    try {
      await onApply(applyForId, applySlot);
      setApplyDone(`Applied to Map ${applySlot + 1}.`);
      setApplyForId(null);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Failed to apply.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Pick a player from either team and find custom games where <span className="text-gray-300">both teams have ≥2/5 players</span>.
        View a game's scoreboard, then apply it to a map slot.
      </p>

      <div className="flex gap-2">
        <select
          className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
          value={playerRiotId}
          onChange={e => setPlayerRiotId(e.target.value)}
        >
          <option value="">Select player…</option>
          {sourcePlayers.map(p => (
            <option key={p.id} value={p.riotId}>{p.name} ({p.riotId}) — {p.teamName}</option>
          ))}
        </select>
        <button
          onClick={handleFind}
          disabled={loading || !playerRiotId}
          className="shrink-0 px-4 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading && <Loader className="w-4 h-4 animate-spin" />}
          {loading ? 'Finding…' : 'Find Match History'}
        </button>
      </div>

      {sourcePlayers.length === 0 && (
        <p className="text-[11px] text-yellow-500">No players on these teams have a Riot ID set. Add Riot IDs to query.</p>
      )}
      {error && <p className="text-xs text-[#ff4655] bg-[#ff4655]/10 px-3 py-2 rounded border border-[#ff4655]/30">{error}</p>}
      {applyDone && <p className="text-xs text-green-400 bg-green-900/10 px-3 py-2 rounded border border-green-700/40 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> {applyDone}</p>}

      {candidates && candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Matching Custom Games</p>
          {candidates.map(c => (
            <div key={c.matchId} className="rounded-lg border border-green-700/40 bg-green-900/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white text-sm font-semibold">
                    {c.map || 'Unknown map'} <span className="text-gray-500 font-normal">· {c.blueScore}–{c.redScore}</span>
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">{c.startedAt || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[11px] text-gray-400">{team1?.name}: <span className="text-white font-semibold">{c.team1PlayersFound}/{c.team1RosterSize}</span></span>
                <span className="text-[11px] text-gray-400">{team2?.name}: <span className="text-white font-semibold">{c.team2PlayersFound}/{c.team2RosterSize}</span></span>
              </div>

              <div className="flex items-center gap-2 mt-2.5">
                <button
                  onClick={() => handleViewScoreboard(c.matchId)}
                  className="px-2.5 py-1.5 text-xs rounded border border-[#2a2d3a] text-gray-300 hover:border-[#ff4655]/50 hover:text-white transition-colors"
                >
                  {openScoreboardId === c.matchId ? 'Hide scoreboard' : 'View scoreboard'}
                </button>
                <button
                  onClick={() => { setApplyForId(c.matchId); setApplySlot(0); setApplyError(null); setApplyDone(null); }}
                  className="px-2.5 py-1.5 text-xs rounded bg-[#ff4655]/20 border border-[#ff4655]/50 text-[#ff4655] hover:bg-[#ff4655]/30 transition-colors font-semibold"
                >
                  Apply to this match
                </button>
              </div>

              {openScoreboardId === c.matchId && (
                <div className="mt-3 border-t border-[#2a2d3a] pt-3">
                  {sbLoading && <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader className="w-3.5 h-3.5 animate-spin" /> Loading…</p>}
                  {sbError && <p className="text-xs text-[#ff4655]">{sbError}</p>}
                  {scoreboard && !sbLoading && (
                    <div className="space-y-3">
                      <p className="text-xs text-gray-400 font-semibold">
                        {scoreboard.map} · <span className="text-blue-400">Blue {scoreboard.blueScore}</span> – <span className="text-red-400">{scoreboard.redScore} Red</span>
                      </p>
                      {([['Blue', scoreboard.blue, 'text-blue-400'], ['Red', scoreboard.red, 'text-red-400']] as const).map(([label, rows, color]) => (
                        <div key={label}>
                          <p className={`text-[11px] font-bold mb-1 ${color}`}>{label}</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-gray-500">
                                  <th className="text-left py-1 pr-2">Player</th>
                                  <th className="text-left py-1 pr-2">Agent</th>
                                  <th className="text-center py-1 px-1">K</th>
                                  <th className="text-center py-1 px-1">D</th>
                                  <th className="text-center py-1 px-1">A</th>
                                  <th className="text-center py-1 px-1">ACS</th>
                                  <th className="text-center py-1 px-1">HS%</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map(r => (
                                  <tr key={r.riotId} className="border-t border-[#2a2d3a]/60">
                                    <td className="py-1 pr-2 text-white">{r.name}</td>
                                    <td className="py-1 pr-2 text-gray-400">{r.agent || '—'}</td>
                                    <td className="py-1 px-1 text-center text-white">{r.kills}</td>
                                    <td className="py-1 px-1 text-center text-white">{r.deaths}</td>
                                    <td className="py-1 px-1 text-center text-white">{r.assists}</td>
                                    <td className="py-1 px-1 text-center text-white">{r.acs}</td>
                                    <td className="py-1 px-1 text-center text-gray-300">{r.hsPercent}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {applyForId === c.matchId && (
                <div className="mt-3 border-t border-[#2a2d3a] pt-3 space-y-2">
                  <label className="block text-[11px] text-gray-500">Apply to map slot</label>
                  <select
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-xs focus:border-[#ff4655] focus:outline-none"
                    value={applySlot}
                    onChange={e => setApplySlot(Number(e.target.value))}
                  >
                    {Array.from({ length: maxMaps }).map((_, i) => {
                      const existing = maps[i];
                      const filled = existing && existing.matchId ? ' — currently filled (will overwrite)' : '';
                      return <option key={i} value={i}>Map {i + 1}{filled}</option>;
                    })}
                  </select>
                  {applyError && <p className="text-[11px] text-[#ff4655]">{applyError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleApply}
                      disabled={applying}
                      className="flex-1 py-2 rounded-lg bg-[#ff4655] text-white text-xs font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {applying && <Loader className="w-3.5 h-3.5 animate-spin" />}
                      {applying ? 'Applying…' : 'Confirm Apply'}
                    </button>
                    <button onClick={() => setApplyForId(null)} className="px-3 py-2 rounded-lg border border-[#2a2d3a] text-gray-400 text-xs hover:text-white transition-colors">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchEditModal({
  match,
  teams,
  siblingMatches = [],
  onSave,
  onCancel,
}: {
  match: BracketMatch;
  teams: TeamInTournament[];
  siblingMatches?: BracketMatch[];
  onSave: (match: BracketMatch) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BracketMatch>(match);

  // Build the set of team IDs already assigned in OTHER round-1 matches. These
  // are hidden from the dropdowns so the same team can't appear in two matches.
  // Slots that are still unassigned placeholders (isTeamSlotName) are excluded
  // from this set — they don't represent a real locked-in team yet.
  const siblingTakenIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (const m of siblingMatches) {
      if (!isTeamSlotName(m.team1Name)) ids.add(m.team1Id);
      if (!isTeamSlotName(m.team2Name)) ids.add(m.team2Id);
    }
    return ids;
  }, [siblingMatches]);
  const [tab, setTab] = useState<'details' | 'maps' | 'stats'>('details');
  // Segment 2: populate from per-map Valorant match IDs (one per map in the BO format).
  // Seed from any match IDs already saved on the maps so reopening Edit retains them.
  const [matchIdInputs, setMatchIdInputs] = useState<string[]>(
    () => (match.maps ?? []).map(m => m.matchId ?? '')
  );
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showStatsFinder, setShowStatsFinder] = useState(false);
  // True if any map currently carries API-populated data (locks manual editing).
  const populatedFromApi = (form.maps ?? []).some(m => !!m.matchId);

  const isFirstRound = (match.round === 0 || match.needsAssignment === true) && !match.autoPopulated;

  // ── Maps tab helpers ──
  const boFormat = form.format ?? 'bo3';
  const maxMaps = boFormat === 'bo1' ? 1 : boFormat === 'bo3' ? 3 : 5;
  const maps = form.maps ?? [];
  const addMap = () => {
    if (maps.length >= maxMaps) return;
    setForm(f => ({ ...f, maps: [...(f.maps ?? []), { mapName: '', team1Score: 0, team2Score: 0 }] }));
  };
  const removeMap = (i: number) =>
    setForm(f => ({ ...f, maps: (f.maps ?? []).filter((_, idx) => idx !== i) }));
  const updateMap = (i: number, field: keyof MatchMapResult, value: string | number) =>
    setForm(f => ({
      ...f,
      maps: (f.maps ?? []).map((m, idx) => idx === i ? { ...m, [field]: value } : m),
    }));

  // Compute winner from map wins
  const computeWinnerFromMaps = (currentForm: BracketMatch): string | undefined => {
    if (!currentForm.maps || currentForm.maps.length === 0) return currentForm.winner;
    let w1 = 0, w2 = 0;
    for (const m of currentForm.maps) {
      if (m.team1Score > m.team2Score) w1++;
      else if (m.team2Score > m.team1Score) w2++;
    }
    const needed = Math.ceil(maxMaps / 2);
    if (w1 >= needed) return currentForm.team1Id;
    if (w2 >= needed) return currentForm.team2Id;
    if (currentForm.maps.length === maxMaps) {
      // All maps played — most wins wins
      if (w1 > w2) return currentForm.team1Id;
      if (w2 > w1) return currentForm.team2Id;
    }
    return undefined;
  };

  // ── Stats tab helpers ──
  const team1 = teams.find(t => t.id === form.team1Id);
  const team2 = teams.find(t => t.id === form.team2Id);
  const allPlayers = [
    ...(team1?.players ?? []).map(p => ({ ...p, teamId: form.team1Id })),
    ...(team2?.players ?? []).map(p => ({ ...p, teamId: form.team2Id })),
  ];
  const initStats = (): MatchPlayerStat[] =>
    allPlayers.map(p => ({
      playerId: p.id,
      playerName: p.name,
      teamId: p.teamId,
      agent: '',
      kills: 0,
      deaths: 0,
      assists: 0,
      kd: 0,
      acs: 0,
      hsPercent: 0,
    }));
  const stats = form.playerStats && form.playerStats.length > 0 ? form.playerStats : initStats();
  const updateStat = (playerId: string, field: keyof MatchPlayerStat, value: string | number) =>
    setForm(f => ({
      ...f,
      playerStats: (f.playerStats && f.playerStats.length > 0 ? f.playerStats : initStats()).map(s =>
        s.playerId === playerId
          ? {
              ...s,
              [field]: value,
              kd: field === 'kills' || field === 'deaths'
                ? parseFloat((((field === 'kills' ? Number(value) : s.kills)) / Math.max(1, (field === 'deaths' ? Number(value) : s.deaths))).toFixed(2))
                : s.kd,
            }
          : s
      ),
    }));

  // Segment 2: fetch one match ID per map and populate maps + stats (locked once pulled).
  // Entries are optional — a BO3/BO5 may end 2-0, so trailing IDs can be left blank.
  const handlePopulateFromMatchId = async () => {
    setFetchError(null);
    // Keep the original slot index so each fetched map lands in map order.
    // Only consider slots valid for the current BO format.
    const filled = matchIdInputs
      .slice(0, maxMaps)
      .map((id, i) => ({ id: (id || '').trim(), index: i }))
      .filter(e => e.id);
    if (filled.length === 0) { setFetchError('Enter at least one match ID first.'); return; }
    if (!team1 || !team2) { setFetchError('Both teams must be assigned before fetching.'); return; }

    const team1Roster = team1.players.map(p => p.riotId || p.name);
    const team2Roster = team2.players.map(p => p.riotId || p.name);
    const displayNameByRiotId: Record<string, string> = {};
    for (const p of [...team1.players, ...team2.players]) {
      if (p.riotId) displayNameByRiotId[p.riotId.toLowerCase()] = p.name;
    }

    setFetching(true);
    try {
      // Fetch only the slots that have an ID; keep results keyed by slot index so
      // we can merge them into the existing maps without disturbing other slots.
      // (Plain object, not a Map — `Map` here is the lucide-react icon import.)
      const fetchedBySlot: Record<number, MatchMapResult> = {};
      for (const entry of filled) {
        const result = await ValorantAPI.buildMatchResultFromId(
          entry.id, team1Roster, team2Roster, form.team1Id, form.team2Id, displayNameByRiotId
        );
        fetchedBySlot[entry.index] = {
          mapName: result.mapName,
          team1Score: result.team1Score,
          team2Score: result.team2Score,
          playerStats: result.playerStats,
          matchId: entry.id,
        };
      }

      setForm(f => {
        // Build a slot-indexed array up to the last populated slot. Empty slots
        // get an unplayed placeholder so positions are preserved (filling Map 2
        // before Map 1 must not shift it to Map 1).
        const existing = f.maps ?? [];
        const fetchedSlots = Object.keys(fetchedBySlot).map(Number);
        const lastSlot = Math.max(existing.length - 1, ...fetchedSlots);
        const merged: MatchMapResult[] = [];
        for (let i = 0; i <= lastSlot && i < maxMaps; i++) {
          const fetched = fetchedBySlot[i];
          if (fetched) merged.push(fetched);
          else if (existing[i]) merged.push(existing[i]);
          else merged.push({ mapName: '', team1Score: 0, team2Score: 0 });
        }
        const firstWithStats = merged.find(m => m.playerStats && m.playerStats.length > 0);
        return { ...f, maps: merged, playerStats: firstWithStats?.playerStats ?? [] };
      });
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to fetch match data for one of the IDs.');
    } finally {
      setFetching(false);
    }
  };

  // Finder apply: fetch one custom game by ID and write it to a single map slot,
  // preserving other slots (placeholder for any gap before it).
  const handleApplyFinderGame = async (apiMatchId: string, mapSlotIndex: number) => {
    if (!team1 || !team2) throw new Error('Both teams must be assigned before applying.');
    const team1Roster = team1.players.map(p => p.riotId || p.name);
    const team2Roster = team2.players.map(p => p.riotId || p.name);
    const displayNameByRiotId: Record<string, string> = {};
    for (const p of [...team1.players, ...team2.players]) {
      if (p.riotId) displayNameByRiotId[p.riotId.toLowerCase()] = p.name;
    }
    const result = await ValorantAPI.buildMatchResultFromId(
      apiMatchId, team1Roster, team2Roster, form.team1Id, form.team2Id, displayNameByRiotId
    );
    const newMap: MatchMapResult = {
      mapName: result.mapName,
      team1Score: result.team1Score,
      team2Score: result.team2Score,
      playerStats: result.playerStats,
      matchId: apiMatchId,
    };
    setForm(f => {
      const existing = f.maps ?? [];
      const lastSlot = Math.max(existing.length - 1, mapSlotIndex);
      const merged: MatchMapResult[] = [];
      for (let i = 0; i <= lastSlot && i < maxMaps; i++) {
        if (i === mapSlotIndex) merged.push(newMap);
        else if (existing[i]) merged.push(existing[i]);
        else merged.push({ mapName: '', team1Score: 0, team2Score: 0 });
      }
      const firstWithStats = merged.find(m => m.playerStats && m.playerStats.length > 0);
      return { ...f, maps: merged, playerStats: firstWithStats?.playerStats ?? [] };
    });
  };

  const tabs = [
    { id: 'details', label: 'Details' },
    { id: 'maps', label: `Maps${maps.length > 0 ? ` (${maps.length}/${maxMaps})` : ` (${boFormat.toUpperCase()})`}` },
    { id: 'stats', label: 'Player Stats' },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] flex-shrink-0">
          <h2 className="text-white font-bold text-lg">Edit Match</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-4 flex-shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t.id
                  ? 'bg-[#ff4655] text-white'
                  : 'text-gray-400 hover:text-white hover:bg-[#2a2d3a]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {tab === 'details' && (
            <div className="space-y-5">
              {isFirstRound ? (
                <>
                  <MatchEditTeamSelect
                    label="Team 1"
                    teamId={form.team1Id}
                    teamName={form.team1Name}
                    excludeId={form.team2Id}
                    excludeIds={siblingTakenIds}
                    teams={teams}
                    onChange={(id, name) => setForm(f => ({ ...f, team1Id: id, team1Name: name }))}
                  />
                  <MatchEditTeamSelect
                    label="Team 2"
                    teamId={form.team2Id}
                    teamName={form.team2Name}
                    excludeId={form.team1Id}
                    excludeIds={siblingTakenIds}
                    teams={teams}
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

              {/* Match Format */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Match Format</label>
                <div className="flex gap-2">
                  {(['bo1', 'bo3', 'bo5'] as const).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => setForm(f => ({
                        ...f,
                        format: fmt,
                        // Trim maps to new max if needed
                        maps: (f.maps ?? []).slice(0, fmt === 'bo1' ? 1 : fmt === 'bo3' ? 3 : 5),
                      }))}
                      className={`flex-1 py-2 rounded-lg border text-sm font-semibold uppercase transition-all ${
                        (form.format ?? 'bo3') === fmt
                          ? 'border-[#ff4655] bg-[#ff4655]/20 text-[#ff4655]'
                          : 'border-[#2a2d3a] text-gray-400 hover:border-gray-500 hover:text-white'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Broadcast — stream + highlight clips (YouTube links) */}
              <div className="pt-4 border-t border-[#2a2d3a]">
                <label className="block text-xs text-gray-400 mb-1.5 font-medium flex items-center gap-1.5">
                  <Youtube className="w-3.5 h-3.5 text-[#ff4655]" /> Stream URL
                </label>
                <input
                  type="url"
                  placeholder="YouTube stream / VOD link"
                  className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                  value={form.streamUrl || ''}
                  onChange={e => setForm(f => ({ ...f, streamUrl: e.target.value || undefined }))}
                />

                <div className="flex items-center justify-between gap-2 mt-4 mb-1.5">
                  <label className="block text-xs text-gray-400 font-medium flex items-center gap-1.5">
                    <Youtube className="w-3.5 h-3.5 text-[#ff4655]" /> Clips
                  </label>
                  <button
                    onClick={() => setForm(f => ({
                      ...f,
                      clips: [...(f.clips ?? []), { id: Math.random().toString(36).slice(2, 9), title: '', url: '' }],
                    }))}
                    className="px-2.5 py-1 text-xs rounded bg-[#ff4655]/20 border border-[#ff4655]/50 text-[#ff4655] hover:bg-[#ff4655]/30 transition-colors font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add clip
                  </button>
                </div>
                {(form.clips ?? []).length === 0 ? (
                  <p className="text-[11px] text-gray-500">No clips added. Paste YouTube highlight links for this match.</p>
                ) : (
                  <div className="space-y-2">
                    {(form.clips ?? []).map((clip, i) => (
                      <div key={clip.id} className="flex items-center gap-2">
                        <input
                          placeholder="Clip title"
                          className="w-1/3 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                          value={clip.title}
                          onChange={e => {
                            const v = e.target.value;
                            setForm(f => ({ ...f, clips: (f.clips ?? []).map((c, idx) => idx === i ? { ...c, title: v } : c) }));
                          }}
                        />
                        <input
                          placeholder="YouTube link"
                          className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                          value={clip.url}
                          onChange={e => {
                            const v = e.target.value;
                            setForm(f => ({ ...f, clips: (f.clips ?? []).map((c, idx) => idx === i ? { ...c, url: v } : c) }));
                          }}
                        />
                        <button
                          onClick={() => setForm(f => ({ ...f, clips: (f.clips ?? []).filter((_, idx) => idx !== i) }))}
                          className="text-gray-600 hover:text-[#ff4655] transition-colors shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Fetch Match Stats — per-match finder scoped to these two teams */}
              <div className="pt-4 border-t border-[#2a2d3a]">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-xs text-gray-400 font-medium flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5 text-[#ff4655]" /> Fetch Match Stats
                  </label>
                  <button
                    onClick={() => setShowStatsFinder(s => !s)}
                    disabled={!team1 || !team2}
                    className="px-3 py-1.5 text-xs rounded bg-[#ff4655]/20 border border-[#ff4655]/50 text-[#ff4655] hover:bg-[#ff4655]/30 transition-colors font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {showStatsFinder ? 'Hide finder' : 'Find Match Stats'}
                  </button>
                </div>
                {!team1 || !team2 ? (
                  <p className="text-[11px] text-yellow-500 mt-1.5">Assign both teams to use the match stats finder.</p>
                ) : showStatsFinder && (
                  <div className="mt-3">
                    <MatchStatsFinder
                      team1={team1}
                      team2={team2}
                      maxMaps={maxMaps}
                      maps={form.maps ?? []}
                      onApply={handleApplyFinderGame}
                    />
                  </div>
                )}
              </div>

              {/* Populate from Valorant match IDs (Segment 2) — one per map */}
              <div className="pt-4 border-t border-[#2a2d3a]">
                <label className="block text-xs text-gray-400 mb-1.5 font-medium flex items-center gap-1.5">
                  <MapIcon className="w-3.5 h-3.5 text-[#ff4655]" /> Match IDs (manual)
                </label>
                <p className="text-[11px] text-gray-500 mb-2">
                  Paste one Valorant match ID per map played for this {boFormat.toUpperCase()}.
                  Entries are optional — leave trailing maps blank if the series ended early (e.g. 2-0).
                  Fetched data is read-only.
                </p>
                <div className="space-y-2">
                  {Array.from({ length: maxMaps }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-500 font-semibold w-12 shrink-0">Map {i + 1}</span>
                      <input
                        placeholder={`Match ID for map ${i + 1}${i > 0 ? ' (optional)' : ''}`}
                        className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm font-mono focus:border-[#ff4655] focus:outline-none transition-colors"
                        value={matchIdInputs[i] ?? ''}
                        onChange={e => {
                          const v = e.target.value;
                          setMatchIdInputs(prev => {
                            const next = [...prev];
                            while (next.length < maxMaps) next.push('');
                            next[i] = v;
                            return next.slice(0, maxMaps);
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={handlePopulateFromMatchId}
                  disabled={fetching || !matchIdInputs.some(id => (id || '').trim())}
                  className="w-full mt-3 px-4 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fetching && <Loader className="w-4 h-4 animate-spin" />}
                  {fetching ? 'Fetching…' : 'Fetch & Populate'}
                </button>
                {fetchError && (
                  <p className="text-xs text-[#ff4655] bg-[#ff4655]/10 px-3 py-2 rounded border border-[#ff4655]/30 mt-2">{fetchError}</p>
                )}
                {populatedFromApi && (
                  <p className="text-xs text-green-400 bg-green-900/10 px-3 py-2 rounded border border-green-700/40 mt-2 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> {(form.maps ?? []).filter(m => m.matchId).length} map(s) populated from match IDs. Add the next map's ID and Fetch again to append it, then Save.
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === 'maps' && (
            <fieldset disabled={populatedFromApi} className="space-y-4 disabled:opacity-90">
              {populatedFromApi && (
                <p className="text-xs text-green-400 bg-green-900/10 px-3 py-2 rounded border border-green-700/40 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Read-only — these maps were populated from Valorant match IDs.
                </p>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Enter the result of each map played.</p>
                <span className="text-xs text-gray-500 font-semibold">{maps.length}/{maxMaps} maps · {boFormat.toUpperCase()}</span>
              </div>
              {maps.map((m, i) => (
                <div key={i} className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Map {i + 1}</span>
                    <button onClick={() => removeMap(i)} className="text-gray-600 hover:text-red-400 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    placeholder="Map name (e.g. Ascent)"
                    className="w-full bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                    value={m.mapName}
                    onChange={e => updateMap(i, 'mapName', e.target.value)}
                  />
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">{form.team1Name}</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                        value={m.team1Score}
                        onChange={e => updateMap(i, 'team1Score', parseInt(e.target.value) || 0)}
                      />
                    </div>
                    <span className="text-gray-600 font-bold mt-5">:</span>
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">{form.team2Name}</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                        value={m.team2Score}
                        onChange={e => updateMap(i, 'team2Score', parseInt(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={addMap}
                disabled={maps.length >= maxMaps}
                className="w-full py-2.5 rounded-lg border border-dashed border-[#2a2d3a] text-gray-400 text-sm hover:border-[#ff4655]/50 hover:text-white transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" /> Add Map {maps.length >= maxMaps ? `(max ${maxMaps} for ${boFormat.toUpperCase()})` : ''}
              </button>
            </fieldset>
          )}

          {tab === 'stats' && (
            <fieldset disabled={populatedFromApi} className="space-y-6 disabled:opacity-90">
              {populatedFromApi && (
                <p className="text-xs text-green-400 bg-green-900/10 px-3 py-2 rounded border border-green-700/40 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Read-only — these maps were populated from Valorant match IDs.
                </p>
              )}
              {allPlayers.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-6">No players found for these teams. Add players to the teams first.</p>
              ) : (
                [form.team1Id, form.team2Id].map(teamId => {
                  const teamObj = teams.find(t => t.id === teamId);
                  if (!teamObj || teamObj.players.length === 0) return null;
                  const teamStats = stats.filter(s => s.teamId === teamId);
                  return (
                    <div key={teamId}>
                      <p className="text-white text-sm font-bold mb-3 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#ff4655]" />
                        {teamObj.name}
                      </p>
                      <div className="space-y-3">
                        {teamStats.map(s => (
                          <div key={s.playerId} className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3">
                            <p className="text-white text-sm font-semibold mb-2">{s.playerName}</p>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">Agent</label>
                                <input
                                  placeholder="e.g. Jett"
                                  className="w-full bg-[#151821] border border-[#2a2d3a] rounded px-2 py-1.5 text-white text-xs focus:border-[#ff4655] focus:outline-none"
                                  value={s.agent ?? ''}
                                  onChange={e => updateStat(s.playerId, 'agent', e.target.value)}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">K</label>
                                <input type="number" min={0} className="w-full bg-[#151821] border border-[#2a2d3a] rounded px-2 py-1.5 text-white text-xs focus:border-[#ff4655] focus:outline-none" value={s.kills} onChange={e => updateStat(s.playerId, 'kills', parseInt(e.target.value) || 0)} />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">D</label>
                                <input type="number" min={0} className="w-full bg-[#151821] border border-[#2a2d3a] rounded px-2 py-1.5 text-white text-xs focus:border-[#ff4655] focus:outline-none" value={s.deaths} onChange={e => updateStat(s.playerId, 'deaths', parseInt(e.target.value) || 0)} />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">A</label>
                                <input type="number" min={0} className="w-full bg-[#151821] border border-[#2a2d3a] rounded px-2 py-1.5 text-white text-xs focus:border-[#ff4655] focus:outline-none" value={s.assists} onChange={e => updateStat(s.playerId, 'assists', parseInt(e.target.value) || 0)} />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">ACS</label>
                                <input type="number" min={0} className="w-full bg-[#151821] border border-[#2a2d3a] rounded px-2 py-1.5 text-white text-xs focus:border-[#ff4655] focus:outline-none" value={s.acs} onChange={e => updateStat(s.playerId, 'acs', parseInt(e.target.value) || 0)} />
                              </div>
                              <div>
                                <label className="block text-xs text-gray-500 mb-1">HS%</label>
                                <input type="number" min={0} max={100} className="w-full bg-[#151821] border border-[#2a2d3a] rounded px-2 py-1.5 text-white text-xs focus:border-[#ff4655] focus:outline-none" value={s.hsPercent} onChange={e => updateStat(s.playerId, 'hsPercent', parseInt(e.target.value) || 0)} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </fieldset>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#2a2d3a] flex-shrink-0">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const bothAssigned = teams.some(t => t.id === form.team1Id) && teams.some(t => t.id === form.team2Id);
              const computedWinner = computeWinnerFromMaps(form);
              const finalForm: BracketMatch = {
                ...form,
                winner: computedWinner,
                needsAssignment: bothAssigned ? false : form.needsAssignment,
              };
              onSave(finalForm);
            }}
            className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2"
          >
            Save <ChevronRight className="w-4 h-4" />
          </button>
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
  organizerMode = false,
  bracketLocked = false,
}: {
  onComplete: (tournament: Tournament) => void;
  initialTournament?: Tournament;
  isEditing?: boolean;
  // Scoped organizer editing this tournament.
  organizerMode?: boolean;
  // True once the tournament has begun: bracket-type changes are forbidden.
  bracketLocked?: boolean;
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
  // The other round-1 matches in the same bracket when a round-1 match is being
  // edited — used to exclude already-assigned teams from the team dropdowns.
  const [editingMatchSiblings, setEditingMatchSiblings] = useState<BracketMatch[]>([]);
  const [isGeneratingSecondStage, setIsGeneratingSecondStage] = useState(false);

  const handleTournamentSave = (name: string, overview: string, tournamentType: 'single' | 'group', event: TournamentEvent, coverImage?: string) => {
    setTournament(t => ({ ...t, name, overview, tournamentType, event, ...(coverImage && { coverImage }) }));
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
    setTournament(t => ({ ...t, generatedBracket: scopeBracketIds(bracket, t.id) }));
    setShowBracketModal(false);
  };

  const handleMatchEdit = (updatedMatch: BracketMatch) => {
    // If the match isn't in the main generated bracket, it's a stage1/stage2
    // match — replace it there, persist, and return.
    const inGenerated = tournament.generatedBracket?.rounds.flat().some(m => m.id === updatedMatch.id);
    if (!inGenerated) {
      const replaceIn = (b?: BracketGenerated) =>
        b ? { ...b, rounds: b.rounds.map(r => r.map(m => m.id === updatedMatch.id ? updatedMatch : m)) } : b;
      const updated = {
        ...tournament,
        stage1Bracket: replaceIn(tournament.stage1Bracket),
        stage2Bracket: replaceIn(tournament.stage2Bracket),
      };
      setTournament(updated);
      persistTournament(updated);
      setEditingMatch(null); setEditingMatchSiblings([]);
      return;
    }

    // Replace the match in the bracket
    let newRounds = tournament.generatedBracket!.rounds.map(round =>
      round.map(match => match.id === updatedMatch.id ? updatedMatch : match)
    );

    // Propagate winner to the next slot if a winner was set
    if (updatedMatch.winner) {
      const winnerId = updatedMatch.winner;
      const winnerName = winnerId === updatedMatch.team1Id ? updatedMatch.team1Name : updatedMatch.team2Name;
      const loserId = winnerId === updatedMatch.team1Id ? updatedMatch.team2Id : updatedMatch.team1Id;
      const loserName = winnerId === updatedMatch.team1Id ? updatedMatch.team2Name : updatedMatch.team1Name;

      const applyToSlot = (rounds: BracketMatch[][], matchId: string, slot: 1 | 2, teamId: string, teamName: string) =>
        rounds.map(round => round.map(m => {
          if (m.id !== matchId) return m;
          return slot === 1
            ? { ...m, team1Id: teamId, team1Name: teamName, winner: undefined, autoPopulated: true }
            : { ...m, team2Id: teamId, team2Name: teamName, winner: undefined, autoPopulated: true };
        }));

      if (tournament.generatedBracket!.bracketType === 'double' && updatedMatch.winnerGoesTo) {
        newRounds = applyToSlot(newRounds, updatedMatch.winnerGoesTo.matchId, updatedMatch.winnerGoesTo.slot, winnerId, winnerName);
        if (updatedMatch.loserGoesTo) {
          const actualLoserId = winnerId === updatedMatch.team1Id ? updatedMatch.team2Id : updatedMatch.team1Id;
          const actualLoserName = winnerId === updatedMatch.team1Id ? updatedMatch.team2Name : updatedMatch.team1Name;
          newRounds = applyToSlot(newRounds, updatedMatch.loserGoesTo.matchId, updatedMatch.loserGoesTo.slot, actualLoserId, actualLoserName);
        }
      } else if (tournament.generatedBracket!.bracketType !== 'roundrobin') {
        // Single elim: find the round and advance winner
        const roundIdx = newRounds.findIndex(r => r.some(m => m.id === updatedMatch.id));
        const matchIdx = newRounds[roundIdx]?.findIndex(m => m.id === updatedMatch.id) ?? -1;
        const nextRound = newRounds[roundIdx + 1];
        if (nextRound && matchIdx >= 0) {
          const nextMatchIdx = Math.floor(matchIdx / 2);
          const isTeam1Slot = matchIdx % 2 === 0;
          newRounds = newRounds.map((r, rIdx) => {
            if (rIdx !== roundIdx + 1) return r;
            return r.map((m, j) => {
              if (j !== nextMatchIdx) return m;
              return isTeam1Slot
                ? { ...m, team1Id: winnerId, team1Name: winnerName, winner: undefined, autoPopulated: true }
                : { ...m, team2Id: winnerId, team2Name: winnerName, winner: undefined, autoPopulated: true };
            });
          });
        }
      }

      void loserId; void loserName; // used above via destructuring
    }

    const newBracket = {
      ...tournament.generatedBracket!,
      rounds: newRounds,
      customizationHistory: [
        ...tournament.generatedBracket!.customizationHistory,
        { timestamp: new Date().toISOString(), changes: `Match ${updatedMatch.id} updated` },
      ],
    };

    const updated = { ...tournament, generatedBracket: newBracket };
    setTournament(updated);
    persistTournament(updated);
    setEditingMatch(null); setEditingMatchSiblings([]);
  };

  // Apply a fetched custom-game scoreboard to one map slot of a target match.
  // Reuses handleMatchEdit for generatedBracket (so winner propagation runs),
  // and updates stage1/stage2 brackets in place otherwise.
  const handleApplyScoreboardToMatch = async (
    targetMatchId: string,
    mapSlotIndex: number,
    apiMatchId: string,
  ): Promise<void> => {
    // Locate the target match and which bracket it lives in.
    const brackets: { key: 'generatedBracket' | 'stage1Bracket' | 'stage2Bracket'; bracket?: BracketGenerated }[] = [
      { key: 'generatedBracket', bracket: tournament.generatedBracket },
      { key: 'stage1Bracket', bracket: tournament.stage1Bracket },
      { key: 'stage2Bracket', bracket: tournament.stage2Bracket },
    ];
    let found: { key: typeof brackets[number]['key']; match: BracketMatch } | null = null;
    for (const b of brackets) {
      const m = b.bracket?.rounds.flat().find(mm => mm.id === targetMatchId);
      if (m) { found = { key: b.key, match: m }; break; }
    }
    if (!found) throw new Error('Target match not found.');

    const target = found.match;
    const team1 = tournament.teams.find(t => t.id === target.team1Id);
    const team2 = tournament.teams.find(t => t.id === target.team2Id);
    if (!team1 || !team2) throw new Error('Target match teams are not fully assigned.');

    const team1Roster = team1.players.map(p => p.riotId || p.name);
    const team2Roster = team2.players.map(p => p.riotId || p.name);
    const displayNameByRiotId: Record<string, string> = {};
    for (const p of [...team1.players, ...team2.players]) {
      if (p.riotId) displayNameByRiotId[p.riotId.toLowerCase()] = p.name;
    }

    const result = await ValorantAPI.buildMatchResultFromId(
      apiMatchId, team1Roster, team2Roster, target.team1Id, target.team2Id, displayNameByRiotId
    );
    const newMap: MatchMapResult = {
      mapName: result.mapName,
      team1Score: result.team1Score,
      team2Score: result.team2Score,
      playerStats: result.playerStats,
      matchId: apiMatchId,
    };

    // Merge the new map into the chosen slot, preserving other slots.
    const maxMaps = target.format === 'bo1' ? 1 : target.format === 'bo5' ? 5 : 3;
    const existingMaps = target.maps ?? [];
    // Keep maps positionally indexed by slot so applying to Map 2 before Map 1
    // doesn't shift it to Map 1. Empty slots are held with an "unplayed"
    // placeholder (no matchId/stats, 0-0) so positions are preserved.
    const lastSlot = Math.max(existingMaps.length - 1, mapSlotIndex);
    const mergedMaps: MatchMapResult[] = [];
    for (let i = 0; i <= lastSlot && i < maxMaps; i++) {
      if (i === mapSlotIndex) mergedMaps.push(newMap);
      else if (existingMaps[i]) mergedMaps.push(existingMaps[i]);
      else mergedMaps.push({ mapName: '', team1Score: 0, team2Score: 0 }); // unplayed placeholder
    }

    // Recompute winner from maps (BOn: ceil(maxMaps/2) map wins).
    let w1 = 0, w2 = 0;
    for (const m of mergedMaps) {
      if (m.team1Score > m.team2Score) w1++;
      else if (m.team2Score > m.team1Score) w2++;
    }
    const needed = Math.ceil(maxMaps / 2);
    const winner = w1 >= needed ? target.team1Id
      : w2 >= needed ? target.team2Id
      : (mergedMaps.length >= maxMaps && w1 !== w2) ? (w1 > w2 ? target.team1Id : target.team2Id)
      : undefined;

    const firstWithStats = mergedMaps.find(m => m.playerStats && m.playerStats.length > 0);
    const updatedMatch: BracketMatch = {
      ...target,
      maps: mergedMaps,
      playerStats: firstWithStats?.playerStats ?? [],
      winner,
    };

    if (found.key === 'generatedBracket') {
      handleMatchEdit(updatedMatch); // runs winner propagation; clears editingMatch (no-op here)
      // Persist immediately so the public match page (which reads localStorage)
      // reflects the applied stats without waiting for a manual tournament save.
      persistTournament(applyMatchToTournament(tournament, updatedMatch));
      return;
    }

    // stage1/stage2: replace the match in place.
    const bracketKey = found.key;
    const current = bracketKey === 'stage1Bracket' ? tournament.stage1Bracket : tournament.stage2Bracket;
    if (!current) return;
    const newRounds = current.rounds.map(round =>
      round.map(m => m.id === targetMatchId ? updatedMatch : m)
    );
    const updatedTournament = { ...tournament, [bracketKey]: { ...current, rounds: newRounds } };
    setTournament(updatedTournament);
    persistTournament(updatedTournament);
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
    setTournament(t => ({
      ...t,
      stage1Config: config,
      // Group-stage match ids carry a `gs_<groupId>_…` prefix that the UI filters
      // on, so they must NOT be re-prefixed by scopeBracketIds. Other formats get
      // scoped for global uniqueness.
      stage1Bracket: stage1Bracket
        ? (config.format === 'groupstage' ? stage1Bracket : scopeBracketIds(stage1Bracket, t.id))
        : undefined,
    }));
    setShowTwoStageTournamentModal(false);
  };

  const handleSecondStageBracketGenerated = (bracket: BracketGenerated) => {
    setTournament(t => ({ ...t, stage2Bracket: scopeBracketIds(bracket, t.id) }));
    setShowBracketModal(false);
    setIsGeneratingSecondStage(false);
  };

  // Derive the teams that qualify from a non-groupstage Stage 1 (round robin /
  // single / double) by ranking, then open the Stage 2 bracket modal for them.
  const deriveStage1Qualifiers = (): TeamInTournament[] => {
    const b = tournament.stage1Bracket;
    const n = tournament.stage1Config?.qualifiersCount ?? 0;
    if (!b || n <= 0) return [];
    const teamById = (id: string) => tournament.teams.find(t => t.id === id);

    if (b.bracketType === 'roundrobin') {
      const standings = computeRRStandings(b.rounds, b.rrTeams ?? []);
      return standings.slice(0, n)
        .map(r => teamById(r.teamId))
        .filter((t): t is TeamInTournament => !!t);
    }
    // Single / double elim: take winners from the latest rounds down.
    const decided = b.rounds.flat().filter(m => m.winner);
    decided.sort((a, c) => c.round - a.round);
    const seen = new Set<string>();
    const out: TeamInTournament[] = [];
    for (const m of decided) {
      for (const id of [m.winner!, m.winner === m.team1Id ? m.team2Id : m.team1Id]) {
        if (out.length >= n || seen.has(id)) continue;
        const t = teamById(id);
        if (t) { seen.add(id); out.push(t); }
      }
    }
    return out;
  };

  const handleAdvanceToStage2 = () => {
    const qualified = deriveStage1Qualifiers();
    setTournament(t => ({ ...t, qualifiedTeams: qualified }));
    setIsGeneratingSecondStage(true);
    setShowBracketModal(true);
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
                          {(t.players ?? []).length} players
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
                          {bracketLocked && matchHasStats(match) ? (
                            <span className="ml-3 px-3 py-1 text-xs bg-[#0d0f16] border border-[#2a2d3a] text-gray-600 rounded flex items-center gap-1" title="Stats already pulled — locked">
                              <Lock className="w-3 h-3" /> Locked
                            </span>
                          ) : (
                            <button
                              onClick={() => { setEditingMatch(match); setEditingMatchSiblings(roundIdx === 0 ? round.filter(m => m.id !== match.id) : []); }}
                              className="ml-3 px-3 py-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] rounded transition-colors"
                            >
                              Edit
                            </button>
                          )}
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
              {/* Group details + editable matches if groupstage */}
              {tournament.stage1Config.format === 'groupstage' && tournament.stage1Config.groups && (
                <div className="space-y-3 mb-4">
                  {tournament.stage1Config.groups.map(group => {
                    const groupMatches = (tournament.stage1Bracket?.rounds.flat() ?? [])
                      .filter(m => m.id.includes(`gs_${group.id}_`));
                    return (
                      <div key={group.id} className="bg-[#0d0f16] rounded-lg p-3 border border-[#2a2d3a]">
                        <h4 className="text-white font-semibold text-xs mb-2">{group.name}</h4>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {group.teams.map(t => (
                            <span key={t.id} className="px-2 py-0.5 bg-[#1e2130] text-gray-300 text-xs rounded">{t.name}</span>
                          ))}
                        </div>

                        {/* Editable matches for this group */}
                        {groupMatches.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-gray-500 text-[11px] uppercase tracking-wider">Matches</p>
                            {groupMatches.map(match => (
                              <div
                                key={match.id}
                                className="flex items-center justify-between bg-[#151821] rounded-lg p-2.5 border border-[#2a2d3a] hover:border-[#ff4655]/30 transition-colors"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-white text-sm font-semibold truncate">
                                    {match.team1Name} vs {match.team2Name}
                                  </p>
                                  {(match.date || match.time) && (
                                    <p className="text-gray-500 text-xs mt-0.5">
                                      {match.date}{match.date && match.time && ' • '}{match.time}
                                    </p>
                                  )}
                                </div>
                                <button
                                  onClick={() => setEditingMatch(match)}
                                  className="ml-3 px-3 py-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] rounded transition-colors flex-shrink-0"
                                >
                                  Edit
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Editable matches for round-robin / single / double Stage 1 */}
              {tournament.stage1Config.format !== 'groupstage' && tournament.stage1Bracket && (
                <div className="space-y-4 mb-4">
                  {tournament.stage1Bracket.rounds.map((round, roundIdx) => (
                    <div key={roundIdx}>
                      <p className="text-gray-400 text-xs font-semibold mb-2">Round {roundIdx + 1}</p>
                      <div className="space-y-2">
                        {round.map(match => (
                          <div
                            key={match.id}
                            className="flex items-center justify-between bg-[#0d0f16] rounded-lg p-3 border border-[#2a2d3a] hover:border-[#ff4655]/30 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-sm font-semibold truncate">
                                {match.team1Name} vs {match.team2Name}
                              </p>
                              {(match.date || match.time) && (
                                <p className="text-gray-500 text-xs mt-0.5">
                                  {match.date}{match.date && match.time && ' • '}{match.time}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => { setEditingMatch(match); setEditingMatchSiblings(roundIdx === 0 ? round.filter(m => m.id !== match.id) : []); }}
                              className="ml-3 px-3 py-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] rounded transition-colors flex-shrink-0"
                            >
                              Edit
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Advance to Stage 2 (non-groupstage). Shows once Stage 1 is fully
                  scored and Stage 2 hasn't been generated yet. */}
              {tournament.stage1Config.format !== 'groupstage' && tournament.stage1Bracket && !tournament.stage2Bracket && (() => {
                const allDecided = tournament.stage1Bracket.rounds.flat().every(m => {
                  if (m.winner) return true;
                  const maps = m.maps ?? [];
                  if (maps.length === 0) return false;
                  const maxMaps = m.format === 'bo1' ? 1 : m.format === 'bo5' ? 5 : 3;
                  let w1 = 0, w2 = 0;
                  for (const mp of maps) { if (mp.team1Score > mp.team2Score) w1++; else if (mp.team2Score > mp.team1Score) w2++; }
                  return w1 >= Math.ceil(maxMaps / 2) || w2 >= Math.ceil(maxMaps / 2) || (maps.length >= maxMaps && w1 !== w2);
                });
                return (
                  <div className={`border rounded-xl p-4 mb-4 ${allDecided ? 'bg-green-900/20 border-green-700/40' : 'bg-blue-900/20 border-blue-700/40'}`}>
                    <p className={`text-sm mb-3 ${allDecided ? 'text-green-300' : 'text-blue-300'}`}>
                      {allDecided
                        ? `Stage 1 complete! Top ${tournament.stage1Config.qualifiersCount} teams advance to Stage 2.`
                        : `Top ${tournament.stage1Config.qualifiersCount} teams advance. Score all Stage 1 matches to continue.`}
                    </p>
                    <button
                      onClick={handleAdvanceToStage2}
                      disabled={!allDecided}
                      className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      Advance to Stage 2 <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                );
              })()}

              {/* Qualified teams banner (after advancing) */}
              {tournament.qualifiedTeams && tournament.qualifiedTeams.length > 0 && tournament.stage2Bracket && (
                <div className="bg-green-900/20 border border-green-700/40 rounded-xl p-4 mb-4">
                  <p className="text-green-300 font-semibold text-sm mb-2">Qualified for Stage 2</p>
                  <div className="flex flex-wrap gap-2">
                    {tournament.qualifiedTeams.map((qt, i) => (
                      <span key={qt.id} className="px-3 py-1 bg-green-900/40 border border-green-700/50 text-green-200 text-xs rounded-lg font-semibold">
                        #{i + 1} {qt.name}
                      </span>
                    ))}
                  </div>
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

          {/* Stage 2 (knockout) — show generated matches with Edit buttons */}
          {tournament.stage1Config && tournament.stage2Bracket && (
            <div className="bg-[#151821] border border-purple-700/50 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Stage 2 · Knockout</h3>
                <div className="px-2.5 py-1 rounded-lg bg-purple-900/30 border border-purple-700/50">
                  <p className="text-xs text-purple-400 font-semibold">
                    {tournament.stage2Bracket.rounds.reduce((s, r) => s + r.length, 0)} matches
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {tournament.stage2Bracket.rounds.map((round, roundIdx) => (
                  <div key={roundIdx}>
                    <p className="text-gray-400 text-xs font-semibold mb-2">Round {roundIdx + 1}</p>
                    <div className="space-y-2">
                      {round.map(match => (
                        <div
                          key={match.id}
                          className="flex items-center justify-between bg-[#0d0f16] rounded-lg p-3 border border-[#2a2d3a] hover:border-purple-500/40 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold truncate">
                              {match.team1Name} vs {match.team2Name}
                            </p>
                            {(match.date || match.time) && (
                              <p className="text-gray-500 text-xs mt-0.5">
                                {match.date}{match.date && match.time && ' • '}{match.time}
                              </p>
                            )}
                          </div>
                          {bracketLocked && matchHasStats(match) ? (
                            <span className="ml-3 px-3 py-1 text-xs bg-[#0d0f16] border border-[#2a2d3a] text-gray-600 rounded flex items-center gap-1 flex-shrink-0" title="Stats already pulled — locked">
                              <Lock className="w-3 h-3" /> Locked
                            </span>
                          ) : (
                            <button
                              onClick={() => { setEditingMatch(match); setEditingMatchSiblings(roundIdx === 0 ? round.filter(m => m.id !== match.id) : []); }}
                              className="ml-3 px-3 py-1 text-xs bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded transition-colors flex-shrink-0"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {!isEditing && (
                <button
                  onClick={() => setTournament(t => ({ ...t, stage2Bracket: undefined }))}
                  className="w-full mt-4 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-semibold transition-all"
                >
                  Reset Stage 2 Bracket
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
                            onClick={() => { setEditingMatch(match); setEditingMatchSiblings(roundIdx === 0 ? round.filter(m => m.id !== match.id) : []); }}
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
              (() => {
                const slotsLeft = tournament.event ? tournament.event.maxTeams - tournament.teams.length : Infinity;
                const isFull = slotsLeft <= 0;
                return isFull ? (
                  <div className="flex-1 min-w-[120px] py-2.5 rounded-lg bg-[#2a2d3a] text-gray-500 text-sm font-semibold flex items-center justify-center gap-2 cursor-not-allowed">
                    <Plus className="w-4 h-4" /> Slots Full
                  </div>
                ) : (
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
                );
              })()
            )}
            {!tournament.generatedBracket && !tournament.bracket && !tournament.groupStage && !tournament.stage1Config && (
              (() => {
                const slotsLeft = tournament.event ? tournament.event.maxTeams - tournament.teams.length : Infinity;
                const isFull = slotsLeft <= 0;
                return isFull ? null : (
                  <button
                    onClick={() => setShowExcelImportModal(true)}
                    className="flex-1 min-w-[140px] py-2.5 rounded-lg bg-orange-600 text-white text-sm font-semibold hover:bg-orange-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Upload className="w-4 h-4" /> Import from Excel
                  </button>
                );
              })()
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
          qualifiedTeamsCount={
            isGeneratingSecondStage
              ? (tournament.qualifiedTeams?.length
                  ?? tournament.stage1Config?.qualifiersCount
                  ?? (tournament.groupStage ? tournament.groupStage.groups.length * tournament.groupStage.teamsQualifyingPerGroup : undefined))
              : undefined
          }
          teams={isGeneratingSecondStage && tournament.qualifiedTeams?.length ? tournament.qualifiedTeams : tournament.teams}
        />
      )}

      {/* Match Edit Modal */}
      {editingMatch && (
        <MatchEditModal
          match={editingMatch}
          teams={tournament.teams}
          siblingMatches={editingMatchSiblings}
          onSave={handleMatchEdit}
          onCancel={() => { setEditingMatch(null); setEditingMatchSiblings([]); }}
        />
      )}

      {/* Excel Import Modal */}
      {showExcelImportModal && (
        <ExcelImportModal
          onImport={handleExcelImport}
          onCancel={() => setShowExcelImportModal(false)}
          existingTeamNames={tournament.teams.map(t => t.name)}
          remainingSlots={tournament.event ? tournament.event.maxTeams - tournament.teams.length : undefined}
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
  onSave: (name: string, overview: string, tournamentType: 'single' | 'group', event: TournamentEvent, coverImage?: string) => void;
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
  const [prizeTotal, setPrizeTotal] = useState(initialTournament?.event?.prizePool?.total || '');
  // One prize input per winning placement. Admin first picks how many teams win,
  // then fills the prize for each. Initialized from any existing prize pool.
  const [prizePlaces, setPrizePlaces] = useState<string[]>(
    initialTournament?.event?.prizePool?.places
      ?.slice()
      .sort((a, b) => a.position - b.position)
      .map(p => p.prize) || []
  );
  const [coverImage, setCoverImage] = useState(initialTournament?.coverImage || '');
  const [coverUploading, setCoverUploading] = useState(false);

  // Upload the cover to Storage and keep only the public URL (covers were the
  // biggest source of blob bloat as inline base64).
  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const localPreview = URL.createObjectURL(file);
    setCoverImage(localPreview);
    setCoverUploading(true);
    try {
      const url = await uploadImage(file, 'tournament-covers');
      setCoverImage(url);
    } catch (err) {
      console.error('Cover upload failed', err);
      alert('Cover image upload failed. Please try again.');
      setCoverImage(initialTournament?.coverImage || '');
    } finally {
      setCoverUploading(false);
    }
  };

  const handlePrizeCountChange = (count: number) => {
    setPrizePlaces(prev => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push('');
      return next;
    });
  };

  const handlePrizeChange = (index: number, value: string) => {
    setPrizePlaces(prev => prev.map((p, i) => (i === index ? value : p)));
  };

  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };

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

        {/* Cover Image */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">
            Cover Image
          </label>
          <p className="text-xs text-gray-600 mb-3">Display image on hero section and tournament page. Recommended: 1200x600px</p>
          <div className="flex gap-3">
            {coverImage && (
              <div className="w-32 h-20 rounded border border-[#2a2d3a] overflow-hidden flex-shrink-0">
                <img src={coverImage} alt="Cover" className="w-full h-full object-cover" />
              </div>
            )}
            <label className="flex-1 flex items-center justify-center border-2 border-dashed border-[#2a2d3a] rounded-lg p-4 cursor-pointer hover:border-[#ff4655]/50 transition-colors">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={coverUploading}
                onChange={handleCoverUpload}
              />
              <div className="text-center">
                {coverUploading ? (
                  <>
                    <Loader className="w-5 h-5 text-[#ff4655] mx-auto mb-2 animate-spin" />
                    <span className="text-xs text-gray-400">Uploading…</span>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-5 h-5 text-gray-400 mx-auto mb-2" />
                    <span className="text-xs text-gray-400">Click to upload image</span>
                  </>
                )}
              </div>
            </label>
            {coverImage && (
              <button
                onClick={() => setCoverImage('')}
                className="px-3 py-1 bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] text-xs rounded h-fit transition-colors"
              >
                Remove
              </button>
            )}
          </div>
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

          {/* Prize Pool */}
          <div className="border-t border-[#2a2d3a] pt-5 mt-5">
            <h3 className="text-white font-semibold text-sm mb-4">Prize Pool</h3>

            {/* Total Prize Pool (optional) */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                Total Prize Pool <span className="text-gray-600">(Optional)</span>
              </label>
              <input
                type="text"
                className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                placeholder="e.g. $50,000"
                value={prizeTotal}
                onChange={e => setPrizeTotal(e.target.value)}
              />
            </div>

            {/* Number of winning teams */}
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                Number of Teams Receiving a Prize
              </label>
              <input
                type="number"
                min="0"
                max="64"
                className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                placeholder="e.g. 3"
                value={prizePlaces.length === 0 ? '' : prizePlaces.length.toString()}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  handlePrizeCountChange(Number.isNaN(n) || n < 0 ? 0 : Math.min(n, 64));
                }}
              />
              <p className="text-[11px] text-gray-600 mt-1">
                Pick how many placements win, then enter each prize below. You can change these any time.
              </p>
            </div>

            {/* Prize per placement */}
            {prizePlaces.length > 0 && (
              <div className="space-y-3">
                {prizePlaces.map((prize, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-semibold w-16 flex-shrink-0">
                      {ordinal(i + 1)} Place
                    </span>
                    <input
                      type="text"
                      className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                      placeholder={`e.g. $${(prizePlaces.length - i) * 10},000`}
                      value={prize}
                      onChange={e => handlePrizeChange(i, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
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
          onClick={() => {
            const places: PrizePoolEntry[] = prizePlaces
              .map((prize, i) => ({ position: i + 1, prize: prize.trim() }))
              .filter(p => p.prize !== '');
            const hasPrizePool = places.length > 0 || prizeTotal.trim() !== '';
            onSave(name, overview, tournamentType, {
              type: eventType,
              location: location || undefined,
              startDate,
              maxTeams: parseInt(maxTeams, 10),
              prizePool: hasPrizePool
                ? { total: prizeTotal.trim() || undefined, places }
                : undefined,
            }, coverImage || undefined);
          }}
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
