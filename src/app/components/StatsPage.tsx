import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, BarChart3, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Header } from './Header';
import type { Tournament, BracketGenerated, MatchPlayerStat, TournamentPlayer } from './TournamentCreation';
import { getTournaments } from '../services/db';

// Does a recorded stat line belong to a given roster player? Stats applied from
// the Valorant API are keyed by Riot ID (e.g. "TsWaGg#6969"), while manually
// entered stats are keyed by the roster slot id. So we match on any of: slot id,
// Riot ID (case-insensitive), or display name (case-insensitive).
export function statMatchesPlayer(stat: MatchPlayerStat, player: TournamentPlayer): boolean {
  const pid = (stat.playerId ?? '').toLowerCase();
  const pname = (stat.playerName ?? '').toLowerCase();
  if (stat.playerId === player.id) return true;
  if (player.riotId && pid === player.riotId.toLowerCase()) return true;
  if (player.name && (pid === player.name.toLowerCase() || pname === player.name.toLowerCase())) return true;
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

// Top players by average ACS across every stage of the given tournaments.
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
    .sort((a, b) => b.acs - a.acs)
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
  const [tournamentId, setTournamentId] = useState('');
  const [stageId, setStageId] = useState('');
  const [metric, setMetric] = useState<MetricKey>('acs');

  useEffect(() => {
    getTournaments().then(setTournaments).catch(() => {});
  }, []);

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

  return (
    <div className="min-h-screen bg-[#0d0f16] pb-16">
      <Header />

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Page title */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-[#1e2130] rounded-lg transition-colors text-gray-500 hover:text-white"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#ff4655]" />
            <div>
              <h1 className="text-white font-bold text-2xl">Stats</h1>
              <p className="text-gray-500 text-sm">Player leaderboards by tournament</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-5">
          <div className={`grid grid-cols-1 gap-4 ${showStageDropdown ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            {/* 1) Tournament */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Tournament</label>
              <select
                className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                value={tournamentId}
                onChange={e => setTournamentId(e.target.value)}
              >
                <option value="">Select tournament…</option>
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* 2) Stage — only for two-stage tournaments */}
            {showStageDropdown && (
              <div>
                <label className="block text-xs text-gray-400 mb-1.5 font-medium">Stage</label>
                <select
                  className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                  value={stageId}
                  onChange={e => setStageId(e.target.value)}
                >
                  {stageOptions.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 3) Stat */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Sort by stat</label>
              <select
                className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                value={metric}
                onChange={e => setMetric(e.target.value as MetricKey)}
              >
                {METRICS.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        {!tournament ? (
          <div className="text-center py-16 bg-[#151821] border border-[#2a2d3a] rounded-xl">
            <BarChart3 className="w-12 h-12 mx-auto text-gray-600 mb-4" />
            <p className="text-gray-400 mb-1">Select a tournament to view stats</p>
            <p className="text-gray-600 text-sm">Choose from the dropdown above to get started</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 bg-[#151821] border border-[#2a2d3a] rounded-xl">
            <Users className="w-12 h-12 mx-auto text-gray-600 mb-4" />
            <p className="text-gray-400 mb-1">No stats recorded yet</p>
            <p className="text-gray-600 text-sm">
              Player stats appear here once match scoreboards are applied
              {showStageDropdown && selectedStage ? ` for ${selectedStage.label}` : ''}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#2a2d3a]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#151821] text-gray-400 text-xs uppercase">
                  <th className="px-4 py-3 text-left w-14">#</th>
                  <th className="px-4 py-3 text-left">Player</th>
                  <th className="px-4 py-3 text-left">Team</th>
                  <th className="px-4 py-3 text-center w-16">Maps</th>
                  {METRICS.map(m => (
                    <th
                      key={m.key}
                      className={`px-4 py-3 text-center w-24 ${m.key === metric ? 'text-[#ff4655]' : ''}`}
                    >
                      {m.label}
                      {m.key === metric && ' ↓'}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center w-28">K / D / A</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.playerId}
                    className="border-t border-[#2a2d3a] bg-[#0d0f16] hover:bg-[#151821] transition-colors"
                  >
                    <td className="px-4 py-3 text-gray-500 font-semibold">{i + 1}</td>
                    <td className="px-4 py-3 text-white font-semibold">{row.playerName}</td>
                    <td className="px-4 py-3 text-gray-400">{row.teamName}</td>
                    <td className="px-4 py-3 text-center text-gray-400">{row.mapsPlayed}</td>
                    {METRICS.map(m => (
                      <td
                        key={m.key}
                        className={`px-4 py-3 text-center ${m.key === metric ? 'text-[#ff4655] font-bold' : 'text-white'}`}
                      >
                        {m.format(row[m.key] as number)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center text-gray-300">
                      {row.kills} / {row.deaths} / {row.assists}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {metricDef && rows.length > 0 && (
          <p className="text-xs text-gray-600">
            Ranked by {metricDef.label}. ACS and HS% are averaged per map; K/D is derived from total kills and deaths.
          </p>
        )}
      </main>
    </div>
  );
}
