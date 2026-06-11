import { useState } from 'react';
import { X, Plus, Trash2, ChevronRight, Swords, RotateCcw, Grid3x3 } from 'lucide-react';
import { DEFAULT_POINTS_PER_WIN } from './BracketDisplay';
import type { Group, TeamInTournament, Stage1Config, Stage1Format } from './TournamentCreation';

interface TwoStageTournamentModalProps {
  teams: TeamInTournament[];
  onClose: () => void;
  onComplete: (config: Stage1Config) => void;
}

// ── Step 1: Pick format + qualifiers count ────────────────────────────────────
function FormatStep({
  teams,
  onNext,
  onClose,
}: {
  teams: TeamInTournament[];
  onNext: (format: Stage1Format, qualifiersCount: number, pointsPerWin: number) => void;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Stage1Format>('single');
  const [qualifiersCount, setQualifiersCount] = useState<number>(4);
  // Points awarded per match win for round-robin / group-stage (default 3).
  const [pointsPerWin, setPointsPerWin] = useState(DEFAULT_POINTS_PER_WIN);

  const formats: { id: Stage1Format; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: 'single', label: 'Single Elimination', desc: 'One loss and you\'re out. Top finishers qualify.', icon: <Swords className="w-4 h-4" /> },
    { id: 'double', label: 'Double Elimination', desc: 'Two losses to be eliminated. LB winner can still qualify.', icon: <Swords className="w-4 h-4" /> },
    { id: 'roundrobin', label: 'Round Robin', desc: 'Everyone plays each other. Top N by W-L advance.', icon: <RotateCcw className="w-4 h-4" /> },
    { id: 'groupstage', label: 'Group Stage', desc: 'Teams split into groups; top teams per group advance.', icon: <Grid3x3 className="w-4 h-4" /> },
  ];

  // Qualifiers count options that are < teams.length. Round robin ranks every
  // team, so 6 is a valid cut; bracket formats prefer powers of 2 but 6 is still
  // offered (a Stage 2 of 6 seeds with two byes).
  const qualifierOptions = [2, 4, 6, 8, 16].filter(n => n < teams.length);
  if (qualifierOptions.length === 0) qualifierOptions.push(2);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] sticky top-0 bg-[#151821]">
          <h2 className="text-white font-bold text-lg">Stage 1 Configuration</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Team count info */}
          <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-4 py-3">
            <p className="text-gray-400 text-sm">
              <span className="text-white font-semibold">{teams.length}</span> teams participating in Stage 1
            </p>
          </div>

          {/* Format picker */}
          <div>
            <label className="block text-xs text-gray-400 mb-3 font-medium uppercase tracking-wider">Stage 1 Format</label>
            <div className="space-y-2">
              {formats.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left flex items-start gap-3 ${
                    format === f.id
                      ? 'border-[#ff4655] bg-[#ff4655]/10'
                      : 'border-[#2a2d3a] bg-[#0d0f16] hover:border-[#ff4655]/50'
                  }`}
                >
                  <span className={`mt-0.5 ${format === f.id ? 'text-[#ff4655]' : 'text-gray-500'}`}>{f.icon}</span>
                  <div>
                    <p className={`font-semibold text-sm ${format === f.id ? 'text-[#ff4655]' : 'text-white'}`}>{f.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{f.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Qualifiers count — not shown for groupstage (derived from groups config) */}
          {format !== 'groupstage' && (
            <div>
              <label className="block text-xs text-gray-400 mb-3 font-medium uppercase tracking-wider">
                Teams Advancing to Stage 2
              </label>
              <div className="grid grid-cols-4 gap-2">
                {qualifierOptions.map(n => (
                  <button
                    key={n}
                    onClick={() => setQualifiersCount(n)}
                    className={`py-3 rounded-lg border-2 transition-colors font-semibold text-sm ${
                      qualifiersCount === n
                        ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]'
                        : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-gray-600 text-xs mt-2">
                Top {qualifiersCount} teams by final ranking will advance to Stage 2.
              </p>
            </div>
          )}

          {/* Round-robin / group-stage scoring: points per match win. */}
          {(format === 'roundrobin' || format === 'groupstage') && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[#2a2d3a] bg-[#0d0f16]">
              <div>
                <p className="text-white text-sm font-semibold">Points per win</p>
                <p className="text-gray-500 text-xs mt-0.5">Standings rank by total points (wins × this value).</p>
              </div>
              <input
                type="number"
                min={1}
                max={10}
                value={pointsPerWin}
                onChange={e => setPointsPerWin(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                className="w-16 px-2 py-1.5 rounded-md bg-[#1e2130] border border-[#2a2d3a] text-white text-sm text-center focus:border-[#ff4655] focus:outline-none"
              />
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-[#2a2d3a]">
            <button onClick={onClose} className="flex-1 py-3 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm font-semibold hover:border-gray-500 hover:text-white transition-all">Cancel</button>
            <button
              onClick={() => onNext(format, qualifiersCount, pointsPerWin)}
              className="flex-1 py-3 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2"
            >
              {format === 'groupstage' ? 'Set Up Groups' : 'Confirm & Generate'} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 2 (group stage only): assign teams to groups ────────────────────────
function GroupsStep({
  teams,
  qualifiersCount: _q,
  onBack,
  onComplete,
  onClose,
}: {
  teams: TeamInTournament[];
  qualifiersCount: number;
  onBack: () => void;
  onComplete: (groups: Group[], teamsQualifyingPerGroup: number) => void;
  onClose: () => void;
}) {
  const [groupCount, setGroupCount] = useState(2);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [teamsQualifyingPerGroup, setTeamsQualifyingPerGroup] = useState(1);
  const [groupsCreated, setGroupsCreated] = useState(false);

  const handleCreateGroups = () => {
    const newGroups: Group[] = Array.from({ length: groupCount }, (_, i) => ({
      id: `group_${i}`,
      name: `Group ${String.fromCharCode(65 + i)}`,
      teams: [],
    }));
    setGroups(newGroups);
    setSelectedGroupId(newGroups[0].id);
    setGroupsCreated(true);
  };

  const getUnassigned = () => {
    const assigned = new Set(groups.flatMap(g => g.teams.map(t => t.id)));
    return teams.filter(t => !assigned.has(t.id));
  };

  const addTeam = (teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    setGroups(gs => gs.map(g =>
      g.id === selectedGroupId && !g.teams.find(t => t.id === teamId)
        ? { ...g, teams: [...g.teams, { id: teamId, name: team.name }] }
        : g
    ));
  };

  const removeTeam = (teamId: string) => {
    setGroups(gs => gs.map(g =>
      g.id === selectedGroupId ? { ...g, teams: g.teams.filter(t => t.id !== teamId) } : g
    ));
  };

  const currentGroup = groups.find(g => g.id === selectedGroupId);
  const minGroupSize = groups.length > 0 ? Math.min(...groups.map(g => g.teams.length)) : 0;
  const maxQualify = Math.max(1, minGroupSize > 0 ? minGroupSize - 1 : 1);
  const totalQualifiers = groupCount * teamsQualifyingPerGroup;

  if (!groupsCreated) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-lg w-full">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
            <h2 className="text-white font-bold text-lg">Group Stage Setup</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-6 space-y-6">
            <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4">
              <p className="text-gray-300 text-sm">
                <span className="text-white font-semibold">{teams.length}</span> teams ·{' '}
                <span className="text-white font-semibold">{groupCount}</span> groups ·{' '}
                ~<span className="text-white font-semibold">{Math.ceil(teams.length / groupCount)}</span> per group
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-3 font-medium">Number of Groups</label>
              <div className="grid grid-cols-4 gap-2">
                {[2, 3, 4, 6].map(n => (
                  <button key={n} onClick={() => setGroupCount(n)}
                    className={`py-3 rounded-lg border-2 transition-colors font-semibold text-sm ${groupCount === n ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]' : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-4 border-t border-[#2a2d3a]">
              <button onClick={onBack} className="flex-1 py-3 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm font-semibold hover:text-white transition-all">Back</button>
              <button onClick={handleCreateGroups} className="flex-1 py-3 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2">
                Create Groups <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] sticky top-0 bg-[#151821]">
          <h2 className="text-white font-bold text-lg">Assign Teams to Groups</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Group list */}
            <div className="space-y-2">
              <h3 className="text-white font-semibold text-sm">Groups</h3>
              {groups.map(g => (
                <div key={g.id} onClick={() => setSelectedGroupId(g.id)}
                  className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedGroupId === g.id ? 'border-[#ff4655] bg-[#ff4655]/10' : 'border-[#2a2d3a] bg-[#0d0f16] hover:border-[#ff4655]/30'}`}>
                  <p className="text-white font-semibold text-sm">{g.name}</p>
                  <p className="text-gray-500 text-xs">{g.teams.length} teams</p>
                </div>
              ))}
            </div>

            {/* Group detail */}
            {currentGroup && (
              <div className="lg:col-span-2 space-y-4">
                <div>
                  <h4 className="text-white font-semibold text-sm mb-2">Teams in {currentGroup.name}</h4>
                  <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3 space-y-2 min-h-16 max-h-40 overflow-y-auto">
                    {currentGroup.teams.length === 0
                      ? <p className="text-gray-600 text-xs">No teams yet</p>
                      : currentGroup.teams.map(t => (
                        <div key={t.id} className="flex items-center justify-between bg-[#151821] p-2 rounded text-sm">
                          <span className="text-white">{t.name}</span>
                          <button onClick={() => removeTeam(t.id)} className="text-gray-600 hover:text-[#ff4655] transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-white font-semibold text-sm mb-2">Available Teams</h4>
                  <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                    {getUnassigned().length === 0
                      ? <p className="text-gray-500 text-xs">All teams assigned</p>
                      : getUnassigned().map(t => (
                        <button key={t.id} onClick={() => addTeam(t.id)}
                          className="w-full flex items-center justify-between bg-[#151821] hover:bg-[#1e2130] p-2 rounded text-sm transition-colors">
                          <span className="text-white">{t.name}</span>
                          <Plus className="w-4 h-4 text-[#ff4655]" />
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Qualify per group */}
          <div>
            <label className="block text-xs text-gray-400 mb-3 font-medium uppercase tracking-wider">
              Teams Qualifying Per Group for Stage 2
            </label>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: Math.max(1, maxQualify) }, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => setTeamsQualifyingPerGroup(n)}
                  className={`py-3 rounded-lg border-2 transition-colors font-semibold text-sm ${teamsQualifyingPerGroup === n ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]' : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50'}`}>
                  {n}
                </button>
              ))}
            </div>
            <p className="text-green-400 text-xs mt-2">
              ✓ {totalQualifiers} total teams will advance to Stage 2
            </p>
          </div>

          <div className="flex gap-3 pt-4 border-t border-[#2a2d3a]">
            <button onClick={() => setGroupsCreated(false)} className="flex-1 py-3 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm font-semibold hover:text-white transition-all">Back</button>
            <button
              onClick={() => onComplete(groups, teamsQualifyingPerGroup)}
              disabled={getUnassigned().length > 0}
              className="flex-1 py-3 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirm Group Stage <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function TwoStageTournamentModal({ teams, onClose, onComplete }: TwoStageTournamentModalProps) {
  const [step, setStep] = useState<'format' | 'groups'>('format');
  const [pendingFormat, setPendingFormat] = useState<Stage1Format>('single');
  const [pendingQualifiers, setPendingQualifiers] = useState<number>(4);
  const [pendingPointsPerWin, setPendingPointsPerWin] = useState<number>(DEFAULT_POINTS_PER_WIN);

  const handleFormatNext = (format: Stage1Format, qualifiersCount: number, pointsPerWin: number) => {
    setPendingFormat(format);
    setPendingQualifiers(qualifiersCount);
    setPendingPointsPerWin(pointsPerWin);
    if (format === 'groupstage') {
      setStep('groups');
    } else {
      onComplete({ format, qualifiersCount, pointsPerWin });
    }
  };

  if (step === 'format') {
    return <FormatStep teams={teams} onNext={handleFormatNext} onClose={onClose} />;
  }

  return (
    <GroupsStep
      teams={teams}
      qualifiersCount={pendingQualifiers}
      onBack={() => setStep('format')}
      onClose={onClose}
      onComplete={(groups, teamsQualifyingPerGroup) => {
        onComplete({
          format: 'groupstage',
          qualifiersCount: groups.length * teamsQualifyingPerGroup,
          groups,
          teamsQualifyingPerGroup,
          pointsPerWin: pendingPointsPerWin,
        });
      }}
    />
  );
}
