import { X, Swords } from 'lucide-react';
import { useState } from 'react';
import {
  generateSimplifiedSingleEliminationBracket,
  generateSimplifiedDoubleEliminationBracket,
  generateSimplifiedRoundRobinBracket,
  nextPowerOfTwo,
} from '../utils/bracketUtils';
import type { BracketGenerated, TeamInTournament } from './TournamentCreation';

interface BracketConfigurationModalProps {
  onClose: () => void;
  onGenerate: (bracket: BracketGenerated) => void;
  isSecondStage?: boolean;
  qualifiedTeamsCount?: number;
  teams?: TeamInTournament[];
}

export function BracketConfigurationModal({
  onClose,
  onGenerate,
  isSecondStage = false,
  qualifiedTeamsCount,
  teams = [],
}: BracketConfigurationModalProps) {
  const [bracketType, setBracketType] = useState<'single' | 'double' | 'roundrobin'>('single');

  const teamCount = qualifiedTeamsCount ?? teams.length;
  const paddedCount = nextPowerOfTwo(teamCount);
  const byeCount = paddedCount - teamCount;

  const allBracketTypes = [
    {
      id: 'single' as const,
      label: 'Single Elimination',
      description: 'Teams are paired for matches. Losers are eliminated immediately.',
    },
    {
      id: 'double' as const,
      label: 'Double Elimination',
      description: 'Losers get a second chance in the losers bracket. Must win twice to be eliminated.',
    },
    {
      id: 'roundrobin' as const,
      label: 'Round Robin',
      description: 'Every team plays every other team once. Standings based on wins.',
    },
  ];
  const bracketTypes = isSecondStage
    ? allBracketTypes.filter(t => t.id !== 'roundrobin')
    : allBracketTypes;

  const handleGenerate = () => {
    let bracket: BracketGenerated;

    switch (bracketType) {
      case 'single':
        bracket = generateSimplifiedSingleEliminationBracket(teams, qualifiedTeamsCount);
        break;
      case 'double':
        bracket = generateSimplifiedDoubleEliminationBracket(teams, qualifiedTeamsCount);
        break;
      case 'roundrobin':
        bracket = generateSimplifiedRoundRobinBracket(teams);
        break;
    }

    onGenerate(bracket);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] sticky top-0 bg-[#151821]">
          <div className="flex items-center gap-2">
            <Swords className="w-5 h-5 text-[#ff4655]" />
            <div>
              <h2 className="text-white font-bold text-lg">
                {isSecondStage ? 'Create Knockout Stage Bracket' : 'Create Bracket Structure'}
              </h2>
              {isSecondStage && (
                <p className="text-xs text-gray-400 mt-1">Second stage: Teams qualified from group stage</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Team count info */}
          <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-4 py-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-white text-sm font-semibold">{teamCount} teams</p>
              {bracketType !== 'roundrobin' && byeCount > 0 && (
                <p className="text-gray-500 text-xs mt-0.5">
                  Bracket size: {paddedCount} slots · {byeCount} bye{byeCount > 1 ? 's' : ''} added automatically
                </p>
              )}
              {bracketType === 'roundrobin' && (
                <p className="text-gray-500 text-xs mt-0.5">
                  {teamCount % 2 !== 0 ? `${teamCount - 1} pairs per round · 1 bye per round` : `${teamCount / 2} matches per round`}
                </p>
              )}
            </div>
          </div>

          {/* Bracket Type Selection */}
          <div>
            <label className="flex items-center gap-2 text-white font-semibold text-sm mb-3">
              <Swords className="w-4 h-4 text-[#ff4655]" />
              Select Bracket Mode
            </label>
            <div className="space-y-3">
              {bracketTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => setBracketType(type.id)}
                  className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                    bracketType === type.id
                      ? 'border-[#ff4655] bg-[#ff4655]/10'
                      : 'border-[#2a2d3a] bg-[#0d0f16] hover:border-[#ff4655]/50'
                  }`}
                >
                  <p className={`font-semibold text-sm ${bracketType === type.id ? 'text-[#ff4655]' : 'text-white'}`}>
                    {type.label}
                  </p>
                  <p className="text-gray-500 text-xs mt-1">{type.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className={`border rounded-lg p-4 ${isSecondStage ? 'bg-purple-900/20 border-purple-700/30' : 'bg-[#0d0f16] border-[#2a2d3a]'}`}>
            <p className={`text-sm ${isSecondStage ? 'text-purple-300' : 'text-gray-300'}`}>
              💡 <span className="font-semibold">Note:</span>{' '}
              {isSecondStage
                ? 'This creates the knockout stage bracket for qualified teams.'
                : 'Teams are auto-populated from your tournament roster. You can set match dates and times after creation.'}
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
              onClick={handleGenerate}
              disabled={teamCount < 2}
              className={`flex-1 py-3 rounded-lg text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                isSecondStage ? 'bg-purple-600 hover:bg-purple-700' : 'bg-[#ff4655] hover:bg-[#ff3344]'
              }`}
            >
              <Swords className="w-4 h-4" />
              {isSecondStage ? 'Create Knockout Bracket' : 'Create Bracket Structure'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
