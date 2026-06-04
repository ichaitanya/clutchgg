import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { useNavigate } from 'react-router-dom';
import type { AdminData } from './AdminPanel';
import type { Tournament, BracketMatch, MatchMapResult } from './TournamentCreation';
import { loadAdminData } from '../services/db';

type MatchStatus = 'live' | 'upcoming' | 'completed';

// A single match prepared for the schedule list.
interface ScheduleMatch {
  id: string;
  team1Name: string;
  team2Name: string;
  team1Logo?: string;
  team2Logo?: string;
  date?: string;
  time?: string;
  status: MatchStatus;
  format: 'bo1' | 'bo3' | 'bo5';
  score1: number; // map wins
  score2: number;
  winnerSide: 1 | 2 | null;
  tournamentName: string;
  stage: string;
  // Sort key: scheduled matches by their timestamp; unscheduled get Infinity so
  // they always trail the dated ones.
  sortTs: number;
}

// First two uppercase initials of a team name, for the logo fallback chip.
function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// Names that stand in for an undecided team slot (winner-of, TBD, empty, …).
function isTeamSlotName(name: string) {
  if (!name) return true;
  const n = name.trim();
  return (
    n === '' ||
    n === 'Select Team' ||
    n === 'TBD' ||
    n === 'LB TBD' ||
    n === 'WB Champion' ||
    n === 'LB Champion' ||
    n.startsWith('Team Slot') ||
    n.startsWith('Winner') ||
    n.startsWith('Loser')
  );
}

// Tally map wins for each side from a match's recorded maps.
function tallyMaps(maps: MatchMapResult[]): { w1: number; w2: number } {
  let w1 = 0;
  let w2 = 0;
  for (const m of maps) {
    if (m.team1Score > m.team2Score) w1++;
    else if (m.team2Score > m.team1Score) w2++;
  }
  return { w1, w2 };
}

// Has the series been decided by map results? In a BOn a team needs
// ceil(maxMaps/2) map wins. Also treats an all-maps-played lead as decided.
function isMatchDecidedByMaps(match: BracketMatch): boolean {
  const maps = match.maps ?? [];
  if (maps.length === 0) return false;
  const maxMaps = match.format === 'bo1' ? 1 : match.format === 'bo5' ? 5 : 3;
  const { w1, w2 } = tallyMaps(maps);
  const needed = Math.ceil(maxMaps / 2);
  if (w1 >= needed || w2 >= needed) return true;
  if (maps.length >= maxMaps && w1 !== w2) return true;
  return false;
}

// Date-based status: live within a 3h window, completed once 3h past.
function getDateStatus(date?: string, time?: string): MatchStatus {
  if (!date) return 'upcoming';
  try {
    const matchDateTime = new Date(`${date}T${time || '00:00'}`);
    const diffHours = (matchDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
    if (diffHours > -3 && diffHours < 3) return 'live';
    if (diffHours < -3) return 'completed';
    return 'upcoming';
  } catch {
    return 'upcoming';
  }
}

// Winner-aware status: a recorded winner or a map-decided result is completed
// regardless of the scheduled date; otherwise fall back to the date.
function getEffectiveStatus(match: BracketMatch): MatchStatus {
  if (match.winner || isMatchDecidedByMaps(match)) return 'completed';
  return getDateStatus(match.date, match.time);
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  live: 'Live',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

const FORMAT_LABEL: Record<'bo1' | 'bo3' | 'bo5', string> = {
  bo1: 'BO1',
  bo3: 'BO3',
  bo5: 'BO5',
};

// Friendly countdown for an upcoming match: "Today", "Tomorrow", "In 3 days",
// or "In 2 hours" when it's close. Returns null when there's no usable date.
function countdownLabel(date?: string, time?: string): string | null {
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

// Walk every bracket of a tournament and emit schedule entries for matches whose
// two teams are both decided. Stage labels mirror the tournament structure.
function collectTournamentMatches(t: Tournament): ScheduleMatch[] {
  const out: ScheduleMatch[] = [];

  // Resolve a team's logo from the roster, falling back to name match for slots
  // whose id wasn't carried onto the bracket match.
  const logoFor = (teamId: string, teamName: string): string | undefined => {
    const byId = t.teams.find(tm => tm.id === teamId);
    if (byId?.logo) return byId.logo;
    const norm = teamName.trim().toLowerCase();
    return t.teams.find(tm => tm.name.trim().toLowerCase() === norm)?.logo;
  };

  const push = (match: BracketMatch, stage: string) => {
    if (isTeamSlotName(match.team1Name) || isTeamSlotName(match.team2Name)) return;
    const format = (match.format ?? 'bo3') as 'bo1' | 'bo3' | 'bo5';
    const { w1, w2 } = tallyMaps(match.maps ?? []);
    const status = getEffectiveStatus(match);
    const winnerSide =
      match.winner === match.team1Id ? 1 : match.winner === match.team2Id ? 2 : null;
    const ts = match.date
      ? new Date(`${match.date}T${match.time || '00:00'}`).getTime()
      : Number.POSITIVE_INFINITY;
    out.push({
      id: match.id,
      team1Name: match.team1Name,
      team2Name: match.team2Name,
      team1Logo: logoFor(match.team1Id, match.team1Name),
      team2Logo: logoFor(match.team2Id, match.team2Name),
      date: match.date,
      time: match.time,
      status,
      format,
      score1: w1,
      score2: w2,
      winnerSide,
      tournamentName: t.name,
      stage,
      sortTs: Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts,
    });
  };

  // Single-stage bracket.
  if (t.generatedBracket) {
    t.generatedBracket.rounds.flat().forEach(m => push(m, 'Main Bracket'));
  }

  // Stage 1 — group stage uses per-group labels, otherwise a generic label.
  if (t.stage1Config?.format === 'groupstage' && t.stage1Bracket) {
    const groups = t.stage1Config.groups ?? [];
    t.stage1Bracket.rounds.flat().forEach(m => {
      const group = groups.find(g => m.id.includes(`gs_${g.id}_`));
      push(m, group?.name ?? 'Group Stage');
    });
  } else if (t.stage1Bracket) {
    t.stage1Bracket.rounds.flat().forEach(m => push(m, 'Stage 1'));
  }

  // Stage 2.
  if (t.stage2Bracket) {
    t.stage2Bracket.rounds.flat().forEach(m => push(m, 'Stage 2'));
  }

  return out;
}

// Order status groups: live first, then upcoming, then completed.
const STATUS_ORDER: MatchStatus[] = ['live', 'upcoming', 'completed'];

// Matches shown per page within a status tab.
const PAGE_SIZE = 15;

export function MatchesPage() {
  const navigate = useNavigate();
  const [adminData, setAdminData] = useState<AdminData | null>(null);

  useEffect(() => {
    loadAdminData().then(setAdminData).catch(() => {});
  }, []);

  // Flatten every tournament's decided matches into one schedule, then order it
  // by schedule (dated matches ascending, undecided-date matches last).
  const matches = useMemo<ScheduleMatch[]>(() => {
    if (!adminData) return [];
    const all = adminData.tournaments.flatMap(collectTournamentMatches);
    all.sort((a, b) => {
      if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
      // Stable-ish tie-break by tournament then stage.
      return (
        a.tournamentName.localeCompare(b.tournamentName) ||
        a.stage.localeCompare(b.stage)
      );
    });
    return all;
  }, [adminData]);

  // Bucket the ordered schedule by status. Each list keeps the schedule order.
  const byStatus = useMemo<Record<MatchStatus, ScheduleMatch[]>>(() => {
    return {
      live: matches.filter(m => m.status === 'live'),
      upcoming: matches.filter(m => m.status === 'upcoming'),
      completed: matches.filter(m => m.status === 'completed'),
    };
  }, [matches]);

  // Which status tabs to surface: live only when something is live; upcoming and
  // completed are always offered so the user can switch between them.
  const tabs = useMemo<MatchStatus[]>(
    () => STATUS_ORDER.filter(s => s === 'live' ? byStatus.live.length > 0 : true),
    [byStatus],
  );

  const [activeTab, setActiveTab] = useState<MatchStatus>('upcoming');
  const [page, setPage] = useState(1);

  // Keep the active tab valid once data arrives — prefer live, else upcoming,
  // else the first tab that actually has matches.
  useEffect(() => {
    if (matches.length === 0) return;
    if (byStatus[activeTab].length > 0) return;
    const next = byStatus.live.length > 0
      ? 'live'
      : byStatus.upcoming.length > 0
        ? 'upcoming'
        : byStatus.completed.length > 0
          ? 'completed'
          : 'upcoming';
    setActiveTab(next);
  }, [matches, byStatus, activeTab]);

  // Reset to the first page whenever the visible list changes.
  useEffect(() => { setPage(1); }, [activeTab]);

  const activeList = byStatus[activeTab];
  const totalPages = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = activeList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-page" style={{ paddingTop: '2.5rem', paddingBottom: '4rem' }}>
        {/* Editorial header */}
        <div style={{ textAlign: 'center', paddingTop: '0.5rem', paddingBottom: '1.75rem' }}>
          <h1 className="arena-page-hero__title" style={{ margin: 0 }}>Match Schedule</h1>
        </div>

        {matches.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 mb-2">No matches scheduled yet</p>
            <p className="text-gray-600 text-sm">
              Matches appear here once tournament brackets are generated and teams are set.
            </p>
          </div>
        ) : (
          <div>
            {/* Status tabs */}
            <div className="arena-match-tabs">
              {tabs.map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`arena-match-tab${activeTab === tab ? ' arena-match-tab--active' : ''}${tab === 'live' ? ' arena-match-tab--live' : ''}`}
                >
                  {tab === 'live' && activeTab === tab && <span className="arena-match-card__badge-dot" />}
                  {STATUS_LABEL[tab]}
                  <span className="arena-match-tab__count">{byStatus[tab].length}</span>
                </button>
              ))}
            </div>

            {activeList.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 text-sm">No {STATUS_LABEL[activeTab].toLowerCase()} matches.</p>
              </div>
            ) : (
              <>
                <div className="arena-match-list">
                  {pageItems.map(match => {
                    const decided = match.status === 'completed' && match.winnerSide !== null;
                    const scheduleText = match.date
                      ? `${new Date(`${match.date}T00:00`).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}${match.time ? ` · ${match.time}` : ''}`
                      : null;
                    const countdown = match.status === 'upcoming' ? countdownLabel(match.date, match.time) : null;

                    return (
                      <button
                        key={match.id}
                        type="button"
                        onClick={() => navigate(`/tournament-match/${match.id}`)}
                        className={`arena-match-card${
                          decided && match.winnerSide === 1
                            ? ' arena-match-card--win-left'
                            : decided && match.winnerSide === 2
                              ? ' arena-match-card--win-right'
                              : ''
                        }`}
                      >
                        <div className="arena-match-card__main">
                          <p className="arena-match-card__eyebrow">
                            {match.stage}{scheduleText ? ` · ${scheduleText}` : ''}
                          </p>

                          <div className="arena-match-card__teams">
                            <div className="arena-match-card__team arena-match-card__team--right">
                              <p
                                className={`arena-match-card__team-name${
                                  decided && match.winnerSide === 1 ? ' arena-match-card__team-name--winner' : ''
                                }`}
                              >
                                {match.team1Name}
                              </p>
                              <span className={`arena-match-card__logo${decided && match.winnerSide !== 1 ? ' arena-match-card__logo--dim' : ''}`}>
                                {match.team1Logo
                                  ? <img src={match.team1Logo} alt="" />
                                  : <span className="arena-match-card__logo-text">{teamInitials(match.team1Name)}</span>}
                              </span>
                            </div>

                            <div className="arena-match-card__center">
                              {match.status === 'completed' ? (
                                <>
                                  <span className="arena-match-card__score">
                                    <span className={decided && match.winnerSide === 1 ? 'arena-match-card__score-win' : ''}>{match.score1}</span>
                                    <span className="arena-match-card__score-sep">:</span>
                                    <span className={decided && match.winnerSide === 2 ? 'arena-match-card__score-win' : ''}>{match.score2}</span>
                                  </span>
                                  <span className="arena-match-card__format">
                                    {FORMAT_LABEL[match.format]}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="arena-match-card__vs-badge">VS</span>
                                  <span className="arena-match-card__format">
                                    {FORMAT_LABEL[match.format]}
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="arena-match-card__team arena-match-card__team--left">
                              <span className={`arena-match-card__logo${decided && match.winnerSide !== 2 ? ' arena-match-card__logo--dim' : ''}`}>
                                {match.team2Logo
                                  ? <img src={match.team2Logo} alt="" />
                                  : <span className="arena-match-card__logo-text">{teamInitials(match.team2Name)}</span>}
                              </span>
                              <p
                                className={`arena-match-card__team-name${
                                  decided && match.winnerSide === 2 ? ' arena-match-card__team-name--winner' : ''
                                }`}
                              >
                                {match.team2Name}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="arena-match-card__meta">
                          <p className="arena-match-card__tournament">{match.tournamentName}</p>
                          <p className="arena-match-card__stage">{match.stage}</p>
                          <span
                            className={`arena-match-card__badge arena-match-card__badge--${match.status}`}
                          >
                            {match.status === 'live' && (
                              <span className={`arena-match-card__badge-dot${match.date ? ' arena-match-card__badge-dot--pulse' : ''}`} />
                            )}
                            {match.status === 'upcoming' && countdown ? countdown : STATUS_LABEL[match.status]}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="arena-match-pager">
                    <button
                      type="button"
                      className="arena-match-pager__nav"
                      disabled={safePage === 1}
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPage(n)}
                        className={`arena-match-pager__page${n === safePage ? ' arena-match-pager__page--active' : ''}`}
                      >
                        {n}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="arena-match-pager__nav"
                      disabled={safePage === totalPages}
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
