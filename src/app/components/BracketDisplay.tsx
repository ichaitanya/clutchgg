import { useState } from 'react';
import { ChevronRight, Edit2, RotateCw, Trash2 } from 'lucide-react';
import type { BracketGenerated, BracketMatch, TeamInTournament } from './TournamentCreation';
import { swapTeamsInMatch, changeTeamOpponent, getBracketStats } from '../utils/bracketUtils';

interface BracketDisplayProps {
  bracket: BracketGenerated;
  teams: TeamInTournament[];
  onBracketChange: (bracket: BracketGenerated) => void;
  editable?: boolean;
}

function MatchCard({
  match,
  teams,
  onEdit,
  isEditing,
}: {
  match: BracketMatch;
  teams: TeamInTournament[];
  onEdit: (roundIdx: number, matchIdx: number, team1: string, team2: string) => void;
  isEditing: boolean;
}) {
  return (
    <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-3 min-w-[200px]">
      <div className="space-y-2">
        {/* Team 1 */}
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-white text-xs font-semibold truncate">{match.team1Name}</p>
          </div>
          {isEditing && (
            <button
              onClick={() =>
                onEdit(match.round, match.position, match.team1Name, match.team2Name)
              }
              className="ml-2 p-1 hover:bg-[#2a2d3a] rounded transition-colors"
            >
              <Edit2 className="w-3 h-3 text-gray-500" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-center py-1">
          <div className="text-xs text-gray-500 font-semibold">VS</div>
        </div>

        {/* Team 2 */}
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-white text-xs font-semibold truncate">{match.team2Name}</p>
          </div>
          {isEditing && (
            <button
              onClick={() =>
                onEdit(match.round, match.position, match.team1Name, match.team2Name)
              }
              className="ml-2 p-1 hover:bg-[#2a2d3a] rounded transition-colors"
            >
              <Edit2 className="w-3 h-3 text-gray-500" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MatchEditorModal({
  match,
  teams,
  onSave,
  onClose,
}: {
  match: { roundIdx: number; matchIdx: number; team1: string; team2: string } | null;
  teams: TeamInTournament[];
  onSave: (
    roundIdx: number,
    matchIdx: number,
    team1Id: string,
    team2Id: string,
    team1Name: string,
    team2Name: string
  ) => void;
  onClose: () => void;
}) {
  const [team1, setTeam1] = useState(match?.team1 || '');
  const [team2, setTeam2] = useState(match?.team2 || '');

  if (!match) return null;

  const selectedTeam1 = teams.find((t) => t.name === team1);
  const selectedTeam2 = teams.find((t) => t.name === team2);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-sm w-full">
        <div className="px-6 py-4 border-b border-[#2a2d3a]">
          <h3 className="text-white font-bold">
            Edit Match - Round {match.roundIdx + 1}, Match {match.matchIdx + 1}
          </h3>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-2 font-medium">
              Team 1 *
            </label>
            <select
              value={team1}
              onChange={(e) => setTeam1(e.target.value)}
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            >
              <option value="">Select team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-2 font-medium">
              Team 2 *
            </label>
            <select
              value={team2}
              onChange={(e) => setTeam2(e.target.value)}
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            >
              <option value="">Select team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (selectedTeam1 && selectedTeam2) {
                  onSave(
                    match.roundIdx,
                    match.matchIdx,
                    selectedTeam1.id,
                    selectedTeam2.id,
                    team1,
                    team2
                  );
                  onClose();
                }
              }}
              disabled={!selectedTeam1 || !selectedTeam2 || team1 === team2}
              className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BracketDisplay({
  bracket,
  teams,
  onBracketChange,
  editable = false,
}: BracketDisplayProps) {
  const [editingMatch, setEditingMatch] = useState<{
    roundIdx: number;
    matchIdx: number;
    team1: string;
    team2: string;
  } | null>(null);
  const stats = getBracketStats(bracket);

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-gray-500 text-xs mb-1">Total Rounds</p>
            <p className="text-white font-bold text-lg">{stats.totalRounds}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs mb-1">Progress</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-[#0d0f16] h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#ff4655] transition-all"
                  style={{ width: `${stats.progress}%` }}
                />
              </div>
              <span className="text-white font-bold text-xs">{stats.progress}%</span>
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs mb-1">Matches</p>
            <p className="text-white font-bold text-lg">
              {stats.completedMatches}/{stats.totalMatches}
            </p>
          </div>
        </div>
      </div>

      {/* Customization History */}
      {bracket.customizationHistory.length > 0 && (
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-4">
          <h3 className="text-white font-semibold text-sm mb-3">Customization History</h3>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {bracket.customizationHistory.map((entry, idx) => (
              <div key={idx} className="text-xs">
                <p className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</p>
                <p className="text-gray-300">{entry.changes}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bracket Rounds */}
      <div className="space-y-6">
        {bracket.rounds.map((round, roundIdx) => (
          <div key={roundIdx}>
            <h3 className="text-white font-bold text-sm mb-4 flex items-center gap-2">
              <div className="w-1 h-4 bg-[#ff4655] rounded" />
              Round {roundIdx + 1}
              <span className="text-gray-500 text-xs">
                ({round.length} match{round.length !== 1 ? 'es' : ''})
              </span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {round.map((match, matchIdx) => (
                <div
                  key={match.id}
                  className={`relative ${
                    editable ? 'cursor-pointer hover:border-[#ff4655]' : ''
                  }`}
                >
                  <MatchCard
                    match={match}
                    teams={teams}
                    onEdit={(roundIdx, matchIdx) => {
                      if (editable) {
                        setEditingMatch({
                          roundIdx,
                          matchIdx,
                          team1: match.team1Name,
                          team2: match.team2Name,
                        });
                      }
                    }}
                    isEditing={editable}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Match Editor Modal */}
      {editingMatch && (
        <MatchEditorModal
          match={editingMatch}
          teams={teams}
          onSave={(roundIdx, matchIdx, team1Id, team2Id, team1Name, team2Name) => {
            const newBracket = swapTeamsInMatch(
              bracket,
              roundIdx,
              matchIdx,
              team1Id,
              team2Id,
              team1Name,
              team2Name
            );
            onBracketChange(newBracket);
            setEditingMatch(null);
          }}
          onClose={() => setEditingMatch(null)}
        />
      )}
    </div>
  );
}
