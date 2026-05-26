import { useState } from 'react';
import { X, Plus, Trash2, ChevronRight } from 'lucide-react';
import type { GroupStage, Group, GroupStageTeam } from './TournamentCreation';
import type { TeamInTournament } from './TournamentCreation';

interface TwoStageTournamentModalProps {
  teams: TeamInTournament[];
  onClose: () => void;
  onComplete: (groupStage: GroupStage) => void;
}

export function TwoStageTournamentModal({
  teams,
  onClose,
  onComplete,
}: TwoStageTournamentModalProps) {
  const [step, setStep] = useState<'setup' | 'groups' | 'qualify'>('setup');
  const [groupCount, setGroupCount] = useState<number>(2);
  const [teamsQualifyingPerGroup, setTeamsQualifyingPerGroup] = useState<number>(1);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  const [groupName, setGroupName] = useState<string>('');

  const handleCreateGroups = () => {
    const newGroups: Group[] = Array.from({ length: groupCount }, (_, i) => ({
      id: `group_${i}`,
      name: `Group ${String.fromCharCode(65 + i)}`, // A, B, C, etc.
      teams: [],
    }));
    setGroups(newGroups);
    setSelectedGroupId(newGroups[0].id);
    setStep('groups');
  };

  const handleAddTeamToGroup = (teamId: string) => {
    if (!selectedGroupId) return;

    setGroups(groups =>
      groups.map(g => {
        if (g.id === selectedGroupId) {
          const team = teams.find(t => t.id === teamId);
          if (team && !g.teams.find(gt => gt.id === teamId)) {
            return {
              ...g,
              teams: [...g.teams, { id: teamId, name: team.name }],
            };
          }
        }
        return g;
      })
    );
  };

  const handleRemoveTeamFromGroup = (teamId: string) => {
    setGroups(groups =>
      groups.map(g => {
        if (g.id === selectedGroupId) {
          return {
            ...g,
            teams: g.teams.filter(t => t.id !== teamId),
          };
        }
        return g;
      })
    );
  };

  const handleUpdateGroupName = (groupId: string, newName: string) => {
    setGroups(groups =>
      groups.map(g => (g.id === groupId ? { ...g, name: newName } : g))
    );
  };

  const getUnassignedTeams = () => {
    const assignedTeamIds = new Set(
      groups.flatMap(g => g.teams.map(t => t.id))
    );
    return teams.filter(t => !assignedTeamIds.has(t.id));
  };

  const currentGroup = groups.find(g => g.id === selectedGroupId);
  const unassignedTeams = getUnassignedTeams();
  const maxQualify = Math.min(
    ...groups.map(g => g.teams.length),
    3 // Max 3 teams per group
  );

  if (step === 'setup') {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-lg w-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
            <h2 className="text-white font-bold text-lg">Two-Stage Tournament Setup</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Group Count */}
            <div>
              <label className="block text-xs text-gray-400 mb-3 font-medium">
                Number of Groups
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[2, 3, 4, 6].map(count => (
                  <button
                    key={count}
                    onClick={() => setGroupCount(count)}
                    className={`py-2 rounded-lg border-2 transition-colors font-semibold text-sm ${
                      groupCount === count
                        ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]'
                        : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* Info */}
            <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4">
              <p className="text-gray-300 text-sm">
                You have <span className="text-[#ff4655] font-semibold">{teams.length}</span> teams.
                <br />
                Creating <span className="text-[#ff4655] font-semibold">{groupCount}</span> groups with{' '}
                <span className="text-[#ff4655] font-semibold">
                  {Math.ceil(teams.length / groupCount)}
                </span>{' '}
                teams each.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-[#2a2d3a]">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm font-semibold hover:border-gray-500 hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateGroups}
                className="flex-1 py-3 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2"
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'groups') {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] sticky top-0 bg-[#151821]">
            <h2 className="text-white font-bold text-lg">Create Groups & Assign Teams</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Groups List */}
              <div className="space-y-3">
                <h3 className="text-white font-semibold text-sm">Groups</h3>
                <div className="space-y-2">
                  {groups.map(group => (
                    <div
                      key={group.id}
                      onClick={() => setSelectedGroupId(group.id)}
                      className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        selectedGroupId === group.id
                          ? 'border-[#ff4655] bg-[#ff4655]/10'
                          : 'border-[#2a2d3a] bg-[#0d0f16] hover:border-[#ff4655]/30'
                      }`}
                    >
                      <p className="text-white font-semibold text-sm">{group.name}</p>
                      <p className="text-gray-500 text-xs">{group.teams.length} teams</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Group Details */}
              {currentGroup && (
                <div className="lg:col-span-2 space-y-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-2 font-medium">
                      Group Name
                    </label>
                    <input
                      type="text"
                      value={currentGroup.name}
                      onChange={e => handleUpdateGroupName(currentGroup.id, e.target.value)}
                      className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                    />
                  </div>

                  {/* Assigned Teams */}
                  <div>
                    <h4 className="text-white font-semibold text-sm mb-2">Teams in Group</h4>
                    <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                      {currentGroup.teams.length === 0 ? (
                        <p className="text-gray-500 text-xs">No teams assigned</p>
                      ) : (
                        currentGroup.teams.map(team => (
                          <div
                            key={team.id}
                            className="flex items-center justify-between bg-[#151821] p-2 rounded text-sm"
                          >
                            <span className="text-white">{team.name}</span>
                            <button
                              onClick={() => handleRemoveTeamFromGroup(team.id)}
                              className="text-gray-600 hover:text-[#ff4655] transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Available Teams */}
                  <div>
                    <h4 className="text-white font-semibold text-sm mb-2">Available Teams</h4>
                    <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                      {unassignedTeams.length === 0 ? (
                        <p className="text-gray-500 text-xs">All teams assigned</p>
                      ) : (
                        unassignedTeams.map(team => (
                          <button
                            key={team.id}
                            onClick={() => handleAddTeamToGroup(team.id)}
                            className="w-full flex items-center justify-between bg-[#151821] hover:bg-[#1e2130] p-2 rounded text-sm transition-colors"
                          >
                            <span className="text-white">{team.name}</span>
                            <Plus className="w-4 h-4 text-[#ff4655]" />
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-[#2a2d3a]">
              <button
                onClick={() => setStep('setup')}
                className="flex-1 py-3 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm font-semibold hover:border-gray-500 hover:text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={() => setStep('qualify')}
                className="flex-1 py-3 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2"
              >
                Next: Set Qualifiers <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Qualification step
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <h2 className="text-white font-bold text-lg">Set Qualification Rules</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Teams per group info */}
          <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4 space-y-3">
            <h4 className="text-white font-semibold text-sm">Group Details</h4>
            <div className="space-y-1 text-sm">
              {groups.map(group => (
                <div key={group.id} className="flex justify-between text-gray-400">
                  <span>{group.name}</span>
                  <span className="text-white font-semibold">{group.teams.length} teams</span>
                </div>
              ))}
            </div>
          </div>

          {/* Qualifying teams selection */}
          <div>
            <label className="block text-xs text-gray-400 mb-3 font-medium">
              Teams Qualifying Per Group for 2nd Stage
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Each group has {Math.min(...groups.map(g => g.teams.length))} teams. You can select up to{' '}
              <span className="text-[#ff4655]">{maxQualify}</span> teams per group.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: maxQualify }, (_, i) => i + 1).map(num => (
                <button
                  key={num}
                  onClick={() => setTeamsQualifyingPerGroup(num)}
                  className={`py-3 rounded-lg border-2 transition-colors font-semibold text-sm ${
                    teamsQualifyingPerGroup === num
                      ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]'
                      : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-4">
            <p className="text-green-300 text-sm">
              ✓ Total qualified teams for 2nd stage:{' '}
              <span className="font-semibold">{groupCount * teamsQualifyingPerGroup}</span>
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-[#2a2d3a]">
            <button
              onClick={() => setStep('groups')}
              className="flex-1 py-3 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm font-semibold hover:border-gray-500 hover:text-white transition-all"
            >
              Back
            </button>
            <button
              onClick={() =>
                onComplete({
                  groups,
                  teamsQualifyingPerGroup,
                })
              }
              className="flex-1 py-3 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-all flex items-center justify-center gap-2"
            >
              Create Group Stage <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
