import type {
  Tournament, BracketGenerated, BracketMatch, MatchPlayerStat,
} from '../components/TournamentCreation';
import { getStageOptions, statMatchesPlayer } from '../components/StatsPage';
import { computePlacement } from '../components/TeamsPage';
import { bracketRoundLabel } from './bracketRounds';

// ── ClutchGG Tournament MVP — weighted performance model ────────────────────
//
// VCT-style evaluation: per-map stats are weighted by tournament stage (a
// grand-final map counts more than a group-stage map), averaged, min-max
// normalized to a 0–1 scale, then combined with a final-placement bonus into
// a 0–100 MVP score. Deterministic and reproducible from stored match data.
//
// Note on "Rating": no external rating (VLR 2.0 etc.) is stored, so the
// rating component uses a deterministic per-round impact proxy:
//   rating = 1 + (kills + 0.5·assists − deaths) / rounds
// which lands in the same 0.8–1.4 band a real rating occupies.

// Stage multipliers applied to every map's stats.
const STAGE_MULTIPLIERS = {
  GROUP_STAGE: 1.0,
  QUARTERFINAL: 1.15,
  SEMIFINAL: 1.3,
  LOWER_FINAL: 1.4,
  GRAND_FINAL: 1.5,
} as const;

// Min/max bands for min-max normalization. Values outside clamp to [0, 1].
const NORM_RANGES = {
  rating: { min: 0.8, max: 1.4 },
  acs: { min: 150, max: 320 },
  adr: { min: 100, max: 180 },
  kast: { min: 0.6, max: 0.85 },   // fraction (stored % is converted)
  entry: { min: -0.05, max: 0.15 },
} as const;

// Component weights. Placement is fixed; stat weights renormalize when a
// metric is unavailable (older matches without ADR/KAST/FK-FD imports).
const WEIGHTS = {
  rating: 0.3,
  acs: 0.25,
  adr: 0.15,
  kast: 0.1,
  entry: 0.1,
  placement: 0.1,
} as const;

export type MvpStageScope = 'all' | 'stage2';

export interface MvpResult {
  playerId: string;
  rosterId: string;          // roster slot id for /player links
  name: string;
  teamId: string;
  teamName: string;
  mapsPlayed: number;

  weightedACS: number;
  weightedADR: number | null;
  weightedRating: number;
  weightedKAST: number | null;     // fraction 0–1
  weightedEntryImpact: number | null;

  acsNorm: number;
  adrNorm: number | null;
  ratingNorm: number;
  kastNorm: number | null;
  entryNorm: number | null;

  placementBonus: number;
  mvpScore: number;          // 0–100
}

// One map's stat line tagged with its stage multiplier and round count.
interface MapSample {
  stat: MatchPlayerStat;
  multiplier: number;
  rounds: number;
}

// Stage multiplier for a map, from the match's bracket-round label.
function stageMultiplierFor(bracket: BracketGenerated, match: BracketMatch): number {
  const label = bracketRoundLabel(bracket, match);
  if (!label) return STAGE_MULTIPLIERS.GROUP_STAGE; // round robin / groups
  if (label === 'Grand Final') return STAGE_MULTIPLIERS.GRAND_FINAL;
  if (label === 'LB Final') return STAGE_MULTIPLIERS.LOWER_FINAL;
  // Single-elim "Final" decides the tournament; "WB Final" feeds the grand
  // final, so it carries semifinal weight.
  if (label === 'Final') return STAGE_MULTIPLIERS.GRAND_FINAL;
  if (label.endsWith('Final')) return STAGE_MULTIPLIERS.SEMIFINAL;
  if (label.includes('Semi')) return STAGE_MULTIPLIERS.SEMIFINAL;
  if (label.includes('Quarter')) return STAGE_MULTIPLIERS.QUARTERFINAL;
  return STAGE_MULTIPLIERS.GROUP_STAGE;
}

// SUM(stat·multiplier) / SUM(multiplier) over samples where the stat exists.
// Returns null when no sample carries the stat (metric unavailable).
export function calculateWeightedAverage(
  samples: MapSample[],
  pick: (s: MapSample) => number | undefined,
): number | null {
  let num = 0, den = 0;
  for (const s of samples) {
    const v = pick(s);
    if (v === undefined || Number.isNaN(v)) continue;
    num += v * s.multiplier;
    den += s.multiplier;
  }
  return den > 0 ? num / den : null;
}

// Min-max normalization clamped to [0, 1].
export function normalizeStat(value: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// Per-map entry impact: (firstKills − firstDeaths) / rounds.
export function calculateEntryImpact(fk: number, fd: number, rounds: number): number {
  return rounds > 0 ? (fk - fd) / rounds : 0;
}

// Placement bonus from the team's final placement string ('1st', 'Top 4', …).
export function calculatePlacementBonus(placement: string | null): number {
  if (!placement) return 0.4;
  if (placement === '1st') return 1.0;
  if (placement === '2nd') return 0.85;
  const m = placement.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : Infinity;
  if (n <= 4) return 0.7;
  if (n <= 8) return 0.55;
  return 0.4;
}

// Combine normalized components into the 0–100 score. Missing optional
// metrics (null) have their weight redistributed across available stats so
// older tournaments without advanced stats still score on a 0–100 scale.
export function calculateMVPScore(parts: {
  ratingNorm: number;
  acsNorm: number;
  adrNorm: number | null;
  kastNorm: number | null;
  entryNorm: number | null;
  placementBonus: number;
}): number {
  const stats: { value: number | null; weight: number }[] = [
    { value: parts.ratingNorm, weight: WEIGHTS.rating },
    { value: parts.acsNorm, weight: WEIGHTS.acs },
    { value: parts.adrNorm, weight: WEIGHTS.adr },
    { value: parts.kastNorm, weight: WEIGHTS.kast },
    { value: parts.entryNorm, weight: WEIGHTS.entry },
  ];
  const available = stats.filter(s => s.value !== null);
  const availWeight = available.reduce((s, x) => s + x.weight, 0);
  const statBudget = 1 - WEIGHTS.placement; // 0.90 shared by the stat metrics
  const statScore = availWeight > 0
    ? available.reduce((s, x) => s + (x.value as number) * (x.weight / availWeight), 0) * statBudget
    : 0;
  return (statScore + parts.placementBonus * WEIGHTS.placement) * 100;
}

// Per-round KDA impact proxy mapped onto the 0.8–1.4 rating band.
function ratingProxy(stat: MatchPlayerStat, rounds: number): number {
  if (rounds <= 0) return 1;
  return 1 + (stat.kills + 0.5 * stat.assists - stat.deaths) / rounds;
}

// KAST may be stored as a percent (0–100) or fraction; normalize to fraction.
function kastFraction(v: number): number {
  return v > 1 ? v / 100 : v;
}

// Collect every player's per-map samples across the scoped stages, deduped by
// match+map+player, plus each team's total map count (for eligibility).
function collectSamples(t: Tournament, scope: MvpStageScope): {
  players: Map<string, { sample: MatchPlayerStat; samples: MapSample[] }>;
  teamMaps: Map<string, number>;
} {
  const stages = getStageOptions(t).filter(s => scope === 'all' || s.id !== 'stage1');
  const players = new Map<string, { sample: MatchPlayerStat; samples: MapSample[] }>();
  const teamMaps = new Map<string, number>();
  const seen = new Set<string>();
  const seenTeamMap = new Set<string>();
  for (const stage of stages) {
    for (const bracket of stage.brackets) {
      for (const match of bracket.rounds.flat()) {
        for (const map of match.maps ?? []) {
          const rounds = map.roundFlow?.length || map.team1Score + map.team2Score;
          const multiplier = stageMultiplierFor(bracket, match);
          for (const ps of map.playerStats ?? []) {
            const key = `${match.id}|${map.mapName}|${ps.playerId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const tmKey = `${match.id}|${map.mapName}|${ps.teamId}`;
            if (!seenTeamMap.has(tmKey)) {
              seenTeamMap.add(tmKey);
              teamMaps.set(ps.teamId, (teamMaps.get(ps.teamId) ?? 0) + 1);
            }
            const cur = players.get(ps.playerId) ?? { sample: ps, samples: [] };
            cur.samples.push({ stat: ps, multiplier, rounds });
            players.set(ps.playerId, cur);
          }
        }
      }
    }
  }
  return { players, teamMaps };
}

// Resolve a stat row to a roster slot id so /player links work.
function resolveRosterId(t: Tournament, sample: MatchPlayerStat): string {
  const team = t.teams.find(tm => tm.id === sample.teamId);
  const hit = team?.players.find(p => statMatchesPlayer(sample, p))
    ?? t.teams.flatMap(tm => tm.players).find(p => statMatchesPlayer(sample, p));
  return hit?.id ?? sample.playerId;
}

// Full MVP ranking for a tournament, best score first. Empty when no player
// stats are recorded. Honors the organizer's stage scope (two-stage events
// can score MVP on Stage 2 only via tournament.mvpStageScope).
export function calculateTournamentMvpRankings(t: Tournament): MvpResult[] {
  const scope: MvpStageScope = t.mvpStageScope === 'stage2' && t.stage2Bracket ? 'stage2' : 'all';
  const { players, teamMaps } = collectSamples(t, scope);
  if (players.size === 0) return [];

  const teamNameById: Record<string, string> = {};
  t.teams.forEach(tm => { teamNameById[tm.id] = tm.name; });

  const build = (minMaps: number): MvpResult[] => {
    const out: MvpResult[] = [];
    for (const { sample, samples } of players.values()) {
      const tm = teamMaps.get(sample.teamId) ?? 0;
      // Eligible: at least minMaps maps AND 60% of the team's maps.
      if (samples.length < Math.max(minMaps, Math.ceil(tm * 0.6))) continue;

      const weightedACS = calculateWeightedAverage(samples, s => s.stat.acs) ?? 0;
      const weightedRating = calculateWeightedAverage(samples, s => ratingProxy(s.stat, s.rounds)) ?? 1;
      const weightedADR = calculateWeightedAverage(samples, s => s.stat.adr || undefined);
      const weightedKAST = calculateWeightedAverage(
        samples, s => s.stat.kast ? kastFraction(s.stat.kast) : undefined,
      );
      const weightedEntryImpact = calculateWeightedAverage(
        samples,
        s => (s.stat.fk !== undefined && s.stat.fd !== undefined && s.rounds > 0)
          ? calculateEntryImpact(s.stat.fk, s.stat.fd, s.rounds)
          : undefined,
      );

      const acsNorm = normalizeStat(weightedACS, NORM_RANGES.acs.min, NORM_RANGES.acs.max);
      const ratingNorm = normalizeStat(weightedRating, NORM_RANGES.rating.min, NORM_RANGES.rating.max);
      const adrNorm = weightedADR === null ? null
        : normalizeStat(weightedADR, NORM_RANGES.adr.min, NORM_RANGES.adr.max);
      const kastNorm = weightedKAST === null ? null
        : normalizeStat(weightedKAST, NORM_RANGES.kast.min, NORM_RANGES.kast.max);
      const entryNorm = weightedEntryImpact === null ? null
        : normalizeStat(weightedEntryImpact, NORM_RANGES.entry.min, NORM_RANGES.entry.max);

      const placementBonus = calculatePlacementBonus(computePlacement(t, sample.teamId));
      const mvpScore = calculateMVPScore({ ratingNorm, acsNorm, adrNorm, kastNorm, entryNorm, placementBonus });

      out.push({
        playerId: sample.playerId,
        rosterId: resolveRosterId(t, sample),
        name: sample.playerName,
        teamId: sample.teamId,
        teamName: teamNameById[sample.teamId] ?? '',
        mapsPlayed: samples.length,
        weightedACS, weightedADR, weightedRating, weightedKAST, weightedEntryImpact,
        acsNorm, adrNorm, ratingNorm, kastNorm, entryNorm,
        placementBonus, mvpScore,
      });
    }
    return out.sort((a, b) => b.mvpScore - a.mvpScore);
  };

  // Standard floor is 4 maps; if a short event leaves nobody eligible
  // (e.g. bo1 single elim), relax the floor so an MVP can still be named.
  const ranked = build(4);
  return ranked.length > 0 ? ranked : build(2);
}

// The tournament MVP: top of the rankings, or null when undeterminable.
export function calculateTournamentMvp(t: Tournament): MvpResult | null {
  return calculateTournamentMvpRankings(t)[0] ?? null;
}

// Shown beside every Tournament MVP badge.
export const MVP_INFO_TEXT =
  'MVP scored on ACS, Rating, ADR, KAST, entry impact, playoff stage weight, and final placement with min-max normalization.';
