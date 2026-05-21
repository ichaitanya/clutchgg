import { Eye } from 'lucide-react';

interface LiveMatchProps {
  team1: string;
  team2: string;
  score1: number;
  score2: number;
  map: string;
  viewers: string;
  isLive?: boolean;
}

export function LiveMatch({ team1, team2, score1, score2, map, viewers, isLive = true }: LiveMatchProps) {
  return (
    <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4 hover:border-[#ff4655]/50 transition-colors">
      {isLive && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-[#ff4655] rounded-full animate-pulse" />
            <span className="text-[#ff4655] text-xs font-semibold uppercase">Live</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400 text-xs">
            <Eye className="w-3 h-3" />
            <span>{viewers}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-md flex items-center justify-center text-white font-bold text-sm">
              {team1.substring(0, 2)}
            </div>
            <span className="text-white font-semibold">{team1}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-700 rounded-md flex items-center justify-center text-white font-bold text-sm">
              {team2.substring(0, 2)}
            </div>
            <span className="text-white font-semibold">{team2}</span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="text-2xl font-bold text-white">{score1}</div>
          <div className="text-2xl font-bold text-white">{score2}</div>
        </div>
      </div>

      <div className="text-xs text-gray-400 text-center pt-3 border-t border-[#2a2d3a]">
        {map}
      </div>
    </div>
  );
}
