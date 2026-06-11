// Shared, dependency-light derivations over tournament/bracket data.
//
// These live here (rather than inside TournamentPage) so the home page and the
// HeroSection can reuse them without importing the heavy, lazy-loaded
// TournamentPage module. Everything here is pure and operates only on the
// Tournament/BracketMatch shapes — no React, no data loading.
import type { Tournament, BracketMatch } from '../components/TournamentCreation';

// A bracket slot isn't a real, listable team until it names an actual roster
// (skip "TBD", "Winner of …", empty seats, etc.).
export function isTeamSlotName(name: string): boolean {
  return !name || name === 'Select Team' || name.startsWith('Team Slot') || name === 'TBD' ||
    name.startsWith('Winner') || name.startsWith('Loser') ||
    name === 'LB TBD' || name === 'WB Champion' || name === 'LB Champion';
}

// Has a series been decided by its map results? In a BOn a team needs
// ceil(maxMaps/2) map wins; an all-maps-played result with a leader also counts.
export function isMatchDecidedByMaps(match: BracketMatch): boolean {
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

// Winner-aware status: a recorded winner or a map-decided result is completed
// regardless of the scheduled date; otherwise fall back to the date window.
export function effectiveStatus(m: BracketMatch): 'upcoming' | 'live' | 'completed' {
  if (m.winner || isMatchDecidedByMaps(m)) return 'completed';
  return getMatchStatus(m.date, m.time);
}

// Series score (map wins per side). Falls back to a 1-0 from the recorded
// winner when no maps were entered.
export function deriveScore(m: BracketMatch): { s1: number; s2: number } {
  const maps = m.maps ?? [];
  if (maps.length === 0) {
    return {
      s1: m.winner === m.team1Id ? 1 : 0,
      s2: m.winner === m.team2Id ? 1 : 0,
    };
  }
  let s1 = 0, s2 = 0;
  for (const map of maps) {
    if (map.team1Score > map.team2Score) s1++;
    else if (map.team2Score > map.team1Score) s2++;
  }
  return { s1, s2 };
}

// Last N series results (chronological bracket order) for one team — the W/L
// form dots. Each entry carries the opponent's name for tooltips.
export function teamForm(
  matches: { match: BracketMatch; status: string }[],
  teamId: string,
  n = 3,
): { won: boolean; opponent: string }[] {
  const out: { won: boolean; opponent: string }[] = [];
  for (const { match: m, status } of matches) {
    if (status !== 'completed') continue;
    const isT1 = m.team1Id === teamId;
    const isT2 = m.team2Id === teamId;
    if (!isT1 && !isT2) continue;
    const { s1, s2 } = deriveScore(m);
    if (s1 === s2) continue;
    out.push({
      won: isT1 ? s1 > s2 : s2 > s1,
      opponent: isT1 ? m.team2Name : m.team1Name,
    });
  }
  return out.slice(-n);
}

// Round-by-round progress of the final stage bracket, for a progress stepper.
// Round-robin has no meaningful "rounds to a final" → empty.
export function deriveStageProgress(t: Tournament): { label: string; done: boolean }[] {
  const b = t.stage2Bracket || t.generatedBracket;
  if (!b?.rounds?.length || b.bracketType === 'roundrobin') return [];

  const isDouble = b.rounds.flat().some(m => m.bracketSection === 'losers');
  // Track the winners-side path to the title (plus the grand final for double
  // elim) — the losers bracket runs in parallel and would clutter the stepper.
  const mainRounds = b.rounds.filter(r =>
    r.length > 0 && (!isDouble || !r[0].bracketSection || r[0].bracketSection === 'winners'),
  );
  const gfRounds = isDouble
    ? b.rounds.filter(r => r.length > 0 && r[0].bracketSection === 'grand-final')
    : [];

  const n = mainRounds.length;
  const labelFor = (i: number): string => {
    const fromEnd = n - 1 - i;
    if (fromEnd === 0) return isDouble ? 'WB Final' : 'Final';
    if (fromEnd === 1) return 'Semi Finals';
    if (fromEnd === 2) return 'Quarter Finals';
    return `Round ${i + 1}`;
  };

  const steps = mainRounds.map((round, i) => ({
    label: labelFor(i),
    done: round.every(m => !!m.winner),
  }));
  for (const r of gfRounds) {
    steps.push({ label: 'Grand Final', done: r.every(m => !!m.winner) });
  }
  return steps.length > 1 ? steps : [];
}

