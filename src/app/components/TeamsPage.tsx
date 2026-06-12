import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, Users, User, ChevronRight, ChevronDown, ChevronUp, Trophy, ArrowRight, Search } from 'lucide-react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { LoadingState } from './LoadingState';
import type { Tournament, TeamInTournament, TournamentPlayer, BracketGenerated } from './TournamentCreation';
import { getTournaments, loadWithRetry } from '../services/db';
import { statMatchesPlayer } from './StatsPage';
import { computeRRStandings } from './BracketDisplay';
import { deriveTournamentStatus } from '../utils/tournamentStatus';
import { effectiveStatus, deriveScore, isTeamSlotName } from '../utils/tournamentDerive';
import { orderRosterIglFirst } from '../utils/roster';
import { mapImageUrl } from '../utils/valorantAssets';

type ViewMode = 'teams' | 'players';

// Aggregated stat line for one roster player, averaged across every map they
// appear in throughout the selected team's tournament.
interface PlayerStatLine {
  mapsPlayed: number;
  acs: number;
  kd: number;
  hsPercent: number;
}

// One match in a team's track record, oriented to the selected team (its own
// score first), with the opponent resolved for display.
interface TeamMatch {
  id: string;
  status: 'upcoming' | 'live' | 'completed';
  date?: string;
  time?: string;
  oppName: string;
  oppLogo?: string;
  teamScore: number;
  oppScore: number;
  won: boolean;
  // Map results oriented to the team (teamScore first) for the expandable view.
  maps: { mapName: string; teamScore: number; oppScore: number }[];
}

// One tournament the selected team took part in: how many matches they played,
// the live status, (only when completed) their final standing, and the team's
// upcoming + completed matches for the expandable track-record row.
interface TournamentRecord {
  tournamentId: string;
  tournamentName: string;
  matchesPlayed: number;
  status: 'planning' | 'registration' | 'in-progress' | 'completed';
  placement: string; // final standing, or '' when not yet completed/determinable
  upcoming: TeamMatch[];   // soonest first
  completed: TeamMatch[];  // most recent first
}

// Human label for a tournament status.
const STATUS_LABEL: Record<TournamentRecord['status'], string> = {
  'registration': 'Registration',
  'planning': 'Upcoming',
  'in-progress': 'In Progress',
  'completed': 'Completed',
};

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// Two uppercase initials of a team name, for the logo fallback crest.
function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().substring(0, 2).toUpperCase();
}

// Find a team (by normalized name) inside a tournament's roster.
function findTeamInTournament(t: Tournament, teamName: string): TeamInTournament | undefined {
  const norm = teamName.trim().toLowerCase();
  return t.teams.find(tm => tm.name.trim().toLowerCase() === norm);
}

// Determine the team's final placement in a completed tournament. Returns null
// when the format doesn't yield a determinable standing.
// Exported: the tournament page's Standings tab ranks teams with the same logic.
export function computePlacement(t: Tournament, teamId: string): string | null {
  // Two-stage / single elimination: placement comes from how far the team got.
  // The team that wins the last match of the final stage is 1st.
  const finalStageBracket = t.stage2Bracket || t.generatedBracket;

  // For round-robin / group-stage tournaments, derive rank from the standings.
  const rrBracket = [t.generatedBracket, t.stage1Bracket].find(b => b?.bracketType === 'roundrobin');
  if (rrBracket && !t.stage2Bracket) {
    const rows = computeRRStandings(rrBracket.rounds, rrBracket.rrTeams ?? [], rrBracket.pointsPerWin);
    const idx = rows.findIndex(r => r.teamId === teamId);
    if (idx >= 0) return ordinal(idx + 1);
  }

  // Group stage (one table per group): report best group placement.
  if (t.stage1Config?.format === 'groupstage' && t.stage1Bracket && !t.stage2Bracket) {
    let best: number | null = null;
    for (const g of t.stage1Config.groups ?? []) {
      const matches = t.stage1Bracket.rounds.flat().filter(m => m.id.includes(`gs_${g.id}_`));
      const rrTeams = g.teams.map(tm => ({ id: tm.id, name: tm.name }));
      const rows = computeRRStandings([matches], rrTeams, t.stage1Bracket.pointsPerWin);
      const idx = rows.findIndex(r => r.teamId === teamId);
      if (idx >= 0) best = best === null ? idx + 1 : Math.min(best, idx + 1);
    }
    if (best !== null) return ordinal(best);
  }

  // Elimination bracket: champion = winner of the highest round's last match.
  if (finalStageBracket?.rounds.length) {
    const lastRound = finalStageBracket.rounds[finalStageBracket.rounds.length - 1];
    const grandFinal = lastRound[lastRound.length - 1];
    if (grandFinal?.winner) {
      if (grandFinal.winner === teamId) return '1st';
      // Runner-up: the other team in the final.
      if (grandFinal.team1Id === teamId || grandFinal.team2Id === teamId) return '2nd';
    }
    // Otherwise, find the furthest round the team reached, report as "Top N".
    let furthestRound = -1;
    finalStageBracket.rounds.forEach((round, ri) => {
      if (round.some(m => m.team1Id === teamId || m.team2Id === teamId)) furthestRound = ri;
    });
    if (furthestRound >= 0) {
      // Teams remaining at round r is 2^(rounds - r). Express as "Top N".
      const remaining = Math.pow(2, finalStageBracket.rounds.length - furthestRound);
      if (remaining <= 16) return `Top ${remaining}`;
    }
  }

  return null;
}

// One match line in the track-record expansion, oriented to the team. Mirrors
// the homepage Recent Results row: score + opponent, with an optional
// expandable map-scores panel (completed matches only).
function TeamMatchRow({ m }: { m: TeamMatch }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const expandable = m.status === 'completed' && m.maps.length > 0;
  const when = m.date
    ? new Date(`${m.date}T${m.time || '00:00'}`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';
  return (
    <div className="arena-tp-matchwrap">
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/tournament-match/${m.id}`)}
        onKeyDown={e => { if (e.key === 'Enter') navigate(`/tournament-match/${m.id}`); }}
        className={`arena-team-rec-match${m.status === 'completed' ? (m.won ? ' arena-team-rec-match--w' : ' arena-team-rec-match--l') : ''}`}
      >
        <span className="arena-team-rec-match__opp">
          <span className="arena-team-rec-match__vs">vs</span>
          <span className="arena-recent__logo">
            {m.oppLogo ? <img src={m.oppLogo} alt="" /> : <span>{m.oppName.trim().slice(0, 2).toUpperCase()}</span>}
          </span>
          <span className="arena-team-rec-match__name" title={m.oppName}>{m.oppName}</span>
        </span>
        {m.status === 'completed' ? (
          <span className={`arena-team-rec-match__result arena-team-rec-match__result--${m.won ? 'w' : 'l'}`}>
            <span className="arena-team-rec-match__result-tag">{m.won ? 'W' : 'L'}</span>
            <span className="arena-team-rec-match__result-score">{m.teamScore}–{m.oppScore}</span>
          </span>
        ) : (
          <span className="arena-team-rec-match__when">{when || 'TBD'}</span>
        )}
        {expandable && (
          <span
            role="button"
            tabIndex={0}
            className={`arena-tp-matchrow__expand${open ? ' arena-tp-matchrow__expand--open' : ''}`}
            title={open ? 'Hide map scores' : 'Show map scores'}
            onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }
            }}
          >
            <ChevronDown className="w-4 h-4" />
          </span>
        )}
      </div>
      {expandable && open && (
        <div className="arena-tp-mapscores">
          {m.maps.map((mp, mi) => {
            const w1 = mp.teamScore > mp.oppScore;
            const w2 = mp.oppScore > mp.teamScore;
            const splash = mapImageUrl(mp.mapName);
            return (
              <div
                key={mi}
                className="arena-tp-mapscores__row"
                style={splash ? {
                  backgroundImage: `linear-gradient(90deg, rgba(10,10,10,0.94) 0%, rgba(10,10,10,0.72) 45%, rgba(10,10,10,0.9) 100%), url(${splash})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center 35%',
                } : undefined}
              >
                <span className="arena-tp-mapscores__map">{mp.mapName || `Map ${mi + 1}`}</span>
                <span className="arena-tp-mapscores__score">
                  <span className={w1 ? 'arena-tp-mapscores__win' : ''}>{mp.teamScore}</span>
                  <span className="arena-tp-mapscores__sep">–</span>
                  <span className={w2 ? 'arena-tp-mapscores__win' : ''}>{mp.oppScore}</span>
                </span>
                <span className="arena-tp-mapscores__taker">{w1 ? 'Win' : w2 ? 'Loss' : 'Tied'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// One tournament in the team's track record: a header row that expands to show
// the team's upcoming (top 3 → all) and completed (last 5 → all) matches.
function TeamRecordRow({ rec }: { rec: TournamentRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const hasMatches = rec.upcoming.length > 0 || rec.completed.length > 0;
  const shownUpcoming = showAllUpcoming ? rec.upcoming : rec.upcoming.slice(0, 3);
  const shownCompleted = showAllCompleted ? rec.completed : rec.completed.slice(0, 5);
  // The team's series record in this tournament (for the header badge).
  const wins = rec.completed.filter(m => m.won).length;
  const losses = rec.completed.length - wins;
  return (
    <div className={`arena-team-rec${expanded ? ' arena-team-rec--open' : ''}`}>
      <div className="arena-team-rec__head">
        <span className="arena-roster-record__trophy">
          <Trophy className="w-4 h-4" />
        </span>
        <div className="arena-roster-record__name-wrap">
          <Link to={`/tournament/${rec.tournamentId}`} className="arena-roster-record__name arena-team-rec__name-link">
            {rec.tournamentName}
          </Link>
          <p className="arena-roster-record__meta">
            <span className={`arena-team-rec__status arena-team-rec__status--${rec.status}`}>{STATUS_LABEL[rec.status]}</span>
            {rec.completed.length > 0 && (
              <span className="arena-team-rec__record">
                <span className="arena-team-rec__record-w">{wins}W</span>
                <span className="arena-team-rec__record-sep">·</span>
                <span className="arena-team-rec__record-l">{losses}L</span>
              </span>
            )}
          </p>
        </div>
        <div className="arena-roster-record__placement">
          <p className="arena-roster-analytics__stat-label">Final Standing</p>
          <p className="arena-roster-record__placement-value">{rec.placement || '—'}</p>
        </div>
        {hasMatches ? (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className={`arena-team-rec__toggle${expanded ? ' arena-team-rec__toggle--open' : ''}`}
            title={expanded ? 'Hide matches' : 'Show matches'}
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        ) : (
          <span className="arena-team-rec__toggle arena-team-rec__toggle--empty" />
        )}
      </div>

      {expanded && hasMatches && (
        <div className="arena-team-rec__body">
          {rec.upcoming.length > 0 && (
            <div className="arena-team-rec__group">
              <p className="arena-team-rec__group-title">Upcoming</p>
              <div className="arena-team-rec__matches">
                {shownUpcoming.map(m => <TeamMatchRow key={m.id} m={m} />)}
              </div>
              {rec.upcoming.length > 3 && (
                <button type="button" className="arena-team-rec__more" onClick={() => setShowAllUpcoming(s => !s)}>
                  {showAllUpcoming ? 'Show less' : `View all ${rec.upcoming.length} upcoming`}
                </button>
              )}
            </div>
          )}
          {rec.completed.length > 0 && (
            <div className="arena-team-rec__group">
              <p className="arena-team-rec__group-title">Completed</p>
              <div className="arena-team-rec__matches">
                {shownCompleted.map(m => <TeamMatchRow key={m.id} m={m} />)}
              </div>
              {rec.completed.length > 5 && (
                <button type="button" className="arena-team-rec__more" onClick={() => setShowAllCompleted(s => !s)}>
                  {showAllCompleted ? 'Show less' : `View all ${rec.completed.length} completed`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TeamsPage() {
  const navigate = useNavigate();
  const { teamId: routeTeamId } = useParams();
  const [viewMode, setViewMode] = useState<ViewMode>(routeTeamId ? 'players' : 'teams');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(routeTeamId ?? null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  // Distinguishes "first fetch still in flight" from "loaded, genuinely empty"
  // so we can show a loader instead of the "No teams created yet" empty state.
  const [loaded, setLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Teams list is paginated at 15 per page, ordered by recent tournament
  // activity (most recently active squads first).
  const [page, setPage] = useState(0);
  // Expand toggles (default collapsed): the substitutes roster list and the
  // Player Performance Index each show the first 5 until expanded, independently.
  const [showAllRoster, setShowAllRoster] = useState(false);
  const [showAllAnalytics, setShowAllAnalytics] = useState(false);

  useEffect(() => loadWithRetry(getTournaments, ts => { setTournaments(ts); setLoaded(true); }), []);

  useEffect(() => {
    if (routeTeamId) {
      setSelectedTeamId(routeTeamId);
      setViewMode('players');
    }
  }, [routeTeamId]);

  // Collapse both expandable sections when navigating to a different team, and
  // reset the scroll position — selecting a team is a state change (not a route
  // change), so the global ScrollToTop doesn't fire and the roster would
  // otherwise open already scrolled to wherever the team list was.
  useEffect(() => {
    if (selectedTeamId) window.scrollTo(0, 0);
    setShowAllRoster(false);
    setShowAllAnalytics(false);
  }, [selectedTeamId]);

  const allTeams: (TeamInTournament & { tournamentName: string; tournamentId: string; overview?: string })[] = useMemo(() => {
    const norm = (s: string) => s.trim().toLowerCase();

    type TeamRow = TeamInTournament & { tournamentName: string; tournamentId: string; overview?: string };

    // Group same-named teams across tournaments into one roster when they share
    // at least 2 players (so a recurring squad — even with a changed line-up —
    // is one team, but a totally different squad sharing a name stays separate).
    // Each group accumulates the union of its players (deduped by name, photo
    // preferred) so new faces get added to the roster instead of a new tile.
    interface Group {
      row: TeamRow;
      names: Set<string>;          // normalized player names in this group
      playerByName: Map<string, TournamentPlayer>;
      order: string[];             // insertion order of normalized names
      activity: number;            // most-recent activity timestamp (ms), for ordering
    }
    const groups: Group[] = [];

    // A tournament's recency: the latest match date across all its brackets,
    // falling back to the event's scheduled start date (0 when nothing dated).
    const tournamentActivity = (t: Tournament): number => {
      let latest = 0;
      const brackets = [t.generatedBracket, t.stage1Bracket, t.stage2Bracket];
      for (const b of brackets) {
        for (const m of b?.rounds.flat() ?? []) {
          if (!m.date) continue;
          const ts = new Date(`${m.date}T${m.time || '00:00'}`).getTime();
          if (!Number.isNaN(ts)) latest = Math.max(latest, ts);
        }
      }
      if (t.event?.startDate) {
        const ts = new Date(t.event.startDate).getTime();
        if (!Number.isNaN(ts)) latest = Math.max(latest, ts);
      }
      return latest;
    };

    const upsertPlayer = (g: Group, p: TournamentPlayer) => {
      const k = norm(p.name);
      if (!k) return;
      const existing = g.playerByName.get(k);
      if (!existing) {
        g.playerByName.set(k, { ...p });
        g.order.push(k);
        g.names.add(k);
      } else {
        // Fill in any details the canonical entry is missing.
        if (!existing.photo && p.photo) existing.photo = p.photo;
        if (!existing.role && p.role) existing.role = p.role;
        if (!existing.riotId && p.riotId) existing.riotId = p.riotId;
      }
    };

    tournaments.forEach(tournament => {
      const activity = tournamentActivity(tournament);
      tournament.teams.forEach(team => {
        const tk = norm(team.name);
        const teamNames = new Set(team.players.map(p => norm(p.name)).filter(Boolean));

        // Match an existing group: same name AND ≥2 shared players (or, when a
        // roster has fewer than 2 players, just the same name).
        const match = groups.find(g => {
          if (norm(g.row.name) !== tk) return false;
          let shared = 0;
          for (const n of teamNames) if (g.names.has(n)) shared++;
          return shared >= 2 || teamNames.size < 2 || g.names.size < 2;
        });

        if (match) {
          if (!match.row.logo && team.logo) match.row.logo = team.logo;
          team.players.forEach(p => upsertPlayer(match, p));
          // Surface the most recently active tournament as the team's tag, and
          // track the team's latest activity for list ordering.
          if (activity > match.activity) {
            match.activity = activity;
            match.row.tournamentName = tournament.name;
            match.row.tournamentId = tournament.id;
          }
        } else {
          const g: Group = {
            row: {
              ...team,
              players: [],
              tournamentName: tournament.name,
              tournamentId: tournament.id,
              overview: tournament.overview,
            },
            names: new Set(),
            playerByName: new Map(),
            order: [],
            activity,
          };
          team.players.forEach(p => upsertPlayer(g, p));
          groups.push(g);
        }
      });
    });

    // Most recently active squads first; ties fall back to name for stability.
    return groups
      .sort((a, b) => b.activity - a.activity || a.row.name.localeCompare(b.row.name))
      .map(g => ({
        ...g.row,
        players: g.order.map(k => g.playerByName.get(k)!),
      }));
  }, [tournaments]);

  const TEAMS_PER_PAGE = 15;

  const filteredTeams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allTeams;
    return allTeams.filter(t => t.name.toLowerCase().includes(q));
  }, [allTeams, searchQuery]);

  // Reset to the first page whenever the result set changes (search/data).
  useEffect(() => { setPage(0); }, [searchQuery, filteredTeams.length]);

  const pageCount = Math.max(1, Math.ceil(filteredTeams.length / TEAMS_PER_PAGE));
  const pagedTeams = useMemo(
    () => filteredTeams.slice(page * TEAMS_PER_PAGE, page * TEAMS_PER_PAGE + TEAMS_PER_PAGE),
    [filteredTeams, page],
  );

  const selectedTeam = useMemo(() => {
    const fromList = allTeams.find(t => t.id === selectedTeamId);
    if (fromList) return fromList;
    for (const t of tournaments) {
      const team = t.teams.find(tm => tm.id === selectedTeamId);
      if (team) return { ...team, tournamentName: t.name, tournamentId: t.id, overview: t.overview };
    }
    return undefined;
  }, [selectedTeamId, allTeams, tournaments]);

  // Roster ordered with the IGL first, so the featured mosaic tile and the
  // substitutes list both lead with the in-game leader.
  const rosterPlayers = useMemo(
    () => (selectedTeam ? orderRosterIglFirst(selectedTeam.players) : []),
    [selectedTeam],
  );

  useEffect(() => {
    if (allTeams.length > 0 && !selectedTeamId && viewMode === 'teams') {
      setSelectedTeamId(allTeams[0].id);
    }
  }, [allTeams.length]);

  // Every bracket from every tournament where the selected team appears (by name).
  // This ensures stats aggregate correctly across all tournaments the team plays in.
  const allTeamTournaments = useMemo(() => {
    if (!selectedTeam) return [];
    return tournaments.filter(t => findTeamInTournament(t, selectedTeam.name));
  }, [selectedTeam, tournaments]);

  const teamBrackets = useMemo<BracketGenerated[]>(() => {
    const brackets: BracketGenerated[] = [];
    for (const t of allTeamTournaments) {
      [t.generatedBracket, t.stage1Bracket, t.stage2Bracket].forEach(b => {
        if (b) brackets.push(b);
      });
    }
    return brackets;
  }, [allTeamTournaments]);

  // The team's own description — taken from the first tournament instance that
  // has one filled in. Empty when the admin never set a description.
  const teamDescription = useMemo(() => {
    if (!selectedTeam) return '';
    for (const t of allTeamTournaments) {
      const teamHere = findTeamInTournament(t, selectedTeam.name);
      if (teamHere?.description?.trim()) return teamHere.description.trim();
    }
    return selectedTeam.description?.trim() ?? '';
  }, [selectedTeam, allTeamTournaments]);

  // Win percentage across all the team's matches (match results are ground truth).
  const winPercentage = useMemo(() => {
    if (!selectedTeam) return '0%';
    let wins = 0;
    let total = 0;
    for (const bracket of teamBrackets) {
      for (const match of bracket.rounds.flat()) {
        const isTeam1 = match.team1Id === selectedTeam.id;
        const isTeam2 = match.team2Id === selectedTeam.id;
        if (!isTeam1 && !isTeam2) continue;
        if (!match.winner) continue; // only count decided matches
        total++;
        if (match.winner === selectedTeam.id) wins++;
      }
    }
    if (total === 0) return '—';
    return `${Math.round((wins / total) * 100)}%`;
  }, [selectedTeam, teamBrackets]);

  // Per-player aggregated stats (ACS / K/D / HS%) from applied match data,
  // aggregated across every tournament the team plays in. Keyed by lowercased
  // player NAME (not id) so lookups work regardless of which tournament instance
  // the selected roster came from — player ids differ per tournament, names don't.
  const playerStats = useMemo<Record<string, PlayerStatLine>>(() => {
    if (!selectedTeam) return {};
    const out: Record<string, PlayerStatLine> = {};

    // Every player name that appears on this team across all its tournaments.
    const playerNames = new Set<string>();
    for (const t of allTeamTournaments) {
      const teamHere = findTeamInTournament(t, selectedTeam.name);
      if (!teamHere) continue;
      for (const player of teamHere.players) playerNames.add(player.name.trim().toLowerCase());
    }

    // For each name, sum stats from every bracket where a stat line shares that name.
    for (const nameKey of playerNames) {
      let maps = 0, acsSum = 0, hsSum = 0, kills = 0, deaths = 0;
      for (const bracket of teamBrackets) {
        for (const match of bracket.rounds.flat()) {
          for (const map of match.maps ?? []) {
            for (const stat of map.playerStats ?? []) {
              const statPlayerName = (stat.playerName || '').trim().toLowerCase();
              if (statPlayerName !== nameKey) continue;
              maps++;
              acsSum += stat.acs;
              hsSum += stat.hsPercent;
              kills += stat.kills;
              deaths += stat.deaths;
            }
          }
        }
      }
      out[nameKey] = {
        mapsPlayed: maps,
        acs: maps > 0 ? acsSum / maps : 0,
        hsPercent: maps > 0 ? hsSum / maps : 0,
        kd: deaths > 0 ? kills / deaths : kills,
      };
    }
    return out;
  }, [selectedTeam, teamBrackets, allTeamTournaments]);

  // Look up a roster player's aggregated stats by name.
  const statsFor = (player: TournamentPlayer) => playerStats[player.name.trim().toLowerCase()];

  // Every tournament this team took part in (matched by name). All are listed;
  // the final standing is filled only once a tournament is completed, and left
  // empty otherwise.
  const tournamentRecords = useMemo<TournamentRecord[]>(() => {
    if (!selectedTeam) return [];
    const records: TournamentRecord[] = [];
    for (const t of tournaments) {
      const teamHere = findTeamInTournament(t, selectedTeam.name);
      if (!teamHere) continue;

      // Collect this team's real matches across every bracket, oriented to the
      // team (its own score first), split into upcoming and completed.
      const brackets = [t.generatedBracket, t.stage1Bracket, t.stage2Bracket].filter(Boolean) as BracketGenerated[];
      const logoFor = (teamId: string, name: string) => {
        const byId = t.teams.find(tm => tm.id === teamId);
        if (byId?.logo) return byId.logo;
        const norm = name.trim().toLowerCase();
        return t.teams.find(tm => tm.name.trim().toLowerCase() === norm)?.logo;
      };
      const upcoming: TeamMatch[] = [];
      const completed: TeamMatch[] = [];
      for (const b of brackets) {
        for (const m of b.rounds.flat()) {
          const isT1 = m.team1Id === teamHere.id;
          const isT2 = m.team2Id === teamHere.id;
          if (!isT1 && !isT2) continue;
          const oppName = isT1 ? m.team2Name : m.team1Name;
          const oppId = isT1 ? m.team2Id : m.team1Id;
          if (isTeamSlotName(oppName)) continue; // opponent not decided yet
          const mStatus = effectiveStatus(m);
          const { s1, s2 } = deriveScore(m);
          const teamScore = isT1 ? s1 : s2;
          const oppScore = isT1 ? s2 : s1;
          const maps = (m.maps ?? [])
            .filter(mp => mp.team1Score > 0 || mp.team2Score > 0)
            .map(mp => ({
              mapName: mp.mapName,
              teamScore: isT1 ? mp.team1Score : mp.team2Score,
              oppScore: isT1 ? mp.team2Score : mp.team1Score,
            }));
          const tm: TeamMatch = {
            id: m.id, status: mStatus, date: m.date, time: m.time,
            oppName, oppLogo: logoFor(oppId, oppName),
            teamScore, oppScore, won: teamScore > oppScore, maps,
          };
          if (mStatus === 'completed') completed.push(tm);
          else upcoming.push(tm);
        }
      }
      // Upcoming: soonest scheduled first. Completed: most recent first.
      const time = (mt: TeamMatch) => mt.date ? new Date(`${mt.date}T${mt.time || '00:00'}`).getTime() : 0;
      upcoming.sort((a, b) => (time(a) || Infinity) - (time(b) || Infinity));
      completed.sort((a, b) => time(b) - time(a));
      const matchesPlayed = completed.length;

      // Standing is only meaningful once the tournament has finished.
      const status = deriveTournamentStatus(t);
      const placement = status === 'completed' ? (computePlacement(t, teamHere.id) ?? '') : '';

      records.push({
        tournamentId: t.id,
        tournamentName: t.name,
        matchesPlayed,
        status,
        placement,
        upcoming,
        completed,
      });
    }
    return records;
  }, [selectedTeam, tournaments]);

  const goToPlayer = (playerId: string) => {
    if (selectedTeam) navigate(`/player/${selectedTeam.tournamentId}/${playerId}`);
  };

  // A player tile (image with role + name overlay). `featured` makes it taller.
  const PlayerTile = ({ player, featured = false }: { player: TournamentPlayer; featured?: boolean }) => (
    <div
      onClick={() => goToPlayer(player.id)}
      className="arena-roster-tile"
      style={{ minHeight: featured ? '100%' : undefined }}
    >
      {player.photo ? (
        <img src={player.photo} alt={player.name} className="arena-roster-tile__img" />
      ) : (
        <div className="arena-roster-tile__placeholder">
          <User className="w-10 h-10 text-gray-700" />
        </div>
      )}
      <div className="arena-roster-tile__overlay" />
      <div className="arena-roster-tile__caption">
        {player.role && <p className="arena-roster-tile__role">{player.role}</p>}
        <h3 className={`arena-roster-tile__name${featured ? ' arena-roster-tile__name--lg' : ''}`}>
          {player.name}
        </h3>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-page" style={{ paddingTop: '2.5rem', paddingBottom: '4rem' }}>
        {!loaded ? (
          <LoadingState label="Loading teams…" inline />
        ) : allTeams.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 mx-auto text-gray-600 mb-4" />
            <p className="text-gray-400 mb-2">No teams created yet</p>
            <p className="text-gray-600 text-sm">Create tournaments and add teams in the admin panel</p>
          </div>
        ) : viewMode === 'teams' ? (
          <div>
            <div className="arena-teams-header">
              <div>
                <p className="arena-md-section__eyebrow">Rosters</p>
                <h2 className="arena-md-section__title" style={{ margin: 0, fontSize: '2rem' }}>All Teams</h2>
              </div>
              <div className="arena-teams-search">
                <Search className="arena-teams-search__icon" />
                <input
                  type="text"
                  className="arena-teams-search__input"
                  placeholder="Search teams…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            {filteredTeams.length === 0 && searchQuery && (
              <p className="arena-teams-search__empty">No teams match "{searchQuery}"</p>
            )}
            <div className="arena-team-grid">
              {pagedTeams.map(team => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => {
                    setSelectedTeamId(team.id);
                    setViewMode('players');
                  }}
                  className="arena-team-card"
                >
                  <div className="arena-team-card__crest">
                    {team.logo
                      ? <img src={team.logo} alt={team.name} />
                      : <span className="arena-team-card__crest-text">{teamInitials(team.name)}</span>}
                    <span className="arena-team-card__wash" />
                  </div>
                  <div className="arena-team-card__body">
                    <h3 className="arena-team-card__name">{team.name}</h3>
                    {team.tournamentName && (
                      <p className="arena-team-card__tag">{team.tournamentName}</p>
                    )}
                    <div className="arena-team-card__meta">
                      <Users className="w-4 h-4" />
                      <span>{team.players.length} player{team.players.length !== 1 ? 's' : ''}</span>
                    </div>
                    <span className="arena-team-card__cta">View Roster <ArrowRight className="w-3.5 h-3.5" /></span>
                  </div>
                </button>
              ))}
            </div>
            {pageCount > 1 && (
              <div className="arena-teams-pagination">
                <button
                  type="button"
                  className="arena-teams-pagination__btn"
                  disabled={page === 0}
                  onClick={() => { setPage(p => Math.max(0, p - 1)); window.scrollTo(0, 0); }}
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="arena-teams-pagination__status">
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  type="button"
                  className="arena-teams-pagination__btn"
                  disabled={page >= pageCount - 1}
                  onClick={() => { setPage(p => Math.min(pageCount - 1, p + 1)); window.scrollTo(0, 0); }}
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ) : selectedTeam ? (
          <div>
            <button
              onClick={() => { setViewMode('teams'); navigate('/teams'); }}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-8"
            >
              <ChevronLeft className="w-5 h-5" />
              <span>Back to Teams</span>
            </button>

            {/* Team header */}
            <div className="text-center mb-14">
              <h1 className="arena-page-hero__title" style={{ marginTop: '1rem', marginBottom: teamDescription ? '1.25rem' : 0 }}>
                {selectedTeam.name}
              </h1>
              {teamDescription && (
                <p className="arena-page-hero__subtitle">{teamDescription}</p>
              )}
            </div>

            {/* Roster mosaic — IGL leads (featured tile), rest keep their order. */}
            {selectedTeam.players.length === 0 ? (
              <div className="text-center py-12 bg-[#161616] border border-[#2b2b2b] rounded-xl">
                <User className="w-10 h-10 mx-auto text-gray-600 mb-2" />
                <p className="text-gray-400">No players added yet</p>
              </div>
            ) : (
              <div className="arena-roster-grid">
                {/* Featured player — large, spans two rows (the IGL). */}
                <div className="arena-roster-grid__feature">
                  <PlayerTile player={rosterPlayers[0]} featured />
                </div>

                {/* Up to two stacked tiles on the right */}
                {rosterPlayers.slice(1, 3).map(p => (
                  <div key={p.id} className="arena-roster-grid__cell">
                    <PlayerTile player={p} />
                  </div>
                ))}

                {/* Bottom row: remaining players + win-rate stat card */}
                {rosterPlayers.slice(3, 5).map(p => (
                  <div key={p.id} className="arena-roster-grid__cell">
                    <PlayerTile player={p} />
                  </div>
                ))}

                {/* Win rate stat card (mirrors the "Total Earnings" tile) */}
                <div className="arena-roster-grid__cell arena-roster-stat">
                  <p className="arena-roster-stat__label">Win Rate</p>
                  <p className="arena-roster-stat__value">{winPercentage}</p>
                  <p className="arena-roster-stat__sub">
                    Across {selectedTeam.tournamentName}.
                  </p>
                </div>

              </div>
            )}

            {/* Substitutes / extra roster (players beyond the first 5) — listed,
                not tiled, and tucked behind a "View more" toggle. */}
            {selectedTeam.players.length > 5 && (
              <div className="arena-roster-extra">
                <button
                  type="button"
                  className="arena-roster-extra__toggle"
                  onClick={() => setShowAllRoster(v => !v)}
                >
                  {showAllRoster
                    ? <>Hide additional players <ChevronUp className="w-4 h-4" /></>
                    : <>View all {selectedTeam.players.length} players <ChevronDown className="w-4 h-4" /></>}
                </button>
                {showAllRoster && (
                  <ul className="arena-roster-extra__list">
                    {rosterPlayers.slice(5).map(p => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => goToPlayer(p.id)}
                          className="arena-roster-extra__row"
                        >
                          <span className="arena-roster-extra__avatar">
                            {p.photo
                              ? <img src={p.photo} alt={p.name} />
                              : <User className="w-4 h-4 text-gray-600" />}
                          </span>
                          <span className="arena-roster-extra__name">{p.name}</span>
                          {p.role && <span className="arena-roster-extra__role">{p.role}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Analytics — Player Performance Index */}
            {selectedTeam.players.length > 0 && (
              <section className="mt-20">
                <div className="arena-roster-analytics__head">
                  <div>
                    <p className="arena-page-hero__eyebrow" style={{ margin: '0 0 0.5rem' }}>Analytics</p>
                    <h2 className="arena-page-hero__title" style={{ fontSize: '1.875rem', margin: 0 }}>
                      Player Performance Index
                    </h2>
                  </div>
                  <p className="text-gray-500 text-sm hidden md:block">Aggregated from applied match stats</p>
                </div>

                <div className="arena-roster-analytics__list">
                  {(showAllAnalytics ? selectedTeam.players : selectedTeam.players.slice(0, 5)).map((player, i) => {
                    const s = statsFor(player);
                    const has = s && s.mapsPlayed > 0;
                    return (
                      <button
                        key={player.id}
                        onClick={() => goToPlayer(player.id)}
                        className="arena-roster-analytics__row"
                      >
                        <span className="arena-roster-analytics__index">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="arena-roster-analytics__player">
                          <p className="arena-roster-analytics__name">{player.name}</p>
                          {player.role && (
                            <p className="arena-roster-analytics__role">{player.role}</p>
                          )}
                        </div>
                        <div className="arena-roster-analytics__stat">
                          <p className="arena-roster-analytics__stat-label">ACS</p>
                          <p className="arena-roster-analytics__stat-value">
                            {has ? Math.round(s.acs) : '—'}
                          </p>
                        </div>
                        <div className="arena-roster-analytics__stat">
                          <p className="arena-roster-analytics__stat-label">K/D</p>
                          <p className="arena-roster-analytics__stat-value">
                            {has ? s.kd.toFixed(2) : '—'}
                          </p>
                        </div>
                        <div className="arena-roster-analytics__stat">
                          <p className="arena-roster-analytics__stat-label">HS%</p>
                          <p className="arena-roster-analytics__stat-value">
                            {has ? `${Math.round(s.hsPercent)}%` : '—'}
                          </p>
                        </div>
                        <ChevronRight className="w-5 h-5 text-gray-600 arena-roster-analytics__chevron" />
                      </button>
                    );
                  })}
                </div>

                {selectedTeam.players.length > 5 && (
                  <button
                    type="button"
                    className="arena-roster-extra__toggle arena-roster-extra__toggle--center"
                    onClick={() => setShowAllAnalytics(v => !v)}
                  >
                    {showAllAnalytics
                      ? <>Show top 5 only <ChevronUp className="w-4 h-4" /></>
                      : <>View all {selectedTeam.players.length} players <ChevronDown className="w-4 h-4" /></>}
                  </button>
                )}
              </section>
            )}

            {/* Tournaments & Standings */}
            {tournamentRecords.length > 0 && (
              <section className="mt-20">
                <div className="arena-roster-analytics__head">
                  <div>
                    <p className="arena-page-hero__eyebrow" style={{ margin: '0 0 0.5rem' }}>Track Record</p>
                    <h2 className="arena-page-hero__title" style={{ fontSize: '1.875rem', margin: 0 }}>
                      Tournaments &amp; Standings
                    </h2>
                  </div>
                  <p className="text-gray-500 text-sm hidden md:block">
                    {tournamentRecords.length} event{tournamentRecords.length !== 1 ? 's' : ''}
                  </p>
                </div>

                <div className="arena-roster-analytics__list">
                  {tournamentRecords.map(rec => (
                    <TeamRecordRow key={rec.tournamentId} rec={rec} />
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
