import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { getTournaments, loadWithRetry } from '../services/db';
import { agentIconUrl } from '../utils/valorantAssets';

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
          out.push({
            ...s,
            matchId: match.id,
            stageLabel: stage.label,
            opponentName: opponentName || teamNameById[opponentId] || 'TBD',
            mapName: map.mapName || '—',
            date: match.date,
          });
        }
      }
    }
  }
  return out;
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

  const mapStats = useMemo(() => {
    if (!resolved) return [];
    const norm = (s: string) => s.trim().toLowerCase();
    const allStats: PlayerMapStat[] = [];
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
        for (const row of collectPlayerMapStats(t, rosterPlayer, tm.id)) {
          const key = `${row.matchId}|${row.mapName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allStats.push(row);
        }
      }
    }
    return allStats;
  }, [resolved, tournaments]);

  const agg = useMemo(() => aggregate(mapStats), [mapStats]);

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

  const summaryCards: { label: string; value: string; highlight?: boolean }[] = [
    { label: 'ACS', value: Math.round(agg.acs).toString(), highlight: true },
    { label: 'K/D', value: agg.kd.toFixed(2) },
    { label: 'HS%', value: `${Math.round(agg.hsPercent)}%` },
    { label: 'Maps', value: agg.mapsPlayed.toString() },
  ];

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

            {player.riotId && <p className="arena-pp-hero__riot">{player.riotId}</p>}

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

        {/* Summary stat cards */}
        <div className="arena-pp-stats">
          {summaryCards.map(card => (
            <div key={card.label} className="arena-pp-stat">
              <p className="arena-pp-stat__label">{card.label}</p>
              <p className={`arena-pp-stat__value${card.highlight ? ' arena-pp-stat__value--accent' : ''}`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>

        {/* Match / map history */}
        <section className="arena-md-section">
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
                      <th className="arena-md-table__left">Opponent</th>
                      <th className="arena-md-table__left">Map</th>
                      <th className="arena-md-table__left">Agent</th>
                      <th>K / D / A</th>
                      <th>ACS</th>
                      <th>HS%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapStats.map((s, i) => (
                      <tr
                        key={`${s.playerId}-${i}`}
                        onClick={() => navigate(`/tournament-match/${s.matchId}`)}
                        className={`arena-pp-table__row${i % 2 === 0 ? ' arena-md-table__alt' : ''}`}
                      >
                        <td className="arena-md-table__left"><span className="arena-pp-table__stage">{s.stageLabel}</span></td>
                        <td className="arena-md-table__left arena-pp-table__opp">{s.opponentName}</td>
                        <td className="arena-md-table__left arena-md-table__dim">{s.mapName}</td>
                        <td className="arena-md-table__left"><AgentTag agent={s.agent} /></td>
                        <td className="arena-md-table__dim">{s.kills} / {s.deaths} / {s.assists}</td>
                        <td className="arena-md-table__acs-top">{s.acs}</td>
                        <td className="arena-md-table__dim">{s.hsPercent}%</td>
                      </tr>
                    ))}
                  </tbody>
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
