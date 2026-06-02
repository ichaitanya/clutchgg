import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft, Trophy, Users, Calendar, MapPin, DollarSign, Newspaper, Clock,
} from 'lucide-react';
import { Header } from './Header';
import type { Tournament, BracketGenerated, BracketMatch } from './TournamentCreation';
import type { NewsItem } from './AdminPanel';
import { getTournaments, getNews } from '../services/db';
import { getStageOptions } from './StatsPage';
import { BracketDisplay } from './BracketDisplay';
import { deriveTournamentStatus } from '../utils/tournamentStatus';

type TabKey = 'overview' | 'matches' | 'bracket' | 'teams' | 'news';

const PLACE_COLORS = ['#4ade80', '#60a5fa', '#f59e0b'];

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function getMatchStatus(date?: string, time?: string): 'upcoming' | 'live' | 'completed' {
  if (!date) return 'upcoming';
  try {
    const dt = new Date(`${date}T${time || '00:00'}`);
    const diffH = (dt.getTime() - Date.now()) / 36e5;
    if (diffH > -3 && diffH < 3) return 'live';
    if (diffH < -3) return 'completed';
    return 'upcoming';
  } catch {
    return 'upcoming';
  }
}

function isMatchDecidedByMaps(match: BracketMatch): boolean {
  const maps = match.maps ?? [];
  if (maps.length === 0) return false;
  const maxMaps = match.format === 'bo1' ? 1 : match.format === 'bo5' ? 5 : 3;
  let w1 = 0, w2 = 0;
  for (const m of maps) {
    if (m.team1Score > m.team2Score) w1++;
    else if (m.team2Score > m.team1Score) w2++;
  }
  const needed = Math.ceil(maxMaps / 2);
  if (w1 >= needed || w2 >= needed) return true;
  if (maps.length >= maxMaps && w1 !== w2) return true;
  return false;
}

function effectiveStatus(m: BracketMatch): 'upcoming' | 'live' | 'completed' {
  if (m.winner || isMatchDecidedByMaps(m)) return 'completed';
  return getMatchStatus(m.date, m.time);
}

// A bracket match isn't a real, listable match until both slots are real teams.
function isTeamSlotName(name: string) {
  return !name || name === 'Select Team' || name.startsWith('Team Slot') || name === 'TBD' ||
    name.startsWith('Winner') || name.startsWith('Loser') ||
    name === 'LB TBD' || name === 'WB Champion' || name === 'LB Champion';
}

export function TournamentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('bracket');

  useEffect(() => {
    Promise.all([getTournaments(), getNews()])
      .then(([ts, ns]) => { setTournaments(ts); setNews(ns); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tournament = useMemo(() => tournaments.find(t => t.id === id) || null, [tournaments, id]);
  const stages = useMemo(() => (tournament ? getStageOptions(tournament) : []), [tournament]);

  // All listable matches (both teams real), tagged with stage + status.
  const matches = useMemo(() => {
    const out: { match: BracketMatch; stage: string; status: 'upcoming' | 'live' | 'completed' }[] = [];
    for (const stage of stages) {
      for (const bracket of stage.brackets) {
        for (const m of bracket.rounds.flat()) {
          if (isTeamSlotName(m.team1Name) || isTeamSlotName(m.team2Name)) continue;
          out.push({ match: m, stage: stage.label, status: effectiveStatus(m) });
        }
      }
    }
    return out;
  }, [stages]);

  const tournamentNews = useMemo(
    () => news.filter(n => n.visible && n.tournamentId === id),
    [news, id],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <div className="flex items-center justify-center py-32">
          <div className="w-6 h-6 border-2 border-[#ff4655] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen bg-[#0d0f16]">
        <Header />
        <main className="max-w-5xl mx-auto px-4 py-16 text-center">
          <Trophy className="w-12 h-12 mx-auto text-gray-600 mb-4" />
          <p className="text-gray-400 mb-4">Tournament not found</p>
          <button onClick={() => navigate('/matches')} className="text-[#ff4655] text-sm hover:underline">
            Back to Matches
          </button>
        </main>
      </div>
    );
  }

  const ev = tournament.event;
  const prizePool = ev?.prizePool;
  const prizePlaces = (prizePool?.places ?? []).slice().sort((a, b) => a.position - b.position);
  const hasPrizePool = !!prizePool && (prizePlaces.length > 0 || !!prizePool.total);

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'matches', label: 'Matches', count: matches.length },
    { key: 'bracket', label: 'Bracket' },
    { key: 'teams', label: 'Teams', count: tournament.teams.length },
    { key: 'news', label: 'News', count: tournamentNews.length },
  ];

  return (
    <div className="min-h-screen bg-[#0d0f16] pb-16">
      <Header />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Back */}
        <button
          onClick={() => navigate('/matches')}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-5"
        >
          <ChevronLeft className="w-5 h-5" />
          <span className="text-sm">Back to Matches</span>
        </button>

        {/* Event header */}
        <div className="bg-gradient-to-r from-[#ff4655]/15 to-[#ff4655]/0 border border-[#2a2d3a] rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-[#ff4655]/15 flex items-center justify-center flex-shrink-0">
              <Trophy className="w-7 h-7 text-[#ff4655]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-2xl sm:text-3xl">{tournament.name}</h1>
              {tournament.overview && <p className="text-gray-400 text-sm mt-1">{tournament.overview}</p>}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3 text-sm">
                {ev?.startDate && (
                  <span className="flex items-center gap-1.5 text-gray-300">
                    <Calendar className="w-4 h-4 text-gray-500" />
                    {new Date(ev.startDate).toLocaleDateString()}
                  </span>
                )}
                {ev?.location && (
                  <span className="flex items-center gap-1.5 text-gray-300">
                    <MapPin className="w-4 h-4 text-gray-500" />
                    {ev.location}
                  </span>
                )}
                {ev?.type && (
                  <span className="text-gray-300 capitalize flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#4ade80]" /> {ev.type}
                  </span>
                )}
                {prizePool?.total && (
                  <span className="flex items-center gap-1.5 text-[#4ade80] font-semibold">
                    <DollarSign className="w-4 h-4" />
                    {prizePool.total}
                  </span>
                )}
                <span className="text-[#ff4655] capitalize font-semibold">{deriveTournamentStatus(tournament)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap items-center gap-1 mt-5 border-b border-[#2a2d3a]">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-[#ff4655] text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
              {t.count !== undefined && <span className="ml-1.5 text-xs text-gray-500">{t.count}</span>}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === 'overview' && (
            <Overview
              tournament={tournament}
              hasPrizePool={hasPrizePool}
              prizePool={prizePool}
              prizePlaces={prizePlaces}
              recentMatches={matches.filter(m => m.status === 'completed').slice(-5).reverse()}
              upcomingMatches={matches.filter(m => m.status !== 'completed').slice(0, 5)}
              onMatch={mid => navigate(`/tournament-match/${mid}`)}
            />
          )}

          {tab === 'matches' && (
            <MatchesList matches={matches} onMatch={mid => navigate(`/tournament-match/${mid}`)} />
          )}

          {tab === 'bracket' && (
            <BracketTab tournament={tournament} stages={stages} />
          )}

          {tab === 'teams' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tournament.teams.map(team => (
                <Link
                  key={team.id}
                  to={`/teams/${team.id}`}
                  className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-4 hover:border-[#ff4655]/50 transition-colors group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    {team.logo ? (
                      <img src={team.logo} alt={team.name} className="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[#ff4655]/15 flex items-center justify-center text-[#ff4655] font-bold text-sm">
                        {team.name.substring(0, 2).toUpperCase()}
                      </div>
                    )}
                    <h3 className="text-white font-semibold text-sm group-hover:text-[#ff4655] transition-colors truncate">{team.name}</h3>
                  </div>
                  <div className="space-y-1">
                    {team.players.slice(0, 5).map(p => (
                      <Link
                        key={p.id}
                        to={`/player/${tournament.id}/${p.id}`}
                        onClick={e => e.stopPropagation()}
                        className="block text-gray-400 text-xs hover:text-[#ff4655] transition-colors truncate"
                      >
                        {p.name || 'TBD'}
                      </Link>
                    ))}
                    {team.players.length === 0 && <p className="text-gray-600 text-xs">No players listed</p>}
                  </div>
                </Link>
              ))}
              {tournament.teams.length === 0 && (
                <p className="text-gray-500 text-sm col-span-full">No teams added.</p>
              )}
            </div>
          )}

          {tab === 'news' && (
            <div className="space-y-3">
              {tournamentNews.length === 0 ? (
                <div className="text-center py-12 bg-[#151821] border border-[#2a2d3a] rounded-xl">
                  <Newspaper className="w-10 h-10 mx-auto text-gray-600 mb-3" />
                  <p className="text-gray-400 text-sm">No news linked to this tournament yet</p>
                </div>
              ) : (
                tournamentNews.map(n => (
                  <Link
                    key={n.id}
                    to={n.link ? n.link : `/news/${n.id}`}
                    target={n.link ? '_blank' : undefined}
                    className="flex items-center gap-4 bg-[#151821] border border-[#2a2d3a] rounded-xl px-4 py-3 hover:border-[#ff4655]/50 transition-colors group"
                  >
                    {n.imageUrl ? (
                      <img src={n.imageUrl} alt={n.title} className="w-20 h-14 object-cover rounded-lg flex-shrink-0 border border-[#2a2d3a]" />
                    ) : (
                      <div className="w-20 h-14 rounded-lg flex-shrink-0 bg-[#0d0f16] flex items-center justify-center">
                        <Newspaper className="w-5 h-5 text-gray-600" />
                      </div>
                    )}
                    <div className="min-w-0">
                      {n.category && <span className="text-[10px] text-[#ff4655] uppercase tracking-wider font-semibold">{n.category}</span>}
                      <h3 className="text-white font-semibold text-sm group-hover:text-[#ff4655] transition-colors line-clamp-2">{n.title}</h3>
                      {n.timeAgo && <span className="text-gray-500 text-xs flex items-center gap-1 mt-0.5"><Clock className="w-3 h-3" />{n.timeAgo}</span>}
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function Overview({ tournament, hasPrizePool, prizePool, prizePlaces, recentMatches, upcomingMatches, onMatch }: {
  tournament: Tournament;
  hasPrizePool: boolean;
  prizePool?: { total?: string };
  prizePlaces: { position: number; prize: string }[];
  recentMatches: { match: BracketMatch; stage: string; status: string }[];
  upcomingMatches: { match: BracketMatch; stage: string; status: string }[];
  onMatch: (id: string) => void;
}) {
  const ev = tournament.event;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Team slots */}
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-[#ff4655]" /> Team Slots
          </h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-gray-500 text-xs mb-1">Total</p>
              <p className="text-white font-bold text-lg">{ev?.maxTeams || tournament.teams.length}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-1">Registered</p>
              <p className="text-[#ff4655] font-bold text-lg">{tournament.teams.length}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs mb-1">Available</p>
              <p className="text-[#60a5fa] font-bold text-lg">{Math.max(0, (ev?.maxTeams || tournament.teams.length) - tournament.teams.length)}</p>
            </div>
          </div>
        </div>

        {/* Upcoming + recent */}
        {(upcomingMatches.length > 0 || recentMatches.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MatchMini title="Upcoming" items={upcomingMatches} onMatch={onMatch} />
            <MatchMini title="Recent Results" items={recentMatches} onMatch={onMatch} />
          </div>
        )}
      </div>

      {/* Prize pool */}
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-5 h-fit">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-[#ff4655]" /> Prize Pool
        </h3>
        {hasPrizePool ? (
          <div className="space-y-2">
            {prizePool?.total && (
              <div className="flex items-center justify-between py-2 border-b border-[#2a2d3a]">
                <span className="text-gray-400 text-sm">Total</span>
                <span className="text-white font-bold text-lg">{prizePool.total}</span>
              </div>
            )}
            {prizePlaces.map((p, i) => (
              <div key={p.position} className={`flex items-center justify-between py-2 ${i < prizePlaces.length - 1 ? 'border-b border-[#2a2d3a]' : ''}`}>
                <span className="text-gray-400 text-sm">{ordinal(p.position)} Place</span>
                <span className="font-bold" style={{ color: PLACE_COLORS[i] || '#e5e7eb' }}>{p.prize}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No prize pool set.</p>
        )}
      </div>
    </div>
  );
}

function MatchMini({ title, items, onMatch }: {
  title: string;
  items: { match: BracketMatch; stage: string; status: string }[];
  onMatch: (id: string) => void;
}) {
  return (
    <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-4">
      <p className="text-gray-300 text-xs font-bold uppercase tracking-wider mb-3">{title}</p>
      {items.length === 0 ? (
        <p className="text-gray-600 text-xs">Nothing yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map(({ match: m }) => (
            <button key={m.id} onClick={() => onMatch(m.id)} className="w-full text-left bg-[#0d0f16] rounded-lg px-3 py-2 hover:bg-[#1e2130] transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white text-xs font-medium truncate">{m.team1Name}</span>
                <span className="text-gray-600 text-[10px]">vs</span>
                <span className="text-white text-xs font-medium truncate text-right">{m.team2Name}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Matches tab ──────────────────────────────────────────────────────────────
function MatchesList({ matches, onMatch }: {
  matches: { match: BracketMatch; stage: string; status: 'upcoming' | 'live' | 'completed' }[];
  onMatch: (id: string) => void;
}) {
  const groups: { key: string; label: string }[] = [
    { key: 'live', label: '🔴 Live' },
    { key: 'upcoming', label: '⏰ Upcoming' },
    { key: 'completed', label: '✓ Completed' },
  ];
  if (matches.length === 0) return <p className="text-gray-500 text-sm">No matches yet.</p>;

  return (
    <div className="space-y-6">
      {groups.map(g => {
        const items = matches.filter(m => m.status === g.key);
        if (items.length === 0) return null;
        return (
          <div key={g.key} className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{g.label}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map(({ match: m, stage }) => (
                <button
                  key={m.id}
                  onClick={() => onMatch(m.id)}
                  className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg p-4 hover:border-[#ff4655]/30 transition-colors text-left"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded text-xs font-bold bg-[#ff4655]/20 text-[#ff4655] flex items-center justify-center">{m.team1Name.substring(0, 1)}</div>
                      <span className="text-white text-sm font-semibold flex-1 truncate">{m.team1Name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded text-xs font-bold bg-[#3b82f6]/20 text-[#3b82f6] flex items-center justify-center">{m.team2Name.substring(0, 1)}</div>
                      <span className="text-white text-sm font-semibold flex-1 truncate">{m.team2Name}</span>
                    </div>
                  </div>
                  <div className="pt-2 mt-2 border-t border-[#2a2d3a] flex items-center justify-between">
                    <span className="text-xs text-purple-400 font-semibold">{stage}</span>
                    {(m.date || m.time) && (
                      <span className="text-gray-400 text-xs">
                        {m.date && new Date(`${m.date}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {m.date && m.time && ' • '}{m.time}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Bracket tab ──────────────────────────────────────────────────────────────
function BracketTab({ tournament, stages }: {
  tournament: Tournament;
  stages: { id: string; label: string; brackets: BracketGenerated[] }[];
}) {
  const bracketStages = stages.filter(s => s.brackets.length > 0);

  // Show the latest stage first: Stage 2 (knockout) leads when its bracket exists.
  const orderedStages = [...bracketStages].sort((a, b) => {
    const rank = (id: string) => (id === 'stage2' ? 0 : id === 'stage1' ? 1 : 2);
    return rank(a.id) - rank(b.id);
  });

  // Default the dropdown to the first (latest) stage.
  const [selectedId, setSelectedId] = useState<string>(orderedStages[0]?.id ?? '');

  if (bracketStages.length === 0) {
    return <p className="text-gray-500 text-sm">No bracket has been generated for this tournament.</p>;
  }

  const active = orderedStages.find(s => s.id === selectedId) ?? orderedStages[0];

  return (
    <div className="space-y-4">
      {/* Stage selector — only when more than one stage has a bracket */}
      {orderedStages.length > 1 && (
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-400 font-medium">Stage</label>
          <select
            className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
            value={active.id}
            onChange={e => setSelectedId(e.target.value)}
          >
            {orderedStages.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <h3 className="text-white font-bold text-sm uppercase tracking-wider mb-3">{active.label}</h3>
        {active.brackets.map((bracket, i) => (
          <BracketDisplay
            key={i}
            bracket={bracket}
            teams={tournament.teams}
            editable={false}
            onBracketChange={() => {}}
          />
        ))}
      </div>
    </div>
  );
}
