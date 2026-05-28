import { useState } from 'react';
import { X, Users, Swords } from 'lucide-react';
import {
  generateSimplifiedSingleEliminationBracket,
  generateSimplifiedDoubleEliminationBracket,
  generateSimplifiedRoundRobinBracket,
} from '../utils/bracketUtils';
import type { BracketGenerated } from './TournamentCreation';

interface BracketConfigurationModalProps {
  onClose: () => void;
  onGenerate: (bracket: BracketGenerated) => void;
  isSecondStage?: boolean;
  qualifiedTeamsCount?: number;
}

export function BracketConfigurationModal({
  onClose,
  onGenerate,
  isSecondStage = false,
  qualifiedTeamsCount,
}: BracketConfigurationModalProps) {
  const [teamCount, setTeamCount] = useState<number>(qualifiedTeamsCount || 8);
  const [bracketType, setBracketType] = useState<'single' | 'double' | 'roundrobin'>('single');

  const bracketTypes = [
    {
      id: 'single',
      label: 'Single Elimination',
      description: 'Teams are paired for matches. Losers are eliminated immediately.',
      requirements: 'Must be power of 2 (4, 8, 16, 32, 64)',
    },
    {
      id: 'double',
      label: 'Double Elimination',
      description: 'Losers get a second chance in the losers bracket. Must win twice to be eliminated.',
      requirements: 'Must be power of 2 (4, 8, 16, 32, 64)',
    },
    {
      id: 'roundrobin',
      label: 'Round Robin',
      description: 'Every team plays every other team once. Standings based on wins.',
      requirements: 'Any number of teams (2-64)',
    },
  ];

  const teamOptions = [4, 8, 16, 32, 64];

  const handleGenerate = () => {
    let bracket: BracketGenerated;

    switch (bracketType) {
      case 'single':
        bracket = generateSimplifiedSingleEliminationBracket(teamCount);
        break;
      case 'double':
        bracket = generateSimplifiedDoubleEliminationBracket(teamCount);
        break;
      case 'roundrobin':
        bracket = generateSimplifiedRoundRobinBracket(teamCount);
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
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Team Count Selection */}
          <div>
            <label className="flex items-center gap-2 text-white font-semibold text-sm mb-3">
              <Users className="w-4 h-4 text-[#ff4655]" />
              Select Number of Teams
            </label>
            <div className="grid grid-cols-5 gap-3">
              {teamOptions.map((num) => (
                <button
                  key={num}
                  onClick={() => setTeamCount(num)}
                  className={`py-3 rounded-lg border-2 transition-colors font-semibold text-sm ${
                    teamCount === num
                      ? 'border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]'
                      : 'border-[#2a2d3a] bg-[#0d0f16] text-gray-400 hover:border-[#ff4655]/50 hover:text-white'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              This creates {teamCount} empty team slots that you'll fill in manually
            </p>
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
                  onClick={() => setBracketType(type.id as 'single' | 'double' | 'roundrobin')}
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
                  <p className="text-gray-600 text-xs mt-2">Requirements: {type.requirements}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className={`border rounded-lg p-4 ${isSecondStage ? 'bg-purple-900/20 border-purple-700/30' : 'bg-[#0d0f16] border-[#2a2d3a]'}`}>
            <p className={`text-sm ${isSecondStage ? 'text-purple-300' : 'text-gray-300'}`}>
              💡 <span className="font-semibold">Note:</span> {isSecondStage 
                ? 'This creates the knockout stage bracket for qualified teams. The qualified teams from each group will compete in this stage.'
                : 'This creates an empty bracket structure. You\'ll be able to add team names manually after creation. The bracket will be visible to users in the Matches section but uneditable.'}
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
              className={`flex-1 py-3 rounded-lg text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                isSecondStage 
                  ? 'bg-purple-600 hover:bg-purple-700' 
                  : 'bg-[#ff4655] hover:bg-[#ff3344]'
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
