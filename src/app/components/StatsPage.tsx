import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronDown, BarChart3, Users } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { LoadingState } from './LoadingState';
import type { Tournament, BracketGenerated, MatchPlayerStat, TournamentPlayer } from './TournamentCreation';
import { getTournaments, loadWithRetry } from '../services/db';
import { deriveTournamentStatus } from '../utils/tournamentStatus';
import { normalizeRiotId, normalizeRiotName } from '../utils/riotId';

// Does a recorded stat line belong to a given roster player?
//
// Stats from the Valorant API are keyed by Riot ID (e.g. "TsWaGg#6969");
// manually entered stats are keyed by the roster slot id. We match on:
//   • roster slot id (exact)
//   • current Riot ID (canonically normalized)
//   • current display name (canonically normalized)
//   • any historical alias in player.nameHistory
//
// Normalization is shared with the API fetch layer (utils/riotId.ts), so a roster
// Riot ID with a stray space before the "#", a trailing carriage return from a
// spreadsheet, or a width-variant CJK glyph still resolves to the same player.
// Without this, such a player silently dropped out → a team showed e.g. "2/5".
//
// A rename also never orphans old stat rows — they keep resolving via nameHistory.
export function statMatchesPlayer(stat: MatchPlayerStat, player: TournamentPlayer): boolean {
  if (stat.playerId === player.id) return true;

  const pid   = normalizeRiotId(stat.playerId   ?? '');
  const pidName = normalizeRiotName(stat.playerId ?? '');
  const pname = normalizeRiotId(stat.playerName ?? '');

  // A roster identifier (Riot ID or bare name) matches the stat's id or name.
  const idMatches = (ref?: string): boolean => {
    if (!ref) return false;
    const n = normalizeRiotId(ref);
    const nName = normalizeRiotName(ref);
    return pid === n || pname === n || pidName === nName || pname === nName;
  };

  if (idMatches(player.riotId) || idMatches(player.name)) return true;

  for (const alias of player.nameHistory ?? []) {
    if (idMatches(alias.riotId) || idMatches(alias.name)) return true;
  }
  return false;
}

// ── Stat metric definitions ─────────────────────────────────────────────────

type MetricKey = 'acs' | 'kd' | 'hsPercent' | 'kills';

const METRICS: { key: MetricKey; label: string; format: (v: number) => string }[] = [
  { key: 'acs', label: 'ACS', format: v => Math.round(v).toString() },
  { key: 'kd', label: 'K/D', format: v => v.toFixed(2) },
  { key: 'hsPercent', label: 'HS%', format: v => `${Math.round(v)}%` },
  { key: 'kills', label: 'Kills', format: v => Math.round(v).toString() },
];

// ── Stage helpers ────────────────────────────────────────────────────────────

export interface StageOption {
  id: string;                 // unique value for the dropdown
  label: string;              // display name
  brackets: BracketGenerated[]; // bracket(s) that make up this stage
}

// A tournament is "two-stage" when it carries a stage1 config (group/stage1
// + stage2). Single-stage tournaments only have generatedBracket.
function isTwoStage(t: Tournament): boolean {
  return !!t.stage1Config || !!t.stage1Bracket || !!t.stage2Bracket;
}

// The selectable stages for a tournament. For single-stage there is exactly one
// (Main Bracket); for two-stage there is one per populated stage.
export function getStageOptions(t: Tournament): StageOption[] {
  if (!isTwoStage(t)) {
    return t.generatedBracket
      ? [{ id: 'main', label: 'Main Bracket', brackets: [t.generatedBracket] }]
      : [];
  }
  const stages: StageOption[] = [];
  if (t.stage1Bracket) {
    const label = t.stage1Config?.format === 'groupstage' ? 'Group Stage' : 'Stage 1';
    stages.push({ id: 'stage1', label, brackets: [t.stage1Bracket] });
  }
  if (t.stage2Bracket) {
    stages.push({ id: 'stage2', label: 'Stage 2', brackets: [t.stage2Bracket] });
  }
  return stages;
}

// ── Aggregation ──────────────────────────────────────────────────────────────

export interface PlayerRow {
  playerId: string;
  playerName: string;
  teamName: string;
  mapsPlayed: number;
  // Per-metric aggregated values (averaged across maps where appropriate).
  acs: number;
  kd: number;
  hsPercent: number;
  kills: number;
  deaths: number;
  assists: number;
  // Optional link target: the tournament + roster slot id this player maps to,
  // so callers can build a /player/:tournamentId/:rosterPlayerId link.
  tournamentId?: string;
  rosterPlayerId?: string;
}

// Aggregate every player's stats across all played maps in the given brackets.
// ACS / HS% are averaged per map; kills/deaths/assists are summed; KD is derived
// from summed kills/deaths.
function aggregatePlayers(
  brackets: BracketGenerated[],
  teamNameById: Record<string, string>,
): PlayerRow[] {
  type Agg = {
    playerName: string;
    teamId: string;
    mapsPlayed: number;
    acsSum: number;
    hsSum: number;
    kills: number;
    deaths: number;
    assists: number;
  };
  const acc: Record<string, Agg> = {};
  const order: string[] = [];

  for (const bracket of brackets) {
    for (const match of bracket.rounds.flat()) {
      for (const map of match.maps ?? []) {
        for (const s of map.playerStats ?? []) {
          let cur = acc[s.playerId];
          if (!cur) {
            order.push(s.playerId);
            cur = acc[s.playerId] = {
              playerName: s.playerName,
              teamId: s.teamId,
              mapsPlayed: 0,
              acsSum: 0,
              hsSum: 0,
              kills: 0,
              deaths: 0,
              assists: 0,
            };
          }
          cur.mapsPlayed += 1;
          cur.acsSum += s.acs;
          cur.hsSum += s.hsPercent;
          cur.kills += s.kills;
          cur.deaths += s.deaths;
          cur.assists += s.assists;
          // Keep the most recent non-empty name/team we see.
          if (s.playerName) cur.playerName = s.playerName;
          if (s.teamId) cur.teamId = s.teamId;
        }
      }
    }
  }

  return order.map(id => {
    const a = acc[id];
    return {
      playerId: id,
      playerName: a.playerName,
      teamName: teamNameById[a.teamId] || a.teamId || '—',
      mapsPlayed: a.mapsPlayed,
      acs: a.mapsPlayed > 0 ? a.acsSum / a.mapsPlayed : 0,
      hsPercent: a.mapsPlayed > 0 ? a.hsSum / a.mapsPlayed : 0,
      kd: a.deaths > 0 ? a.kills / a.deaths : a.kills,
      kills: a.kills,
      deaths: a.deaths,
      assists: a.assists,
    };
  });
}

// Top players by total kills across every stage of the given tournaments.
// Used by the homepage "Top Players" widget. Players are aggregated globally by
// id; only those with at least one played map are returned.
export function getTopPlayersByAcs(tournaments: Tournament[], limit = 5): PlayerRow[] {
  const teamNameById: Record<string, string> = {};
  const brackets: BracketGenerated[] = [];
  for (const t of tournaments) {
    t.teams.forEach(team => { teamNameById[team.id] = team.name; });
    for (const stage of getStageOptions(t)) brackets.push(...stage.brackets);
  }
  const top = aggregatePlayers(brackets, teamNameById)
    .filter(p => p.mapsPlayed > 0)
    .sort((a, b) => b.kills - a.kills)
    .slice(0, limit);

  // Resolve each aggregated row back to a roster player so the homepage can link
  // to their profile. The row's playerId is the stat key (Riot ID or slot id);
  // match it against every tournament roster.
  const candidates: { tournamentId: string; player: TournamentPlayer }[] = [];
  for (const t of tournaments) {
    for (const team of t.teams) {
      for (const player of team.players) candidates.push({ tournamentId: t.id, player });
    }
  }
  return top.map(row => {
    const synthetic = { playerId: row.playerId, playerName: row.playerName } as MatchPlayerStat;
    const hit = candidates.find(c => statMatchesPlayer(synthetic, c.player));
    return hit
      ? { ...row, tournamentId: hit.tournamentId, rosterPlayerId: hit.player.id }
      : row;
  });
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function StatsPage() {
  const navigate = useNavigate();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  // "First fetch in flight" vs "loaded but empty" — gates the loader below.
  const [loaded, setLoaded] = useState(false);
  // Deep-link support: /stats?tournament=<id> pre-selects that tournament
  // (used by the tournament page's "Full stats" link).
  const [tournamentId, setTournamentId] = useState(
    () => new URLSearchParams(window.location.search).get('tournament') ?? '',
  );
  const [stageId, setStageId] = useState('');
  const [metric, setMetric] = useState<MetricKey>('kills');

  useEffect(() => loadWithRetry(getTournaments, ts => { setTournaments(ts); setLoaded(true); }), []);

  // Auto-select the first in-progress tournament when tournaments load
  useEffect(() => {
    if (tournaments.length > 0 && !tournamentId) {
      const inProgressTournament = tournaments.find(t => deriveTournamentStatus(t) === 'in-progress');
      if (inProgressTournament) {
        setTournamentId(inProgressTournament.id);
      }
    }
  }, [tournaments, tournamentId]);

  const tournament = useMemo(
    () => tournaments.find(t => t.id === tournamentId) || null,
    [tournaments, tournamentId],
  );

  const stageOptions = useMemo(
    () => (tournament ? getStageOptions(tournament) : []),
    [tournament],
  );

  // When the tournament changes, default the stage to the first available one.
  useEffect(() => {
    if (stageOptions.length > 0) {
      setStageId(prev => (stageOptions.some(s => s.id === prev) ? prev : stageOptions[0].id));
    } else {
      setStageId('');
    }
  }, [stageOptions]);

  const showStageDropdown = tournament ? isTwoStage(tournament) : false;

  const teamNameById = useMemo(() => {
    const map: Record<string, string> = {};
    tournament?.teams.forEach(t => { map[t.id] = t.name; });
    return map;
  }, [tournament]);

  const selectedStage = useMemo(
    () => stageOptions.find(s => s.id === stageId) || null,
    [stageOptions, stageId],
  );

  // Brackets feeding the leaderboard: the chosen stage if shown, otherwise every
  // stage of the tournament combined.
  const activeBrackets = useMemo(() => {
    if (!tournament) return [];
    if (showStageDropdown) return selectedStage?.brackets ?? [];
    return stageOptions.flatMap(s => s.brackets);
  }, [tournament, showStageDropdown, selectedStage, stageOptions]);

  const rows = useMemo(() => {
    const players = aggregatePlayers(activeBrackets, teamNameById);
    return players.sort((a, b) => (b[metric] as number) - (a[metric] as number));
  }, [activeBrackets, teamNameById, metric]);

  const metricDef = METRICS.find(m => m.key === metric)!;

  // Resolve a leaderboard row's player to a roster slot id (for the profile link)
  // and a team name to a team id (for the team page link).
  const resolvePlayerHref = (row: PlayerRow): string | null => {
    if (!tournament) return null;
    const synthetic = { playerId: row.playerId, playerName: row.playerName } as MatchPlayerStat;
    for (const team of tournament.teams) {
      const p = team.players.find(pl => statMatchesPlayer(synthetic, pl));
      if (p) return `/player/${tournament.id}/${p.id}`;
    }
    return null;
  };
  const resolveTeamHref = (teamName: string): string | null => {
    if (!tournament) return null;
    const t = tournament.teams.find(tm => tm.name.toLowerCase() === teamName.toLowerCase());
    return t ? `/teams/${t.id}` : null;
  };

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      <main className="arena-md">
        {/* Back */}
        <button onClick={() => navigate('/')} className="arena-md__back">
          <ChevronLeft className="w-4 h-4" />
          Back to Home
        </button>

        {/* Editorial heading */}
        <div style={{ marginBottom: '1.75rem' }}>
          <p className="arena-md-section__eyebrow">Leaderboards</p>
          <h1 className="arena-md-section__title" style={{ margin: 0, fontSize: '2rem' }}>Player Stats</h1>
        </div>

        {/* Filters */}
        <div className="arena-stats-filters">
          {/* 1) Tournament */}
          <div className="arena-stats-field">
            <label className="arena-stats-field__label">Tournament</label>
            <div className="arena-stats-select">
              <select value={tournamentId} onChange={e => setTournamentId(e.target.value)}>
                <option value="">Select tournament…</option>
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 arena-stats-select__chevron" />
            </div>
          </div>

          {/* 2) Stage — only for two-stage tournaments */}
          {showStageDropdown && (
            <div className="arena-stats-field">
              <label className="arena-stats-field__label">Stage</label>
              <div className="arena-stats-select">
                <select value={stageId} onChange={e => setStageId(e.target.value)}>
                  {stageOptions.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 arena-stats-select__chevron" />
              </div>
            </div>
          )}

          {/* 3) Stat — segmented pills */}
          <div className="arena-stats-field">
            <label className="arena-stats-field__label">Sort by</label>
            <div className="arena-stats-metrics">
              {METRICS.map(m => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetric(m.key)}
                  className={`arena-md-pill${m.key === metric ? ' arena-md-pill--active' : ''}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        {!loaded ? (
          <LoadingState label="Loading stats…" inline />
        ) : !tournament ? (
          <div className="arena-stats-empty">
            <BarChart3 className="w-10 h-10 arena-stats-empty__icon" />
            <p className="arena-stats-empty__title">Select a tournament to view stats</p>
            <p className="arena-stats-empty__sub">Choose from the dropdown above to get started</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="arena-stats-empty">
            <Users className="w-10 h-10 arena-stats-empty__icon" />
            <p className="arena-stats-empty__title">No stats recorded yet</p>
            <p className="arena-stats-empty__sub">
              Player stats appear here once match scoreboards are applied
              {showStageDropdown && selectedStage ? ` for ${selectedStage.label}` : ''}.
            </p>
          </div>
        ) : (
          <div className="arena-md-table-card">
            <div className="arena-md-table-wrap">
              <table className="arena-md-table arena-stats-table">
                <thead>
                  <tr>
                    <th className="arena-md-table__left arena-stats-table__rank">#</th>
                    <th className="arena-md-table__left">Player</th>
                    <th className="arena-md-table__left arena-stats-table__hide-mobile">Team</th>
                    <th>Maps</th>
                    {METRICS.map(m => (
                      <th
                        key={m.key}
                        className={`${m.key === metric ? 'arena-md-table__sorted' : 'arena-stats-table__hide-mobile'}`}
                      >
                        {m.label}{m.key === metric && ' ↓'}
                      </th>
                    ))}
                    <th className="arena-stats-table__hide-mobile">K / D / A</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const playerHref = resolvePlayerHref(row);
                    const teamHref = resolveTeamHref(row.teamName);
                    return (
                      <tr key={row.playerId} className={i % 2 === 0 ? 'arena-md-table__alt' : ''}>
                        <td className="arena-md-table__left arena-stats-table__rank">
                          <span className={i < 3 ? 'arena-stats-table__rank-top' : ''}>{i + 1}</span>
                        </td>
                        <td className="arena-md-table__left">
                          {playerHref ? (
                            <Link to={playerHref} className="arena-md-table__player">{row.playerName}</Link>
                          ) : (
                            <span className="arena-md-table__player arena-md-table__player--static">{row.playerName}</span>
                          )}
                        </td>
                        <td className="arena-md-table__left arena-stats-table__hide-mobile">
                          {teamHref ? (
                            <Link to={teamHref} className="arena-stats-table__team">{row.teamName}</Link>
                          ) : (
                            <span className="arena-stats-table__team arena-stats-table__team--static">{row.teamName}</span>
                          )}
                        </td>
                        <td className="arena-md-table__dim">{row.mapsPlayed}</td>
                        {METRICS.map(m => (
                          <td
                            key={m.key}
                            className={`${m.key === metric ? 'arena-md-table__acs-top' : 'arena-stats-table__hide-mobile'}`}
                          >
                            {m.format(row[m.key] as number)}
                          </td>
                        ))}
                        <td className="arena-md-table__dim arena-stats-table__hide-mobile">
                          {row.kills} / {row.deaths} / {row.assists}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {metricDef && rows.length > 0 && (
          <p className="arena-stats-note">
            Ranked by {metricDef.label}. ACS and HS% are averaged per map; K/D is derived from total kills and deaths.
          </p>
        )}
      </main>
      <Footer />
    </div>
  );
}
