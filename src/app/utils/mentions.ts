import type { Tournament } from '../components/TournamentCreation';

// A linkable entity (team or player) discovered in the tournaments DB.
export interface MentionEntity {
  kind: 'team' | 'player';
  name: string;
  tournamentId: string;
  id: string;        // team id or player id
  teamName?: string; // for players, their team (disambiguation in the picker)
  // The route this mention links to.
  href: string;
}

// Build the list of mentionable teams and players across all tournaments.
// Deduplicated by (kind + lowercased name) so the picker isn't cluttered with the
// same person appearing in multiple tournaments — the first occurrence wins.
export function buildMentionIndex(tournaments: Tournament[]): MentionEntity[] {
  const out: MentionEntity[] = [];
  const seen = new Set<string>();

  for (const t of tournaments) {
    for (const team of t.teams) {
      const teamKey = `team:${team.name.trim().toLowerCase()}`;
      if (team.name.trim() && !seen.has(teamKey)) {
        seen.add(teamKey);
        out.push({
          kind: 'team',
          name: team.name,
          tournamentId: t.id,
          id: team.id,
          href: `/teams/${team.id}`,
        });
      }
      for (const player of team.players) {
        if (!player.name.trim()) continue;
        const playerKey = `player:${player.name.trim().toLowerCase()}`;
        if (seen.has(playerKey)) continue;
        seen.add(playerKey);
        out.push({
          kind: 'player',
          name: player.name,
          tournamentId: t.id,
          id: player.id,
          teamName: team.name,
          href: `/player/${t.id}/${player.id}`,
        });
      }
    }
  }
  return out;
}

// ── Explicit mention tokens ─────────────────────────────────────────────────
// Inserted by the @-picker. Shape: @[Display Name](kind:tournamentId:id)
// where kind is "team" | "player". Display name may contain spaces but not ']'.

const TOKEN_RE = /@\[([^\]]+)\]\((team|player):([^:]+):([^)]+)\)/g;

// Inserted by the @-picker. We insert the plain display name (no noisy token):
// the renderer's name-based auto-linking turns it into the right link, and the
// mention index is deduped by name so there's no ambiguity. (Legacy explicit
// @[..](..) tokens are still parsed by parseMentions for older articles.)
export function makeMentionToken(e: MentionEntity): string {
  return e.name;
}

// A rendered segment: either plain text or a link.
export type TextSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string };

// Parse paragraph text into segments. Resolves:
//  1) explicit @[..](kind:tid:id) tokens → links
//  2) plain occurrences of known team/player names → links (whole-word, case-insensitive)
// Explicit tokens take priority; plain-name auto-linking runs on the remaining text.
export function parseMentions(text: string, index: MentionEntity[]): TextSegment[] {
  // First, split out explicit tokens.
  const segments: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const [full, label, kind, tournamentId, id] = m;
    const start = m.index ?? 0;
    if (start > last) segments.push({ type: 'text', text: text.slice(last, start) });
    const href = kind === 'team' ? `/teams/${id}` : `/player/${tournamentId}/${id}`;
    segments.push({ type: 'link', text: label, href });
    last = start + full.length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });

  // Then auto-link plain names inside the text-only segments.
  if (index.length === 0) return segments;

  // Longest names first so "Paper Rex" wins over "Paper".
  const sorted = [...index].sort((a, b) => b.name.length - a.name.length);

  const autoLink = (chunk: string): TextSegment[] => {
    const result: TextSegment[] = [];
    let i = 0;
    const lower = chunk.toLowerCase();
    while (i < chunk.length) {
      let matched: MentionEntity | null = null;
      for (const e of sorted) {
        const name = e.name.toLowerCase();
        if (!name) continue;
        if (lower.startsWith(name, i)) {
          // Whole-word boundaries (don't link inside a larger word).
          const before = i === 0 ? ' ' : chunk[i - 1];
          const after = chunk[i + name.length] ?? ' ';
          const isWord = (c: string) => /[a-z0-9]/i.test(c);
          if (!isWord(before) && !isWord(after)) { matched = e; break; }
        }
      }
      if (matched) {
        result.push({ type: 'link', text: chunk.slice(i, i + matched.name.length), href: matched.href });
        i += matched.name.length;
      } else {
        // Accumulate plain text one char at a time, merging with previous text seg.
        const prev = result[result.length - 1];
        if (prev && prev.type === 'text') prev.text += chunk[i];
        else result.push({ type: 'text', text: chunk[i] });
        i++;
      }
    }
    return result;
  };

  const final: TextSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'text') final.push(...autoLink(seg.text));
    else final.push(seg);
  }
  return final;
}
