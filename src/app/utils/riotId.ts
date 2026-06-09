// Canonical normalization for Riot IDs and display names used in matching.
//
// Riot IDs entered via spreadsheet upload are messy in practice: trailing/leading
// spaces, a stray space before the "#" ("AE Slash #ESNN"), trailing carriage
// returns from CSV line endings ("Ben#BOT001\r"), full-width vs half-width CJK,
// and inconsistent case. The Valorant API returns the clean form ("AESlash#ESNN"
// style, name + tag separated by "#"). If the comparison isn't normalized
// identically on BOTH sides, a player silently fails to match — which is why a
// team's scoreboard sometimes showed "2/5" instead of "5/5".
//
// `normalizeRiotId` is the single source of truth: apply it wherever a roster
// entry or API player is compared, so both sides collapse to the same string.
export function normalizeRiotId(s: string): string {
  return s
    .normalize('NFKC')        // width/encoding variants of CJK & symbols → canonical
    .replace(/\s*#\s*/g, '#') // kill any spaces around the name#tag separator
    .replace(/\s+/g, ' ')     // collapse runs of whitespace (incl. \r, \n, tabs)
    .trim()
    .toLowerCase();
}

// The bare name portion (before the "#"), normalized. Used when a roster entry is
// a plain display name rather than a full Riot ID.
export function normalizeRiotName(s: string): string {
  return normalizeRiotId(s).split('#')[0];
}

// Two identifiers match if their full normalized forms are equal, or if either
// side is a bare name that equals the other's name portion.
export function riotIdsMatch(a: string, b: string): boolean {
  const na = normalizeRiotId(a);
  const nb = normalizeRiotId(b);
  if (na === nb) return true;
  return normalizeRiotName(a) === normalizeRiotName(b);
}
