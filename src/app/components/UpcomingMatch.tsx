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
    <div className="arena-match-team">
      <div className="arena-match-logo">{name.substring(0, 1)}</div>
      <span className="arena-match-name">{name}</span>
    </div>
  );

  return (
    <div onClick={handleClick} className="arena-match-row">
      <div className="flex-1 flex items-center gap-10 min-w-0">
        <div className="flex items-center gap-6">
          <TeamBadge name={team1} />
          <span className="arena-match-vs">VS</span>
          <TeamBadge name={team2} />
        </div>
        {meta && (
          <span className="arena-match-meta truncate hidden sm:block">{meta}</span>
        )}
      </div>
      <span className="arena-match-time">{when || 'TBD'}</span>
    </div>
  );
}
