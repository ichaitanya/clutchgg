import { useNavigate } from 'react-router-dom';

interface UpcomingMatchProps {
  team1: string;
  team2: string;
  tournament: string;
  date: string;
  time: string;
  matchId?: string;
  // Tournament bracket matches open the rich tournament match page; standalone
  // admin matches use the legacy scoreboard page.
  isTournamentMatch?: boolean;
}

export function UpcomingMatch({ team1, team2, tournament, date, time, matchId, isTournamentMatch }: UpcomingMatchProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (matchId) {
      navigate(isTournamentMatch ? `/tournament-match/${matchId}` : `/match/${matchId}`);
    }
  };

  const meta = [tournament, 'Best of 3'].filter(Boolean).join(' • ');
  const when = [date, time].filter(Boolean).join(' ');

  const TeamBadge = ({ name }: { name: string }) => (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 bg-[#353534] border border-[#2b2b2b] flex items-center justify-center text-white text-xs font-inter font-bold uppercase">
        {name.substring(0, 1)}
      </div>
      <span className="text-white text-sm font-chivo">{name}</span>
    </div>
  );

  return (
    <div
      onClick={handleClick}
      className="bg-[#1c1b1b] border border-[#2b2b2b] p-6 flex items-center justify-between hover:border-[#ff4655]/40 transition-colors cursor-pointer"
    >
      <div className="flex-1 flex items-center gap-10 min-w-0">
        <div className="flex items-center gap-6">
          <TeamBadge name={team1} />
          <span className="text-[#f5f3f3] text-[10px] font-inter font-bold">VS</span>
          <TeamBadge name={team2} />
        </div>
        {meta && (
          <span className="text-[#efeeed] text-[10px] font-inter truncate hidden sm:block">
            {meta}
          </span>
        )}
      </div>

      <span className="text-[#ff4655] text-[11px] font-inter text-right whitespace-nowrap">
        {when || 'TBD'}
      </span>
    </div>
  );
}
