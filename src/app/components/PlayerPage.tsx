import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, ChevronDown, Trophy, Shield } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import type {
  Tournament,
  TeamInTournament,
  TournamentPlayer,
  MatchPlayerStat,
  PlayerAlias,
} from './TournamentCreation';
import { getStageOptions, statMatchesPlayer } from './StatsPage';
import { computePlacement } from './TeamsPage';
import { getTournaments, loadWithRetry } from '../services/db';
import { agentIconUrl, mapImageUrl } from '../utils/valorantAssets';
import { bracketRoundLabel } from '../utils/bracketRounds';
import { deriveTournamentStatus } from '../utils/tournamentStatus';

// Render an agent name with its official icon (falls back to a 2-letter chip).
function AgentTag({ agent }: { agent?: string }) {
  if (!agent) return <span className="arena-md-table__dim">—</span>;
  return (
    <span className="arena-pp-agents">
      {agent.split(',').map(a => a.trim()).filter(Boolean).map((a, i) => {
        const url = agentIconUrl(a);
        return (
          <span key={i} className="arena-pp-agent" title={a}>
            {url
              ? <img src={url} alt={a} className="arena-pp-agent__icon" />
              : <span className="arena-pp-agent__fallback">{a.slice(0, 2).toUpperCase()}</span>}
            <span className="arena-pp-agent__name">{a}</span>
          </span>
        );
      })}
    </span>
  );
}

// One played map's stat line for this player, tagged with where it happened.
interface PlayerMapStat extends MatchPlayerStat {
  matchId: string;
  stageLabel: string;
  opponentName: string;
  mapName: string;
  date?: string;
  won?: boolean; // this map's result for the player's team (undefined on ties)
  tournamentId: string;
  tournamentName: string;
}

// Role badge color (text + background) tuned for the dark editorial surface.
function getRoleStyle(role?: string): { color: string; background: string } {
  switch (role) {
    case 'igl': return { color: '#facc15', background: 'rgba(250,204,21,0.1)' };
    case 'duelist': return { color: '#f87171', background: 'rgba(248,113,113,0.1)' };
    case 'controller': return { color: '#60a5fa', background: 'rgba(96,165,250,0.1)' };
    case 'sentinel': return { color: '#4ade80', background: 'rgba(74,222,128,0.1)' };
    case 'initiator': return { color: '#c084fc', background: 'rgba(192,132,252,0.1)' };
    default: return { color: '#9ca3af', background: 'rgba(156,163,175,0.1)' };
  }
}

// Two uppercase initials of a player name, for the photo fallback.
function playerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().substring(0, 2).toUpperCase();
}

// Find the player + their team within a tournament.
function findPlayer(
  tournament: Tournament,
  playerId: string,
): { player: TournamentPlayer; team: TeamInTournament } | null {
  for (const team of tournament.teams) {
    const player = team.players.find(p => p.id === playerId);
    if (player) return { player, team };
  }
  return null;
}

// Collect every played-map stat line for this player across the tournament,
// tagged with stage / opponent / map for the match-history table.
function collectPlayerMapStats(
  tournament: Tournament,
  player: TournamentPlayer,
  teamId: string,
): PlayerMapStat[] {
  const teamNameById: Record<string, string> = {};
  tournament.teams.forEach(t => { teamNameById[t.id] = t.name; });

  const out: PlayerMapStat[] = [];
  // Deduplicate by matchId+mapName so the same map doesn't appear twice when
  // the same match data is stored across multiple tournament copies.
  const seen = new Set<string>();
  for (const stage of getStageOptions(tournament)) {
    for (const bracket of stage.brackets) {
      for (const match of bracket.rounds.flat()) {
        // Opponent = whichever side isn't this player's team.
        const opponentId = match.team1Id === teamId ? match.team2Id : match.team1Id;
        const opponentName =
          match.team1Id === teamId ? match.team2Name : match.team1Name;
        for (const map of match.maps ?? []) {
          const s = (map.playerStats ?? []).find(ps => statMatchesPlayer(ps, player));
          if (!s) continue;
          // Deduplicate by matchId + mapName: the same match stored across
          // multiple tournament copies shares the same matchId so this collapses it.
          const key = `${match.id}|${map.mapName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const isT1 = match.team1Id === teamId;
          out.push({
            ...s,
            matchId: match.id,
            // Actual bracket round ("WB Round 1", "Grand Final") when derivable;
            // generic stage/group label otherwise (round robin, groups).
            stageLabel: bracketRoundLabel(bracket, match) ?? stage.label,
            opponentName: opponentName || teamNameById[opponentId] || 'TBD',
            mapName: map.mapName || '—',
            date: match.date,
            won: map.team1Score === map.team2Score
              ? undefined
              : (isT1 ? map.team1Score > map.team2Score : map.team2Score > map.team1Score),
            tournamentId: tournament.id,
            tournamentName: tournament.name,
          });
        }
      }
    }
  }
  return out;
}

// One tournament's worth of this player's stats, for the career section.
interface CareerEntry {
  tournamentId: string;
  tournamentName: string;
  maps: number;
  kills: number;
  acs: number;
  placement: string | null; // only set once the tournament is completed
}

interface Aggregate {
  mapsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;       // averaged per map
  hsPercent: number; // averaged per map
  kd: number;        // total kills / total deaths
  agents: string[];
}

function aggregate(stats: PlayerMapStat[]): Aggregate {
  const maps = stats.length;
  let kills = 0, deaths = 0, assists = 0, acsSum = 0, hsSum = 0;
  const agents = new Set<string>();
  for (const s of stats) {
    kills += s.kills;
    deaths += s.deaths;
    assists += s.assists;
    acsSum += s.acs;
    hsSum += s.hsPercent;
    if (s.agent) agents.add(s.agent);
  }
  return {
    mapsPlayed: maps,
    kills,
    deaths,
    assists,
    acs: maps > 0 ? acsSum / maps : 0,
    hsPercent: maps > 0 ? hsSum / maps : 0,
    kd: deaths > 0 ? kills / deaths : kills,
    agents: [...agents],
  };
}

export function PlayerPage() {
  const { tournamentId = '', playerId = '' } = useParams();
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAliases, setShowAliases] = useState(false);

  useEffect(() => loadWithRetry(getTournaments, ts => { setTournaments(ts); setLoading(false); }), []);

  const tournament = useMemo(
    () => tournaments.find(t => t.id === tournamentId) || null,
    [tournaments, tournamentId],
  );

  // Find the player by id in the URL's tournament first; if not there (e.g. a
  // substitute who only exists in another tournament's copy of the team), fall
  // back to searching every tournament. `sourceTournament` is wherever we found
  // them, so stats are collected from the right place.
  const resolved = useMemo(() => {
    const primary = tournament ? findPlayer(tournament, playerId) : null;
    if (primary && tournament) return { ...primary, sourceTournament: tournament };
    for (const t of tournaments) {
      const hit = findPlayer(t, playerId);
      if (hit) return { ...hit, sourceTournament: t };
    }
    return null;
  }, [tournament, tournaments, playerId]);

  const found = resolved;

  // The player's photo may have been uploaded on a different tournament's copy
  // of this team (teams recur across tournaments). If this copy has no photo,
  // backfill it from another copy matched by team name + player name.
  const photo = useMemo(() => {
    if (!found) return undefined;
    if (found.player.photo) return found.player.photo;
    const norm = (s: string) => s.trim().toLowerCase();
    for (const t of tournaments) {
      for (const team of t.teams) {
        if (norm(team.name) !== norm(found.team.name)) continue;
        const match = team.players.find(p => norm(p.name) === norm(found.player.name) && p.photo);
        if (match?.photo) return match.photo;
      }
    }
    return undefined;
  }, [found, tournaments]);

  const { mapStats, careers } = useMemo(() => {
    if (!resolved) return { mapStats: [] as PlayerMapStat[], careers: [] as CareerEntry[] };
    const norm = (s: string) => s.trim().toLowerCase();
    const allStats: PlayerMapStat[] = [];
    const careerList: CareerEntry[] = [];
    const seen = new Set<string>();
    // Collect from every tournament where a team with the same name contains
    // this player — covers the case where the same squad appears across multiple
    // tournament entries (e.g. vct + rrb + vvv all having Fire5 Esports).
    for (const t of tournaments) {
      for (const tm of t.teams) {
        if (norm(tm.name) !== norm(resolved.team.name)) continue;
        const rosterPlayer = tm.players.find(p =>
          p.id === resolved.player.id || norm(p.name) === norm(resolved.player.name)
        );
        if (!rosterPlayer) continue;
        const rows: PlayerMapStat[] = [];
        for (const row of collectPlayerMapStats(t, rosterPlayer, tm.id)) {
          const key = `${row.matchId}|${row.mapName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push(row);
        }
        if (rows.length === 0) continue;
        allStats.push(...rows);
        const a = aggregate(rows);
        careerList.push({
          tournamentId: t.id,
          tournamentName: t.name,
          maps: rows.length,
          kills: a.kills,
          acs: a.acs,
          placement: deriveTournamentStatus(t) === 'completed' ? computePlacement(t, tm.id) : null,
        });
      }
    }
    return { mapStats: allStats, careers: careerList };
  }, [resolved, tournaments]);

  const agg = useMemo(() => aggregate(mapStats), [mapStats]);

  // Match history, most recent first: dated maps sort descending; undated ones
  // follow in reverse insertion order (later bracket rounds were pushed later).
  const sortedStats = useMemo(() => {
    const ts = (s: PlayerMapStat) => {
      if (!s.date) return Number.NEGATIVE_INFINITY;
      const t = new Date(`${s.date}T00:00`).getTime();
      return isNaN(t) ? Number.NEGATIVE_INFINITY : t;
    };
    return mapStats.slice().reverse().sort((a, b) => ts(b) - ts(a));
  }, [mapStats]);

  // Per-agent breakdown, most-played first.
  const agentBreakdown = useMemo(() => {
    const by = new Map<string, { agent: string; maps: number; kills: number; deaths: number; acsSum: number }>();
    for (const s of mapStats) {
      const agent = (s.agent ?? '').split(',')[0].trim();
      if (!agent) continue;
      const cur = by.get(agent.toLowerCase()) ?? { agent, maps: 0, kills: 0, deaths: 0, acsSum: 0 };
      cur.maps += 1; cur.kills += s.kills; cur.deaths += s.deaths; cur.acsSum += s.acs;
      by.set(agent.toLowerCase(), cur);
    }
    return [...by.values()]
      .map(a => ({ ...a, acs: a.acsSum / a.maps, kd: a.deaths > 0 ? a.kills / a.deaths : a.kills }))
      .sort((a, b) => b.maps - a.maps || b.acs - a.acs);
  }, [mapStats]);

  // Per-map breakdown with W–L record, most-played first.
  const mapBreakdown = useMemo(() => {
    const by = new Map<string, { map: string; maps: number; wins: number; losses: number; acsSum: number }>();
    for (const s of mapStats) {
      if (!s.mapName || s.mapName === '—') continue;
      const cur = by.get(s.mapName.toLowerCase()) ?? { map: s.mapName, maps: 0, wins: 0, losses: 0, acsSum: 0 };
      cur.maps += 1; cur.acsSum += s.acs;
      if (s.won === true) cur.wins += 1;
      else if (s.won === false) cur.losses += 1;
      by.set(s.mapName.toLowerCase(), cur);
    }
    return [...by.values()]
      .map(m => ({ ...m, acs: m.acsSum / m.maps }))
      .sort((a, b) => b.maps - a.maps || b.acs - a.acs);
  }, [mapStats]);

  // Career-best map by kills, for the highlight strip.
  const peak = useMemo(() => {
    let best: PlayerMapStat | null = null;
    for (const s of mapStats) if (!best || s.kills > best.kills) best = s;
    return best && best.kills > 0 ? best : null;
  }, [mapStats]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text animate-pulse">Loading player…</p>
        </div>
        <Footer />
      </div>
    );
  }

  if (!found) {
    return (
      <div className="min-h-screen bg-[#0e0e0e]">
        <Header />
        <div className="arena-md-state">
          <p className="arena-md-state__text">Player not found.</p>
          <button onClick={() => navigate(-1)} className="arena-md__back" style={{ margin: '0 auto' }}>
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
        </div>
        <Footer />
      </div>
    );
  }

  const { player, team } = found;
  // The tournament the player actually belongs to (may differ from the URL one).
  const playerTournament = found.sourceTournament;

  const matchesPlayed = new Set(mapStats.map(s => s.matchId)).size;
  const summaryCards: { label: string; value: string; sub: string; highlight?: boolean }[] = [
    { label: 'ACS', value: Math.round(agg.acs).toString(), sub: 'avg per map', highlight: true },
    { label: 'K/D', value: agg.kd.toFixed(2), sub: `${agg.kills} K · ${agg.deaths} D · ${agg.assists} A` },
    { label: 'HS%', value: `${Math.round(agg.hsPercent)}%`, sub: 'avg per map' },
    { label: 'Maps', value: agg.mapsPlayed.toString(), sub: `across ${matchesPlayed} ${matchesPlayed === 1 ? 'match' : 'matches'}` },
  ];

  // Short date for the history table, e.g. "12 May" — omitted when unknown.
  const formatDate = (d?: string) => {
    if (!d) return '—';
    const t = new Date(d);
    if (isNaN(t.getTime())) return '—';
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const hasDates = mapStats.some(s => s.date && !isNaN(new Date(s.date).getTime()));

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-md">
        {/* Back */}
        <button onClick={() => navigate(`/teams/${team.id}`)} className="arena-md__back">
          <ChevronLeft className="w-4 h-4" />
          Back to Roster
        </button>

        {/* Player hero */}
        <div className="arena-pp-hero">
          <div className="arena-pp-hero__photo">
            {photo
              ? <img src={photo} alt={player.name} />
              : <span className="arena-pp-hero__initials">{playerInitials(player.name)}</span>}
          </div>

          <div className="arena-pp-hero__id">
            <p className="arena-md-section__eyebrow" style={{ margin: '0 0 0.4rem' }}>Player Profile</p>

            {/* Name + optional history indicator */}
            <div className="arena-pp-name-row">
              <h1 className="arena-pp-hero__name">{player.name}</h1>
              {(player.nameHistory ?? []).length > 0 && (
                <div className="arena-pp-alias">
                  <button
                    type="button"
                    className="arena-pp-alias__trigger"
                    onClick={() => setShowAliases(v => !v)}
                    title="This player has changed their name"
                  >
                    <ChevronDown className={`arena-pp-alias__chevron${showAliases ? ' arena-pp-alias__chevron--open' : ''}`} />
                  </button>
                  {showAliases && (
                    <>
                      {/* Transparent backdrop — closes the dropdown on click-away. */}
                      <div
                        className="arena-pp-alias__backdrop"
                        onClick={() => setShowAliases(false)}
                      />
                      <div className="arena-pp-alias__dropdown">
                        <p className="arena-pp-alias__label">Previously played as:</p>
                        <ul className="arena-pp-alias__list">
                          {(player.nameHistory ?? []).map((alias: PlayerAlias, i: number) => (
                            <li key={i} className="arena-pp-alias__item">
                              <span className="arena-pp-alias__name">{alias.name}</span>
                              {alias.riotId && (
                                <span className="arena-pp-alias__riot">{alias.riotId}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {player.riotId && (
              <p className="arena-pp-hero__riot" title="Riot ID">
                <span className="arena-pp-hero__riot-name">{player.riotId.split('#')[0]}</span>
                {player.riotId.includes('#') && (
                  <span className="arena-pp-hero__riot-tag">#{player.riotId.split('#').slice(1).join('#')}</span>
                )}
              </p>
            )}

            <div className="arena-pp-hero__chips">
              <button type="button" onClick={() => navigate(`/teams/${team.id}`)} className="arena-pp-chip arena-pp-chip--link">
                <Shield className="w-3.5 h-3.5" />
                {team.name}
              </button>
              <button type="button" onClick={() => navigate(`/tournament/${playerTournament.id}`)} className="arena-pp-chip arena-pp-chip--link">
                <Trophy className="w-3.5 h-3.5" />
                {playerTournament.name}
              </button>
              {player.role && (
                <span className="arena-pp-chip arena-pp-chip--role" style={getRoleStyle(player.role)}>
                  {player.role.toUpperCase()}
                </span>
              )}
            </div>

            {agg.agents.length > 0 && (
              <div className="arena-pp-hero__agents">
                <span className="arena-pp-hero__agents-label">Agents</span>
                <AgentTag agent={agg.agents.join(', ')} />
              </div>
            )}
          </div>
        </div>

        {/* Summary stat strip */}
        <div className="arena-pp-stats">
          {summaryCards.map(card => (
            <div key={card.label} className="arena-pp-stat">
              <p className="arena-pp-stat__label">{card.label}</p>
              <p className={`arena-pp-stat__value${card.highlight ? ' arena-pp-stat__value--accent' : ''}`}>
                {card.value}
              </p>
              <p className="arena-pp-stat__sub">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Career-best highlight — map splash backdrop, broadcast-style strip */}
        {peak && (() => {
          const splash = mapImageUrl(peak.mapName);
          return (
            <div
              className="arena-pp-peak"
              style={splash ? {
                backgroundImage: `linear-gradient(90deg, #111 0%, rgba(17,17,17,0.96) 30%, rgba(17,17,17,0.6) 65%, rgba(17,17,17,0.88) 100%), url(${splash})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center 30%',
              } : undefined}
            >
              <span className="arena-pp-peak__label">Career Best</span>
              <span className="arena-pp-peak__kills">
                {peak.kills}<small>kills</small>
              </span>
              <span className="arena-pp-peak__div" />
              <span className="arena-pp-peak__text">
                vs <strong>{peak.opponentName}</strong>
                <span className="arena-pp-peak__dot">·</span>
                {peak.mapName}
              </span>
            </div>
          );
        })()}

        {/* Agent / map breakdowns */}
        {(agentBreakdown.length > 0 || mapBreakdown.length > 0) && (
          <div className="arena-pp-break">
            {agentBreakdown.length > 0 && (
              <div className="arena-tp-card">
                <h3 className="arena-tp-card__title">By Agent</h3>
                <div className="arena-pp-break__list">
                  {agentBreakdown.map(a => {
                    const icon = agentIconUrl(a.agent);
                    return (
                      <div key={a.agent} className="arena-pp-break__row">
                        <span className="arena-pp-break__who">
                          {icon
                            ? <img src={icon} alt="" className="arena-pp-break__icon" />
                            : <span className="arena-pp-break__icon arena-pp-break__icon--empty" />}
                          <span className="arena-pp-break__name">{a.agent}</span>
                        </span>
                        <span className="arena-pp-break__cell">{a.maps} {a.maps === 1 ? 'map' : 'maps'}</span>
                        <span className="arena-pp-break__cell arena-pp-break__cell--num">{Math.round(a.acs)} <small>ACS</small></span>
                        <span className="arena-pp-break__cell arena-pp-break__cell--num">{a.kd.toFixed(2)} <small>K/D</small></span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {mapBreakdown.length > 0 && (
              <div className="arena-tp-card">
                <h3 className="arena-tp-card__title">By Map</h3>
                <div className="arena-pp-break__list">
                  {mapBreakdown.map(m => (
                    <div key={m.map} className="arena-pp-break__row">
                      <span className="arena-pp-break__who">
                        <span className="arena-pp-break__name">{m.map}</span>
                      </span>
                      <span className="arena-pp-break__cell">
                        <span className="arena-pp-break__w">{m.wins}W</span>
                        <span className="arena-pp-break__sep"> – </span>
                        <span className="arena-pp-break__l">{m.losses}L</span>
                      </span>
                      <span className="arena-pp-break__cell">{m.maps} {m.maps === 1 ? 'map' : 'maps'}</span>
                      <span className="arena-pp-break__cell arena-pp-break__cell--num">{Math.round(m.acs)} <small>ACS</small></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Career across tournaments */}
        {careers.length > 0 && (
          <div className="arena-tp-card arena-pp-career">
            <h3 className="arena-tp-card__title"><Trophy className="w-4 h-4" /> Tournaments</h3>
            <div className="arena-pp-break__list">
              {careers.map(c => (
                <Link key={c.tournamentId} to={`/tournament/${c.tournamentId}`} className="arena-pp-break__row arena-pp-career__row">
                  <span className="arena-pp-break__who">
                    <span className="arena-pp-break__name">{c.tournamentName}</span>
                  </span>
                  {c.placement && <span className="arena-pp-career__place">{c.placement}</span>}
                  <span className="arena-pp-break__cell">{c.maps} {c.maps === 1 ? 'map' : 'maps'}</span>
                  <span className="arena-pp-break__cell arena-pp-break__cell--num">{Math.round(c.acs)} <small>ACS</small></span>
                  <span className="arena-pp-break__cell arena-pp-break__cell--num">{c.kills} <small>K</small></span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Match / map history */}
        <section className="arena-md-section arena-pp-form">
          <p className="arena-md-section__eyebrow">Form</p>
          <h2 className="arena-md-section__title">Match History</h2>

          {mapStats.length === 0 ? (
            <div className="arena-stats-empty">
              <p className="arena-stats-empty__title">No stats recorded yet</p>
              <p className="arena-stats-empty__sub">
                Stats appear here once match scoreboards are applied for this player.
              </p>
            </div>
          ) : (
            <div className="arena-md-table-card">
              <div className="arena-md-table-wrap">
                <table className="arena-md-table arena-pp-table">
                  <thead>
                    <tr>
                      <th className="arena-md-table__left">Stage</th>
                      {hasDates && <th className="arena-md-table__left">Date</th>}
                      <th className="arena-md-table__left">Opponent</th>
                      <th className="arena-md-table__left">Map</th>
                      <th className="arena-md-table__left">Agent</th>
                      <th>K / D / A</th>
                      <th>ACS</th>
                      <th>HS%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStats.map((s, i) => (
                      <tr
                        key={`${s.playerId}-${i}`}
                        onClick={() => navigate(`/tournament-match/${s.matchId}`)}
                        className={`arena-pp-table__row${i % 2 === 0 ? ' arena-md-table__alt' : ''}${s.won === true ? ' arena-pp-table__row--w' : s.won === false ? ' arena-pp-table__row--l' : ''}`}
                      >
                        <td className="arena-md-table__left"><span className="arena-pp-table__stage">{s.stageLabel}</span></td>
                        {hasDates && <td className="arena-md-table__left arena-md-table__dim">{formatDate(s.date)}</td>}
                        <td className="arena-md-table__left arena-pp-table__opp">vs {s.opponentName}</td>
                        <td className="arena-md-table__left">
                          {(() => {
                            const splash = mapImageUrl(s.mapName);
                            return (
                              <span
                                className="arena-pp-map-chip"
                                style={splash ? {
                                  backgroundImage: `linear-gradient(90deg, #131313 0%, rgba(19,19,19,0.85) 35%, rgba(19,19,19,0.45) 100%), url(${splash})`,
                                  backgroundSize: 'cover',
                                  backgroundPosition: 'center 30%',
                                } : undefined}
                              >
                                {s.mapName}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="arena-md-table__left"><AgentTag agent={s.agent} /></td>
                        <td>
                          <span className="arena-pp-kda">
                            <span className="arena-pp-kda__k">{s.kills}</span>
                            <span className="arena-pp-kda__sep">/</span>
                            <span className="arena-pp-kda__d">{s.deaths}</span>
                            <span className="arena-pp-kda__sep">/</span>
                            <span className="arena-pp-kda__a">{s.assists}</span>
                          </span>
                        </td>
                        <td className={`arena-md-table__acs-top${s.acs >= 240 ? ' arena-pp-table__acs-hot' : ''}`}>{s.acs}</td>
                        <td className="arena-md-table__dim">{s.hsPercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="arena-pp-table__totals">
                      <td className="arena-md-table__left" colSpan={hasDates ? 4 : 3}>
                        Total · {agg.mapsPlayed} {agg.mapsPlayed === 1 ? 'map' : 'maps'}
                      </td>
                      <td>—</td>
                      <td>
                        <span className="arena-pp-kda">
                          <span className="arena-pp-kda__k">{agg.kills}</span>
                          <span className="arena-pp-kda__sep">/</span>
                          <span className="arena-pp-kda__d">{agg.deaths}</span>
                          <span className="arena-pp-kda__sep">/</span>
                          <span className="arena-pp-kda__a">{agg.assists}</span>
                        </span>
                      </td>
                      <td>{Math.round(agg.acs)}</td>
                      <td>{Math.round(agg.hsPercent)}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
