import type { Tournament, BracketMatch, BracketGenerated } from '../components/TournamentCreation';

export type TournamentStatus = Tournament['status']; // 'planning' | 'registration' | 'in-progress' | 'completed'

// Has a series been decided by its map results? In a BOn a team needs
// ceil(maxMaps/2) map wins (e.g. 2 in a BO3). Also treats an all-maps-played
// result as decided.
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

// A match is "complete" when it has a recorded winner or a map-decided result.
function isMatchComplete(match: BracketMatch): boolean {
  return !!match.winner || isMatchDecidedByMaps(match);
}

// A match has "started" when it's complete OR has any map score entered OR its
// scheduled date/time is in the past.
function hasMatchStarted(match: BracketMatch): boolean {
  if (isMatchComplete(match)) return true;
  if ((match.maps ?? []).some(m => m.team1Score > 0 || m.team2Score > 0)) return true;
  if (match.date) {
    try {
      const when = new Date(`${match.date}T${match.time || '00:00'}`).getTime();
      if (when <= Date.now()) return true;
    } catch { /* ignore */ }
  }
  return false;
}

// Flatten all real matches in a bracket. A "real" match is one with both teams
// assigned (skip placeholder/empty bracket slots so completion isn't blocked by
// unfilled future rounds that will be auto-populated).
function bracketMatches(b?: BracketGenerated): BracketMatch[] {
  if (!b) return [];
  return b.rounds.flat();
}

// Every bracket that makes up the tournament, in stage order.
// stage 1 = group/stage1 + legacy single-stage; stage 2 = stage2Bracket.
function tournamentStages(t: Tournament): BracketGenerated[][] {
  const stage1: BracketGenerated[] = [];
  if (t.generatedBracket) stage1.push(t.generatedBracket);
  if (t.stage1Bracket) stage1.push(t.stage1Bracket);

  const stage2: BracketGenerated[] = [];
  if (t.stage2Bracket) stage2.push(t.stage2Bracket);

  const stages: BracketGenerated[][] = [];
  if (stage1.length) stages.push(stage1);
  if (stage2.length) stages.push(stage2);
  return stages;
}

// Does the tournament have a generated schedule (any bracket at all)?
function hasSchedule(t: Tournament): boolean {
  return tournamentStages(t).length > 0;
}

// Has the tournament's scheduled start arrived?
function hasStartArrived(t: Tournament): boolean {
  const start = t.event?.startDate;
  if (!start) return false;
  try {
    return new Date(`${start}T00:00`).getTime() <= Date.now();
  } catch {
    return false;
  }
}

/**
 * Derive a tournament's live status from its data, per these rules:
 *  - registration: teams added but schedule not generated, or start date not yet reached
 *  - planning:     start date reached, schedule exists, but no match has started
 *  - in-progress:  at least one match has started / has a result, but not all complete
 *  - completed:    every match across every stage is complete
 *                  (two-stage → both stages must be complete)
 *
 * Returns the tournament's manually-set status when there isn't enough data to
 * compute (e.g. no teams yet), so admin intent is preserved during setup.
 */
export function deriveTournamentStatus(t: Tournament): TournamentStatus {
  const stages = tournamentStages(t);

  // No teams and no schedule → fall back to whatever the admin set.
  const hasTeams = (t.teams?.length ?? 0) > 0;
  if (!hasTeams && stages.length === 0) return t.status;

  // Collect every real match across all stages (both teams must be assigned).
  const allMatches = stages.flat().flatMap(bracketMatches)
    .filter(m => m.team1Id && m.team2Id);

  // Match results are ground truth — check them BEFORE any date/schedule gate.
  // This handles cases where no start date was set or date is in the future
  // but matches have already been played.
  if (allMatches.length > 0) {
    const everyComplete = allMatches.every(isMatchComplete);
    if (everyComplete) return 'completed';

    const anyStarted = allMatches.some(hasMatchStarted);
    if (anyStarted) return 'in-progress';
  }

  // No match evidence yet — use schedule/date to decide registration vs planning.
  if (!hasSchedule(t) || !hasStartArrived(t)) {
    return 'registration';
  }

  // Schedule generated, start date reached, but no matches have kicked off yet.
  return 'planning';
}
