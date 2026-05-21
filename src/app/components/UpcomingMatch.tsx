import { Calendar, Clock } from 'lucide-react';

interface UpcomingMatchProps {
  team1: string;
  team2: string;
  tournament: string;
  date: string;
  time: string;
}

export function UpcomingMatch({ team1, team2, tournament, date, time }: UpcomingMatchProps) {
  return (
    <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4 hover:border-[#ff4655]/30 transition-colors cursor-pointer">
      <div className="flex items-center justify-between mb-4">
        <div className="flex-1 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-700 rounded flex items-center justify-center text-white text-xs font-bold">
              {team1.substring(0, 2)}
            </div>
            <span className="text-white text-sm">{team1}</span>
          </div>

          <span className="text-gray-500 text-xs mx-4">vs</span>

          <div className="flex items-center gap-3">
            <span className="text-white text-sm">{team2}</span>
            <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-700 rounded flex items-center justify-center text-white text-xs font-bold">
              {team2.substring(0, 2)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-400 pt-3 border-t border-[#2a2d3a]">
        <span>{tournament}</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <span>{date}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{time}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
