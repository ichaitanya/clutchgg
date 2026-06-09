// Roster display ordering helpers.
//
// Players should always lead with the IGL (in-game leader) so the team's caller
// is the first tile/row everywhere a roster is shown. The rest keep their
// original spreadsheet/admin order (which is otherwise meaningful — main five
// before substitutes, etc.). This is a stable reorder: only the first IGL is
// lifted to the front; everything else stays put.
export function orderRosterIglFirst<T extends { role?: string }>(players: T[]): T[] {
  const iglIndex = players.findIndex(p => p.role === 'igl');
  if (iglIndex <= 0) return players; // no IGL, or already first
  const copy = players.slice();
  const [igl] = copy.splice(iglIndex, 1);
  copy.unshift(igl);
  return copy;
}
