import type { BracketGenerated, BracketMatch } from '../components/TournamentCreation';

// Human round label for a match, derived from where it sits in the bracket:
// "Grand Final", "WB Final", "LB Quarter Finals", "Semi Finals", "WB Round 1"…
// Returns null when the bracket shape doesn't yield one (round robin, match
// not found), so callers can fall back to their stage label.
export function bracketRoundLabel(
  bracket: BracketGenerated | undefined,
  match: BracketMatch,
): string | null {
  if (!bracket?.rounds?.length) return null;
  // Round robin has no road-to-final shape — keep the caller's stage/group label.
  if (bracket.bracketType === 'roundrobin') return null;

  const sectionOf = (r: BracketMatch[]) => r[0]?.bracketSection ?? 'winners';
  const isDouble = bracket.rounds.flat().some(m => m.bracketSection === 'losers');
  const winners = bracket.rounds.filter(r => r.length > 0 && sectionOf(r) === 'winners');
  const losers = bracket.rounds.filter(r => r.length > 0 && sectionOf(r) === 'losers');
  const grandFinal = bracket.rounds.filter(r => r.length > 0 && sectionOf(r) === 'grand-final');

  if (grandFinal.some(r => r.some(m => m.id === match.id))) return 'Grand Final';

  // Name a round by its distance from that section's final.
  const name = (idx: number, total: number, prefix: string): string => {
    const fromEnd = total - 1 - idx;
    const base =
      fromEnd === 0 ? 'Final'
      : fromEnd === 1 ? 'Semi Finals'
      : fromEnd === 2 ? 'Quarter Finals'
      : `Round ${idx + 1}`;
    return prefix ? `${prefix} ${base}` : base;
  };

  const wIdx = winners.findIndex(r => r.some(m => m.id === match.id));
  if (wIdx >= 0) return name(wIdx, winners.length, isDouble ? 'WB' : '');
  const lIdx = losers.findIndex(r => r.some(m => m.id === match.id));
  if (lIdx >= 0) return name(lIdx, losers.length, 'LB');
  return null;
}
