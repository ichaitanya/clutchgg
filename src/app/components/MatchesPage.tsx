import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Filter } from 'lucide-react';
import { mapImageUrl } from '../utils/valorantAssets';
import { bracketRoundLabel } from '../utils/bracketRounds';
import { Header } from './Header';
import { Footer } from './Footer';
import { LoadingState } from './LoadingState';
import { useNavigate } from 'react-router-dom';
import type { AdminData } from './AdminPanel';
import type { Tournament, BracketMatch, MatchMapResult } from './TournamentCreation';
import { loadAdminData, loadWithRetryPolled } from '../services/db';

type MatchStatus = 'live' | 'upcoming' | 'completed';

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
  score1: number;
  score2: number;
  winnerSide: 1 | 2 | null;
  tournamentName: string;
  tournamentType?: string; // 'online' | 'lan'
  stage: string;
  sortTs: number;
  maps: MatchMapResult[]; // per-map scores for the inline expansion
}

function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function isTeamSlotName(name: string) {
  if (!name) return true;
  const n = name.trim();
  return (
    n === '' || n === 'Select Team' || n === 'TBD' || n === 'LB TBD' ||
    n === 'WB Champion' || n === 'LB Champion' ||
    n.startsWith('Team Slot') || n.startsWith('Winner') || n.startsWith('Loser')
  );
}

function tallyMaps(maps: MatchMapResult[]): { w1: number; w2: number } {
  let w1 = 0, w2 = 0;
  for (const m of maps) {
    if (m.team1Score > m.team2Score) w1++;
    else if (m.team2Score > m.team1Score) w2++;
  }
  return { w1, w2 };
}

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

function getDateStatus(date?: string, time?: string): MatchStatus {
  if (!date) return 'upcoming';
  try {
    const matchDateTime = new Date(`${date}T${time || '00:00'}`);
    const diffHours = (matchDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
    if (diffHours > -3 && diffHours < 3) return 'live';
    if (diffHours < -3) return 'completed';
    return 'upcoming';
  } catch { return 'upcoming'; }
}

function getEffectiveStatus(match: BracketMatch): MatchStatus {
  if (match.winner || isMatchDecidedByMaps(match)) return 'completed';
  return getDateStatus(match.date, match.time);
}

const STATUS_LABEL: Record<MatchStatus, string> = { live: 'Live', upcoming: 'Upcoming', completed: 'Completed' };
const FORMAT_LABEL: Record<'bo1' | 'bo3' | 'bo5', string> = { bo1: 'BO1', bo3: 'BO3', bo5: 'BO5' };

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
  return `In ${Math.round(days / 30)} month${Math.round(days / 30) !== 1 ? 's' : ''}`;
}

function collectTournamentMatches(t: Tournament): ScheduleMatch[] {
  const out: ScheduleMatch[] = [];
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
    const winnerSide: 1 | 2 | null = match.winner === match.team1Id ? 1
      : match.winner === match.team2Id ? 2
      : status === 'completed' && w1 > w2 ? 1
      : status === 'completed' && w2 > w1 ? 2
      : null;
    const ts = match.date ? new Date(`${match.date}T${match.time || '00:00'}`).getTime() : Number.POSITIVE_INFINITY;
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
      // Event type is 'online' | 'offline' | 'hybrid' (offline = LAN). The LAN
      // filter should match anything with a physical/LAN component, so treat
      // offline and hybrid (and any legacy "lan" string) as 'lan'.
      tournamentType: (() => {
        const ty = t.event?.type?.toLowerCase() ?? '';
        return (ty === 'offline' || ty === 'hybrid' || ty.includes('lan')) ? 'lan' : 'online';
      })(),
      stage,
      sortTs: Number.isNaN(ts) ? Number.POSITIVE_INFINITY : ts,
      maps: match.maps ?? [],
    });
  };

  // Stage label = the match's actual round in the bracket ("WB Round 1",
  // "LB Quarter Finals", "Grand Final"); fall back to the generic stage name
  // when the bracket shape doesn't yield one (round robin / groups).
  if (t.generatedBracket) {
    t.generatedBracket.rounds.flat().forEach(m =>
      push(m, bracketRoundLabel(t.generatedBracket, m) ?? 'Main Bracket'));
  }
  if (t.stage1Config?.format === 'groupstage' && t.stage1Bracket) {
    const groups = t.stage1Config.groups ?? [];
    t.stage1Bracket.rounds.flat().forEach(m => {
      const group = groups.find(g => m.id.includes(`gs_${g.id}_`));
      push(m, group?.name ?? 'Group Stage');
    });
  } else if (t.stage1Bracket) {
    t.stage1Bracket.rounds.flat().forEach(m =>
      push(m, bracketRoundLabel(t.stage1Bracket, m) ?? 'Stage 1'));
  }
  if (t.stage2Bracket) {
    t.stage2Bracket.rounds.flat().forEach(m =>
      push(m, bracketRoundLabel(t.stage2Bracket, m) ?? 'Stage 2'));
  }
  return out;
}

const STATUS_ORDER: MatchStatus[] = ['live', 'upcoming', 'completed'];
const PAGE_SIZE = 15;

// ── Mini Calendar ─────────────────────────────────────────────────────────────
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function MiniCalendar({ matchDates, selectedDate, onSelect }: {
  matchDates: Set<string>;
  selectedDate: string | null;
  onSelect: (d: string | null) => void;
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const firstDay = new Date(year, month, 1);
  // Monday-based: Sunday = 6, Monday = 0
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const toKey = (d: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <div className="matches-calendar">
      <div className="matches-calendar__nav">
        <button onClick={prevMonth} className="matches-calendar__nav-btn"><ChevronLeft className="w-3.5 h-3.5" /></button>
        <span className="matches-calendar__month">{MONTHS[month]} {year}</span>
        <button onClick={nextMonth} className="matches-calendar__nav-btn"><ChevronRight className="w-3.5 h-3.5" /></button>
      </div>
      <div className="matches-calendar__grid">
        {DAYS.map(d => <span key={d} className="matches-calendar__day-label">{d}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={`e-${i}`} />;
          const key = toKey(day);
          const hasMatch = matchDates.has(key);
          const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
          const isSelected = selectedDate === key;
          return (
            <button
              key={key}
              onClick={() => onSelect(isSelected ? null : key)}
              className={[
                'matches-calendar__day',
                isToday ? 'matches-calendar__day--today' : '',
                hasMatch ? 'matches-calendar__day--has-match' : '',
                isSelected ? 'matches-calendar__day--selected' : '',
              ].filter(Boolean).join(' ')}
            >
              {day}
              {hasMatch && !isSelected && <span className="matches-calendar__dot" />}
            </button>
          );
        })}
      </div>
      {selectedDate && (
        <button onClick={() => onSelect(null)} className="matches-calendar__clear">
          Clear date filter
        </button>
      )}
    </div>
  );
}

// ── Filters sidebar ───────────────────────────────────────────────────────────
function FiltersSidebar({ matches, filterType, filterTournament, selectedDate, onType, onTournament, onDate }: {
  matches: ScheduleMatch[];
  filterType: string;
  filterTournament: string;
  selectedDate: string | null;
  onType: (v: string) => void;
  onTournament: (v: string) => void;
  onDate: (v: string | null) => void;
}) {
  const tournaments = useMemo(() => [...new Set(matches.map(m => m.tournamentName))].sort(), [matches]);
  const matchDates = useMemo(() => new Set(matches.map(m => m.date).filter(Boolean) as string[]), [matches]);

  return (
    <aside className="matches-sidebar">
      {/* Calendar */}
      <div className="matches-sidebar__section">
        <p className="matches-sidebar__heading">Calendar</p>
        <MiniCalendar matchDates={matchDates} selectedDate={selectedDate} onSelect={onDate} />
      </div>

      {/* Match Type */}
      <div className="matches-sidebar__section">
        <p className="matches-sidebar__heading"><Filter className="w-3 h-3" /> Match Filters</p>
        <div className="matches-sidebar__group">
          <p className="matches-sidebar__label">Type</p>
          {['all', 'online', 'lan'].map(v => (
            <button
              key={v}
              onClick={() => onType(v)}
              className={`matches-filter-chip${filterType === v ? ' matches-filter-chip--active' : ''}`}
            >
              {v === 'all' ? 'All' : v === 'online' ? '🌐 Online' : '🏟️ LAN'}
            </button>
          ))}
        </div>
        <div className="matches-sidebar__group">
          <p className="matches-sidebar__label">Tournament</p>
          <button
            onClick={() => onTournament('all')}
            className={`matches-filter-chip${filterTournament === 'all' ? ' matches-filter-chip--active' : ''}`}
          >
            All Tournaments
          </button>
          {tournaments.map(t => (
            <button
              key={t}
              onClick={() => onTournament(t)}
              className={`matches-filter-chip${filterTournament === t ? ' matches-filter-chip--active' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function MatchesPage() {
  const navigate = useNavigate();
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [filterType, setFilterType] = useState('all');
  const [filterTournament, setFilterTournament] = useState('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // One completed match at a time can be expanded to show per-map scores.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Initial retrying load + background polling so live/upcoming match states
  // refresh on an open tab without a manual reload.
  useEffect(() => loadWithRetryPolled(loadAdminData, setAdminData), []);

  const allMatches = useMemo<ScheduleMatch[]>(() => {
    if (!adminData) return [];
    const all = adminData.tournaments.flatMap(collectTournamentMatches);
    all.sort((a, b) => {
      if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
      return a.tournamentName.localeCompare(b.tournamentName) || a.stage.localeCompare(b.stage);
    });
    return all;
  }, [adminData]);

  const matches = useMemo(() => {
    return allMatches.filter(m => {
      if (filterType !== 'all' && m.tournamentType !== filterType) return false;
      if (filterTournament !== 'all' && m.tournamentName !== filterTournament) return false;
      if (selectedDate && m.date !== selectedDate) return false;
      return true;
    });
  }, [allMatches, filterType, filterTournament, selectedDate]);

  const byStatus = useMemo<Record<MatchStatus, ScheduleMatch[]>>(() => ({
    live: matches.filter(m => m.status === 'live'),
    upcoming: matches.filter(m => m.status === 'upcoming'),
    // Completed shows most-recently-played first (descending by scheduled time);
    // undated completed matches sort to the bottom. Upcoming/live stay ascending.
    completed: matches.filter(m => m.status === 'completed').slice().sort((a, b) => {
      const ta = Number.isFinite(a.sortTs) ? a.sortTs : -Infinity;
      const tb = Number.isFinite(b.sortTs) ? b.sortTs : -Infinity;
      if (tb !== ta) return tb - ta;
      return a.tournamentName.localeCompare(b.tournamentName) || a.stage.localeCompare(b.stage);
    }),
  }), [matches]);

  const tabs = useMemo<MatchStatus[]>(
    () => STATUS_ORDER.filter(s => s === 'live' ? byStatus.live.length > 0 : true),
    [byStatus],
  );

  const [activeTab, setActiveTab] = useState<MatchStatus>('upcoming');
  const [page, setPage] = useState(1);
  // Once the user clicks a tab, we respect their choice and never auto-switch —
  // even if their filters leave that tab empty (we show "No X matches" instead).
  const [userPickedTab, setUserPickedTab] = useState(false);

  // Auto-pick a sensible default tab ONCE, on the first real data load (live →
  // upcoming → completed). We key this off the UNFILTERED match set so it settles
  // a default the moment data arrives and is permanently done — a later filter
  // change must never re-trigger it and yank the user to another tab. After the
  // user touches the tabs it also stops interfering.
  const didInitTab = useRef(false);
  useEffect(() => {
    if (userPickedTab || didInitTab.current) return;
    if (allMatches.length === 0) return;
    didInitTab.current = true;
    const live = allMatches.filter(m => m.status === 'live').length;
    const upcoming = allMatches.filter(m => m.status === 'upcoming').length;
    const next = live > 0 ? 'live' : upcoming > 0 ? 'upcoming' : 'completed';
    setActiveTab(next);
  }, [allMatches, userPickedTab]);

  const pickTab = (tab: MatchStatus) => { setUserPickedTab(true); setActiveTab(tab); };

  useEffect(() => { setPage(1); setExpandedId(null); }, [activeTab, filterType, filterTournament, selectedDate]);

  // The `live` tab is the only one conditionally hidden (rendered only while
  // live matches exist). If it disappears out from under the user — the last
  // live match ended, or a filter removed every live match — they'd be stranded
  // on a tab that's no longer in the list. Fall back to Upcoming (always
  // present). This is the ONLY automatic tab switch after init: Upcoming and
  // Completed are always in `tabs`, so a filter that merely empties one of them
  // never moves the user — that tab just shows its own "No … matches" state.
  useEffect(() => {
    if (activeTab === 'live' && !tabs.includes('live')) {
      setActiveTab('upcoming');
    }
  }, [tabs, activeTab]);

  const activeList = byStatus[activeTab];
  const totalPages = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = activeList.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const activeFilterCount = (filterType !== 'all' ? 1 : 0) + (filterTournament !== 'all' ? 1 : 0) + (selectedDate ? 1 : 0);

  // First fetch still in flight — show a loader rather than the "no matches"
  // empty state, which would otherwise read as "nothing is scheduled".
  if (adminData === null) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <LoadingState label="Loading matches…" />
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-page" style={{ paddingTop: '2rem', paddingBottom: '4rem' }}>
        <div style={{ textAlign: 'center', paddingBottom: '1.75rem' }}>
          <h1 className="arena-page-hero__title" style={{ margin: 0 }}>Match Schedule</h1>
        </div>

        {/* Mobile filter toggle */}
        <button
          className="matches-mobile-filter-btn"
          onClick={() => setSidebarOpen(o => !o)}
        >
          <Filter className="w-4 h-4" />
          Filters{activeFilterCount > 0 && <span className="matches-mobile-filter-btn__count">{activeFilterCount}</span>}
        </button>

        <div className="matches-layout">
          {/* Sidebar — hidden on mobile unless toggled */}
          <div className={`matches-sidebar-wrap${sidebarOpen ? ' matches-sidebar-wrap--open' : ''}`}>
            <FiltersSidebar
              matches={allMatches}
              filterType={filterType}
              filterTournament={filterTournament}
              selectedDate={selectedDate}
              onType={v => { setFilterType(v); setSidebarOpen(false); }}
              onTournament={v => { setFilterTournament(v); setSidebarOpen(false); }}
              onDate={v => { setSelectedDate(v); setSidebarOpen(false); }}
            />
          </div>

          {/* Main content */}
          <div className="matches-main">
            {allMatches.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400 mb-2">No matches scheduled yet</p>
                <p className="text-gray-600 text-sm">Matches appear here once tournament brackets are generated.</p>
              </div>
            ) : (
              <>
                {/* Active filters strip */}
                {activeFilterCount > 0 && (
                  <div className="matches-active-filters">
                    {selectedDate && (
                      <span className="matches-active-tag">
                        📅 {new Date(`${selectedDate}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        <button onClick={() => setSelectedDate(null)}>×</button>
                      </span>
                    )}
                    {filterType !== 'all' && (
                      <span className="matches-active-tag">
                        {filterType === 'lan' ? '🏟️ LAN' : '🌐 Online'}
                        <button onClick={() => setFilterType('all')}>×</button>
                      </span>
                    )}
                    {filterTournament !== 'all' && (
                      <span className="matches-active-tag">
                        {filterTournament}
                        <button onClick={() => setFilterTournament('all')}>×</button>
                      </span>
                    )}
                    <button className="matches-active-filters__clear" onClick={() => { setFilterType('all'); setFilterTournament('all'); setSelectedDate(null); }}>
                      Clear all
                    </button>
                  </div>
                )}

                {/* Status tabs */}
                <div className="arena-match-tabs">
                  {tabs.map(tab => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => pickTab(tab)}
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
                    <p className="text-gray-500 text-sm">No {STATUS_LABEL[activeTab].toLowerCase()} matches{activeFilterCount > 0 ? ' for selected filters' : ''}.</p>
                  </div>
                ) : (
                  <>
                    <div className="arena-match-list">
                      {pageItems.map(match => {
                        const decided = match.status === 'completed' && match.winnerSide !== null;
                        const scheduleText = match.date
                          ? `${new Date(`${match.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${match.time ? ` · ${match.time}` : ''}`
                          : null;
                        const countdown = match.status === 'upcoming' ? countdownLabel(match.date, match.time) : null;
                        const playedMaps = match.status === 'completed'
                          ? match.maps.filter(m => m.team1Score > 0 || m.team2Score > 0)
                          : [];
                        const expandable = playedMaps.length > 0;
                        const expanded = expandedId === match.id;

                        return (
                          <div key={match.id} className="arena-tp-matchwrap">
                          <button
                            type="button"
                            onClick={() => navigate(`/tournament-match/${match.id}`)}
                            className={`arena-match-card${decided && match.winnerSide === 1 ? ' arena-match-card--win-left' : decided && match.winnerSide === 2 ? ' arena-match-card--win-right' : ''}`}
                          >
                            <div className="arena-match-card__main">
                              <p className="arena-match-card__eyebrow">
                                {match.stage}{scheduleText ? ` · ${scheduleText}` : ''}
                              </p>
                              <div className="arena-match-card__teams">
                                <div className="arena-match-card__team arena-match-card__team--right">
                                  <p className={`arena-match-card__team-name${decided && match.winnerSide === 1 ? ' arena-match-card__team-name--winner' : ''}`}>
                                    {match.team1Name}
                                  </p>
                                  <span className={`arena-match-card__logo${decided && match.winnerSide !== 1 ? ' arena-match-card__logo--dim' : ''}`}>
                                    {match.team1Logo ? <img src={match.team1Logo} alt="" /> : <span className="arena-match-card__logo-text">{teamInitials(match.team1Name)}</span>}
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
                                      <span className="arena-match-card__format">{FORMAT_LABEL[match.format]}</span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="arena-match-card__vs-badge">VS</span>
                                      <span className="arena-match-card__format">{FORMAT_LABEL[match.format]}</span>
                                    </>
                                  )}
                                </div>
                                <div className="arena-match-card__team arena-match-card__team--left">
                                  <span className={`arena-match-card__logo${decided && match.winnerSide !== 2 ? ' arena-match-card__logo--dim' : ''}`}>
                                    {match.team2Logo ? <img src={match.team2Logo} alt="" /> : <span className="arena-match-card__logo-text">{teamInitials(match.team2Name)}</span>}
                                  </span>
                                  <p className={`arena-match-card__team-name${decided && match.winnerSide === 2 ? ' arena-match-card__team-name--winner' : ''}`}>
                                    {match.team2Name}
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="arena-match-card__meta">
                              <p className="arena-match-card__tournament">{match.tournamentName}</p>
                              {/* Stage lives in the left eyebrow — repeating it here only added height. */}
                              <span className="arena-match-card__badge-row">
                                <span className={`arena-match-card__badge arena-match-card__badge--${match.status}`}>
                                  {match.status === 'live' && <span className={`arena-match-card__badge-dot${match.date ? ' arena-match-card__badge-dot--pulse' : ''}`} />}
                                  {match.status === 'upcoming' && countdown ? countdown : STATUS_LABEL[match.status]}
                                </span>
                                {expandable && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className={`arena-tp-matchrow__expand${expanded ? ' arena-tp-matchrow__expand--open' : ''}`}
                                    title={expanded ? 'Hide map scores' : 'Show map scores'}
                                    onClick={e => { e.stopPropagation(); setExpandedId(expanded ? null : match.id); }}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setExpandedId(expanded ? null : match.id);
                                      }
                                    }}
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </span>
                                )}
                              </span>
                            </div>
                          </button>
                          {expandable && expanded && (
                            <div className="arena-tp-mapscores">
                              {playedMaps.map((map, mi) => {
                                const m1 = map.team1Score > map.team2Score;
                                const m2 = map.team2Score > map.team1Score;
                                const splash = mapImageUrl(map.mapName);
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
                                    <span className="arena-tp-mapscores__map">{map.mapName || `Map ${mi + 1}`}</span>
                                    <span className="arena-tp-mapscores__score">
                                      <span className={m1 ? 'arena-tp-mapscores__win' : ''}>{map.team1Score}</span>
                                      <span className="arena-tp-mapscores__sep">–</span>
                                      <span className={m2 ? 'arena-tp-mapscores__win' : ''}>{map.team2Score}</span>
                                    </span>
                                    <span className="arena-tp-mapscores__taker">
                                      {m1 ? match.team1Name : m2 ? match.team2Name : 'Tied'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          </div>
                        );
                      })}
                    </div>

                    {totalPages > 1 && (
                      <div className="arena-match-pager">
                        <button type="button" className="arena-match-pager__nav" disabled={safePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
                          <button key={n} type="button" onClick={() => setPage(n)} className={`arena-match-pager__page${n === safePage ? ' arena-match-pager__page--active' : ''}`}>
                            {n}
                          </button>
                        ))}
                        <button type="button" className="arena-match-pager__nav" disabled={safePage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
