import { useNavigate } from 'react-router-dom';

interface UpcomingMatchProps {
  team1: string;
  team2: string;
  tournament: string;
  date: string;
  time: string;
  team1Logo?: string;
  team2Logo?: string;
  format?: 'bo1' | 'bo3' | 'bo5';
  matchId?: string;
  isTournamentMatch?: boolean;
}

const FORMAT_LABEL: Record<'bo1' | 'bo3' | 'bo5', string> = {
  bo1: 'Best of 1',
  bo3: 'Best of 3',
  bo5: 'Best of 5',
};

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().substring(0, 2).toUpperCase();
}

function countdownLabel(date: string, time: string): string | null {
  if (!date) return null;
  const target = new Date(`${date}T${time || '00:00'}`).getTime();
  if (Number.isNaN(target)) return null;
  const diffMs = target - Date.now();
  if (diffMs <= 0) return null;
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `In ${mins} min${mins !== 1 ? 's' : ''}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `In ${hours} hour${hours !== 1 ? 's' : ''}`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `In ${weeks} week${weeks !== 1 ? 's' : ''}`;
  const months = Math.round(days / 30);
  return `In ${months} month${months !== 1 ? 's' : ''}`;
}

export function UpcomingMatch({
  team1, team2, tournament, date, time, team1Logo, team2Logo, format, matchId, isTournamentMatch,
}: UpcomingMatchProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (matchId) {
      navigate(isTournamentMatch ? `/tournament-match/${matchId}` : `/match/${matchId}`);
    }
  };

  const formatLabel = format ? FORMAT_LABEL[format] : 'Best of 3';
  const countdown = countdownLabel(date, time);
  const exact = date
    ? `${new Date(`${date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${time ? ` · ${time}` : ''}`
    : '';

  // Right: name → logo | VS | Left: logo → name  (logos always face the VS)
  const TeamSide = ({ name, logo, align }: { name: string; logo?: string; align: 'left' | 'right' }) => (
    <div className={`arena-upcoming__team arena-upcoming__team--${align}`}>
      {align === 'left' && (
        <span className="arena-upcoming__logo">
          {logo ? <img src={logo} alt="" /> : <span className="arena-upcoming__logo-text">{teamInitials(name)}</span>}
        </span>
      )}
      <span className="arena-upcoming__name">{name}</span>
      {align === 'right' && (
        <span className="arena-upcoming__logo">
          {logo ? <img src={logo} alt="" /> : <span className="arena-upcoming__logo-text">{teamInitials(name)}</span>}
        </span>
      )}
    </div>
  );

  return (
    <button type="button" onClick={handleClick} className="arena-upcoming">
      <div className="arena-upcoming__matchup">
        <TeamSide name={team1} logo={team1Logo} align="right" />
        <span className="arena-upcoming__vs">VS</span>
        <TeamSide name={team2} logo={team2Logo} align="left" />
      </div>

      <div className="arena-upcoming__meta">
        <span className="arena-upcoming__tournament" title={tournament}>{tournament}</span>
        <span className="arena-upcoming__dot" />
        <span className="arena-upcoming__format">{formatLabel}</span>
      </div>

      {(countdown || exact) && (
        <div className="arena-upcoming__when">
          {countdown && <span className="arena-upcoming__countdown">{countdown}</span>}
          {exact && <span className="arena-upcoming__exact">{exact}</span>}
        </div>
      )}
    </button>
  );
}
