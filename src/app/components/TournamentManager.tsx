import { useState } from 'react';
import {
  Plus,
  X,
  Edit3,
  Trash2,
  Trophy,
  Users,
  Calendar,
  MapPin,
  ChevronRight,
  Swords,
} from 'lucide-react';
import type { Tournament, TournamentEvent, TeamInTournament, Stage1Config, BracketGenerated } from './TournamentCreation';
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
        <label className="block text-xs text-gray-400 mb-1.5 font-medium">Max Teams Slots</label>
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

      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all">
          Cancel
        </button>
        <button onClick={() => onSave(form)} className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all">
          Save Event Details
        </button>
      </div>
    </div>
  );
}

// ── Group Stage Display ───────────────────────────────────────────────────────
function GroupStageDisplay({
  config,
  groupMatches,
  editable,
  onMatchesChange,
  onAdvanceToStage2,
  stage1Done,
}: {
  config: Stage1Config;
  groupMatches?: BracketGenerated;
  editable: boolean;
  onMatchesChange: (bracket: BracketGenerated) => void;
  onAdvanceToStage2: () => void;
  stage1Done: boolean;
}) {
  const allGroupMatches = groupMatches?.rounds.flat() ?? [];
  const allDone = allGroupMatches.length > 0 && allGroupMatches.every(m => !!m.winner);

  const setWinner = (matchId: string, winnerId: string, winnerName: string) => {
    if (!groupMatches || !editable) return;
    const updatedRounds = groupMatches.rounds.map(round =>
      round.map(m => m.id === matchId ? { ...m, winner: winnerId } : m)
    );
    // Recompute W/L in each group's teams based on updated matches
    const updated: BracketGenerated = { ...groupMatches, rounds: updatedRounds };
    onMatchesChange(updated);
  };

  return (
    <div className="space-y-4">
      {config.groups!.map(group => {
        const wl = computeGroupWL(group.id, group.teams, groupMatches);
        const groupMatchList = allGroupMatches.filter(m => m.id.startsWith(`gs_${group.id}_`));
        const standingsSorted = [...group.teams].sort((a, b) => {
          const netA = (wl[a.id]?.wins ?? 0) - (wl[a.id]?.losses ?? 0);
          const netB = (wl[b.id]?.wins ?? 0) - (wl[b.id]?.losses ?? 0);
          return netB - netA;
        });

        return (
          <div key={group.id} className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-4 space-y-4">
            <h4 className="text-white font-semibold text-sm flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-[#ff4655]" />
              {group.name}
            </h4>

            {/* Standings */}
            <div>
              <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider">Standings</p>
              <div className="space-y-1">
                {standingsSorted.map((gt, rank) => (
                  <div key={gt.id} className="flex items-center justify-between bg-[#0d0f16] rounded px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-4 text-center ${rank < (config.teamsQualifyingPerGroup ?? 1) ? 'text-green-400' : 'text-gray-600'}`}>
                        {rank + 1}
                      </span>
                      <span className="text-gray-300">{gt.name}</span>
                      {rank < (config.teamsQualifyingPerGroup ?? 1) && (
                        <span className="text-xs text-green-500 font-semibold">Q</span>
                      )}
                    </div>
                    <span className="text-gray-500 text-xs font-mono">
                      {wl[gt.id]?.wins ?? 0}W – {wl[gt.id]?.losses ?? 0}L
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Matches */}
            {groupMatchList.length > 0 && (
              <div>
                <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider">Matches</p>
                <div className="space-y-2">
                  {groupMatchList.map(match => (
                    <div key={match.id} className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <button
                          disabled={!editable || !!match.winner}
                          onClick={() => setWinner(match.id, match.team1Id, match.team1Name)}
                          className={`flex-1 py-2 px-3 rounded text-sm font-semibold transition-all text-left ${
                            match.winner === match.team1Id
                              ? 'bg-green-700/30 border border-green-600/50 text-green-300'
                              : match.winner
                              ? 'bg-[#151821] text-gray-600 line-through'
                              : editable
                              ? 'bg-[#151821] text-white hover:bg-[#1e2130] border border-transparent hover:border-[#ff4655]/30'
                              : 'bg-[#151821] text-gray-400'
                          }`}
                        >
                          {match.team1Name}
                          {match.winner === match.team1Id && <span className="ml-2 text-xs text-green-400">✓ W</span>}
                        </button>
                        <span className="text-gray-600 text-xs">vs</span>
                        <button
                          disabled={!editable || !!match.winner}
                          onClick={() => setWinner(match.id, match.team2Id, match.team2Name)}
                          className={`flex-1 py-2 px-3 rounded text-sm font-semibold transition-all text-left ${
                            match.winner === match.team2Id
                              ? 'bg-green-700/30 border border-green-600/50 text-green-300'
                              : match.winner
                              ? 'bg-[#151821] text-gray-600 line-through'
                              : editable
                              ? 'bg-[#151821] text-white hover:bg-[#1e2130] border border-transparent hover:border-[#ff4655]/30'
                              : 'bg-[#151821] text-gray-400'
                          }`}
                        >
                          {match.team2Name}
                          {match.winner === match.team2Id && <span className="ml-2 text-xs text-green-400">✓ W</span>}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Advance to Stage 2 */}
      {!stage1Done && (
        <div className={`border rounded-xl p-4 ${allDone ? 'bg-green-900/20 border-green-700/40' : 'bg-blue-900/20 border-blue-700/40'}`}>
          <p className={`text-sm mb-3 ${allDone ? 'text-green-300' : 'text-blue-300'}`}>
            {allDone
              ? `All group matches complete! Top ${config.teamsQualifyingPerGroup} per group qualify (${config.qualifiersCount} total).`
              : `Top ${config.teamsQualifyingPerGroup} per group qualify (${config.qualifiersCount} total). Complete all matches to advance.`}
          </p>
          <button
            onClick={onAdvanceToStage2}
            disabled={!allDone}
            className="w-full py-2.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2"
          >
            <Swords className="w-4 h-4" /> Advance to Stage 2
          </button>
        </div>
      )}
    </div>
  );
}

/** Compute W/L for each team in a group from the match results. */
function computeGroupWL(groupId: string, teams: { id: string }[], bracket?: BracketGenerated): Record<string, { wins: number; losses: number }> {
  const wl: Record<string, { wins: number; losses: number }> = {};
  for (const t of teams) wl[t.id] = { wins: 0, losses: 0 };
  if (!bracket) return wl;
  const groupMatches = bracket.rounds.flat().filter(m => m.id.startsWith(`gs_${groupId}_`));
  for (const m of groupMatches) {
    if (!m.winner) continue;
    const loserId = m.winner === m.team1Id ? m.team2Id : m.team1Id;
    if (wl[m.winner]) wl[m.winner].wins++;
    if (wl[loserId]) wl[loserId].losses++;
  }
  return wl;
}

/** Derive qualified teams from group stage config using actual match results. */
function deriveGroupStageQualifiers(config: Stage1Config, bracket?: BracketGenerated): TeamInTournament[] {
  if (!config.groups) return [];
  const perGroup = config.teamsQualifyingPerGroup ?? 1;
  const result: TeamInTournament[] = [];
  for (const group of config.groups) {
    const wl = computeGroupWL(group.id, group.teams, bracket);
    const sorted = [...group.teams].sort((a, b) => {
      const netA = (wl[a.id]?.wins ?? 0) - (wl[a.id]?.losses ?? 0);
      const netB = (wl[b.id]?.wins ?? 0) - (wl[b.id]?.losses ?? 0);
      return netB - netA;
    });
    result.push(...sorted.slice(0, perGroup).map(t => ({ id: t.id, name: t.name, players: [] })));
  }
  return result;
}

export function TournamentManager({
  tournaments,
  onTournamentsChange,
}: TournamentManagerProps) {
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [editingTournamentId, setEditingTournamentId] = useState<string | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [editingEventDetails, setEditingEventDetails] = useState<string | null>(null);
  const [showStage2BracketModal, setShowStage2BracketModal] = useState(false);
  const [pendingQualifiedTeams, setPendingQualifiedTeams] = useState<TeamInTournament[]>([]);

  const selectedTournament = tournaments.find((t) => t.id === selectedTournamentId);
  const editingTournament = tournaments.find((t) => t.id === editingTournamentId);

  const updateTournament = (updated: Tournament) => {
    onTournamentsChange(tournaments.map(t => t.id === updated.id ? updated : t));
  };

  const handleSaveTournament = (tournament: Tournament) => {
    if (editingTournamentId) {
      onTournamentsChange(tournaments.map((t) => (t.id === editingTournamentId ? tournament : t)));
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

  if (showCreateTournament || editingTournamentId) {
    return (
      <CreateTournamentScreen
        initialTournament={editingTournament}
        isEditing={!!editingTournamentId}
        onComplete={(tournament) => handleSaveTournament(tournament)}
      />
    );
  }

  if (selectedTournament) {
    const t = selectedTournament;
    const isTwoStage = !!t.stage1Config;
    const stage1Done = !!t.qualifiedTeams;

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
            <h2 className="text-white font-bold text-lg">{t.name}</h2>
            <p className="text-gray-500 text-sm">{t.overview}</p>
          </div>
          <button
            onClick={() => setEditingTournamentId(t.id)}
            className="p-2 hover:bg-[#1e2130] rounded-lg transition-colors text-gray-500 hover:text-white"
          >
            <Edit3 className="w-4 h-4" />
          </button>
        </div>

        {/* Event Details */}
        {t.event ? (
          <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#ff4655]" />
                Event Details
              </h3>
              <button
                onClick={() => setEditingEventDetails(t.id)}
                className="px-3 py-1 text-xs bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] rounded transition-colors"
              >
                Edit
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-gray-500 text-xs mb-1">Type</p>
                <p className="text-white text-sm font-semibold capitalize">{t.event.type}</p>
              </div>
              {t.event.location && (
                <div>
                  <p className="text-gray-500 text-xs mb-1">Location</p>
                  <p className="text-white text-sm font-semibold flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {t.event.location}
                  </p>
                </div>
              )}
              <div>
                <p className="text-gray-500 text-xs mb-1">Start Date</p>
                <p className="text-white text-sm font-semibold">{new Date(t.event.startDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-gray-500 text-xs mb-1">Max Teams</p>
                <p className="text-white text-sm font-semibold">
                  {t.event.registeredTeams?.length || 0} / {t.event.maxTeams}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#151821] border border-dashed border-[#2a2d3a] rounded-xl p-6">
            <p className="text-gray-500 text-sm text-center mb-4">No event details set</p>
            <button
              onClick={() => setEditingEventDetails(t.id)}
              className="w-full py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all"
            >
              Add Event Details
            </button>
          </div>
        )}

        {/* ── Two-Stage Tournament ──────────────────────────────────────── */}
        {isTwoStage && (
          <>
            {/* Stage 1 header */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-[#2a2d3a]" />
              <span className="text-xs font-bold text-purple-400 uppercase tracking-widest px-2">
                Stage 1 · {t.stage1Config!.format === 'groupstage' ? 'Group Stage' : t.stage1Config!.format === 'roundrobin' ? 'Round Robin' : t.stage1Config!.format === 'double' ? 'Double Elimination' : 'Single Elimination'}
              </span>
              <div className="h-px flex-1 bg-[#2a2d3a]" />
            </div>

            {/* Group Stage layout with auto-generated matches */}
            {t.stage1Config!.format === 'groupstage' && t.stage1Config!.groups && (
              <GroupStageDisplay
                config={t.stage1Config!}
                groupMatches={t.stage1Bracket}
                editable={!stage1Done}
                onMatchesChange={(updatedBracket) => updateTournament({ ...t, stage1Bracket: updatedBracket })}
                onAdvanceToStage2={() => {
                  const qualifiedFromGroups = deriveGroupStageQualifiers(t.stage1Config!, t.stage1Bracket);
                  updateTournament({ ...t, qualifiedTeams: qualifiedFromGroups });
                  setPendingQualifiedTeams(qualifiedFromGroups);
                  setShowStage2BracketModal(true);
                }}
                stage1Done={stage1Done}
              />
            )}

            {/* Bracket-based Stage 1 (single / double / roundrobin) */}
            {t.stage1Bracket && t.stage1Config!.format !== 'groupstage' && (
              <BracketDisplay
                bracket={t.stage1Bracket}
                teams={t.teams}
                onBracketChange={(bracket) => updateTournament({ ...t, stage1Bracket: bracket })}
                editable={!stage1Done}
                accentColor="red"
                qualifiersCount={t.stage1Config!.qualifiersCount}
                alreadyQualified={stage1Done}
                onQualify={(qualified) => {
                  updateTournament({ ...t, qualifiedTeams: qualified });
                  setPendingQualifiedTeams(qualified);
                  setShowStage2BracketModal(true);
                }}
              />
            )}

            {/* Qualified teams banner */}
            {stage1Done && (
              <div className="bg-green-900/20 border border-green-700/40 rounded-xl p-4">
                <p className="text-green-300 font-semibold text-sm mb-2">Stage 1 Complete — Qualified Teams</p>
                <div className="flex flex-wrap gap-2">
                  {t.qualifiedTeams!.map((qt, i) => (
                    <span key={qt.id} className="px-3 py-1 bg-green-900/40 border border-green-700/50 text-green-200 text-xs rounded-lg font-semibold">
                      #{i + 1} {qt.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Stage 2 */}
            {stage1Done && (
              <>
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-[#2a2d3a]" />
                  <span className="text-xs font-bold text-yellow-400 uppercase tracking-widest px-2">
                    Stage 2 · {t.stage2Format === 'double' ? 'Double Elimination' : 'Single Elimination'}
                  </span>
                  <div className="h-px flex-1 bg-[#2a2d3a]" />
                </div>

                {t.stage2Bracket ? (
                  <BracketDisplay
                    bracket={t.stage2Bracket}
                    teams={t.qualifiedTeams!}
                    onBracketChange={(bracket) => updateTournament({ ...t, stage2Bracket: bracket })}
                    editable={true}
                    accentColor="purple"
                  />
                ) : (
                  <div className="bg-[#1e2130] border border-yellow-700/30 rounded-xl p-6 text-center">
                    <p className="text-gray-400 text-sm mb-4">
                      {t.qualifiedTeams!.length} teams are ready for Stage 2.
                    </p>
                    <button
                      onClick={() => {
                        setPendingQualifiedTeams(t.qualifiedTeams!);
                        setShowStage2BracketModal(true);
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-semibold transition-all"
                    >
                      <Swords className="w-4 h-4" /> Configure Stage 2 Bracket
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Single-Stage Tournament ────────────────────────────────────── */}
        {!isTwoStage && (
          <>
            {/* Legacy group stage */}
            {t.groupStage && (
              <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#ff4655]" />
                    Group Stage
                  </h3>
                </div>
                <div className="space-y-4">
                  {t.groupStage.groups.map((group) => (
                    <div key={group.id} className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4">
                      <h4 className="text-white font-semibold text-sm mb-3">{group.name}</h4>
                      <div className="space-y-2">
                        {group.teams.map((team) => (
                          <div key={team.id} className="flex items-center justify-between text-sm">
                            <span className="text-gray-300">{team.name}</span>
                            <div className="text-gray-500 text-xs">{team.wins ?? 0}W - {team.losses ?? 0}L</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {t.knockoutBracket && (
              <div className="space-y-4">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-[#ff4655]" />
                  Knockout Stage (2nd Stage)
                </h3>
                <BracketDisplay
                  bracket={t.knockoutBracket}
                  teams={t.teams}
                  onBracketChange={(bracket) => updateTournament({ ...t, knockoutBracket: bracket })}
                  editable={true}
                  accentColor="purple"
                />
              </div>
            )}

            {t.generatedBracket ? (
              <BracketDisplay
                bracket={t.generatedBracket}
                teams={t.teams}
                onBracketChange={(bracket) => updateTournament({ ...t, generatedBracket: bracket })}
                editable={true}
              />
            ) : !t.groupStage ? (
              <div className="bg-[#151821] border border-dashed border-[#2a2d3a] rounded-xl p-6">
                <p className="text-gray-500 text-sm text-center">
                  No bracket configured. Set up the bracket during tournament creation.
                </p>
              </div>
            ) : null}
          </>
        )}

        {/* Event Details Form Modal */}
        {editingEventDetails && editingEventDetails === t.id && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
              <EventDetailsForm
                event={t.event || null}
                onSave={(event) => {
                  updateTournament({ ...t, event, status: 'registration' });
                  setEditingEventDetails(null);
                }}
                onCancel={() => setEditingEventDetails(null)}
              />
            </div>
          </div>
        )}

        {/* Stage 2 Bracket Generator Modal */}
        {showStage2BracketModal && pendingQualifiedTeams.length > 0 && (
          <BracketConfigurationModal
            onClose={() => setShowStage2BracketModal(false)}
            onGenerate={(bracket) => {
              updateTournament({ ...t, stage2Bracket: bracket, stage2Format: bracket.bracketType === 'double' ? 'double' : 'single' });
              setShowStage2BracketModal(false);
            }}
            isSecondStage={true}
            teams={pendingQualifiedTeams}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                <p className="text-gray-500 text-xs mt-1 line-clamp-2">{tournament.overview}</p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4 py-3 border-y border-[#2a2d3a]">
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Teams</p>
                  <p className="text-white font-bold">{tournament.teams.length}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Status</p>
                  <p className="text-[#ff4655] font-bold capitalize text-xs">{tournament.status}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs mb-0.5">Format</p>
                  <p className="text-white font-bold text-xs">
                    {tournament.stage1Config
                      ? `2-Stage`
                      : tournament.generatedBracket
                      ? tournament.generatedBracket.bracketType ?? 'bracket'
                      : '—'}
                  </p>
                </div>
              </div>

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
