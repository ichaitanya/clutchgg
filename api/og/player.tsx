// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Open Graph card for a player profile.
//
// Renders a vibrant, on-theme 1200×630 share card (the image social platforms
// show when a /player/:tid/:pid link is pasted). Runs on Vercel's Edge runtime
// via @vercel/og (Satori). It fetches the tournaments blob straight from
// Supabase's public REST endpoint (anon-readable, same data the SPA reads) and
// re-derives the player's career stats + achievement badges server-side, so the
// card is accurate for ANY link — not just ones generated from the app.
//
// URL: /api/og/player?tid=<tournamentId>&pid=<playerId>
// ─────────────────────────────────────────────────────────────────────────────
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

// Public Supabase project — same URL + anon key the browser client uses
// (src/app/services/supabase.ts). The anon key is a public credential; reads are
// gated by RLS, and tournaments_blob is anon-readable.
const SUPABASE_URL = 'https://atjongzdifyjnzkbqyoc.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0am9uZ3pkaWZ5am56a2JxeW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTYzNzUsImV4cCI6MjA5NTg5MjM3NX0.wfoor7uOkbooSt01NJGrqTxWRjPSgPzN8K5tgFG5nzY';

const ACCENT = '#ff4655';
const BG = '#0e0e0e';
const SURFACE = '#161616';

// ── Riot-ID normalization (ported from src/app/utils/riotId.ts) ──────────────
function normalizeRiotId(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\s*#\s*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
function normalizeRiotName(s: string): string {
  return normalizeRiotId(s).split('#')[0];
}

// Whether two roster entries are the same person (Riot-ID first, name fallback).
// Mirrors samePlayerIdentity in PlayerPage.tsx, on the loosely-typed blob.
function riotIds(p: any): string[] {
  const out: string[] = [];
  if (p?.riotId) out.push(normalizeRiotId(p.riotId));
  for (const al of p?.nameHistory ?? []) if (al?.riotId) out.push(normalizeRiotId(al.riotId));
  return out.filter(Boolean);
}
function samePlayer(a: any, b: any): boolean {
  if (a?.id && a.id === b?.id) return true;
  const aIds = riotIds(a), bIds = riotIds(b);
  if (aIds.length && bIds.length) return aIds.some(id => bIds.includes(id));
  const names = (p: any) => {
    const out = [normalizeRiotName(p?.name ?? '')];
    for (const al of p?.nameHistory ?? []) if (al?.name) out.push(normalizeRiotName(al.name));
    return out.filter(Boolean);
  };
  const an = names(a), bn = names(b);
  return an.some(n => bn.includes(n));
}

function statMatchesPlayer(stat: any, player: any): boolean {
  if (stat?.playerId && stat.playerId === player?.id) return true;
  const pid = normalizeRiotId(stat?.playerId ?? '');
  const pidName = normalizeRiotName(stat?.playerId ?? '');
  const pname = normalizeRiotId(stat?.playerName ?? '');
  const idMatches = (ref?: string) => {
    if (!ref) return false;
    const n = normalizeRiotId(ref);
    const nName = normalizeRiotName(ref);
    return pid === n || pname === n || pidName === nName || pname === nName;
  };
  if (idMatches(player?.riotId) || idMatches(player?.name)) return true;
  for (const al of player?.nameHistory ?? []) if (idMatches(al?.riotId) || idMatches(al?.name)) return true;
  return false;
}

// All bracket containers in a tournament blob (single + two-stage).
function bracketsOf(t: any): any[] {
  return [t?.generatedBracket, t?.stage1Bracket, t?.stage2Bracket].filter(Boolean);
}
function flatMatches(bracket: any): any[] {
  return (bracket?.rounds ?? []).flat();
}

// Minimal placement signal for badges: did this team win / runner-up the final
// stage's grand final? (Full computePlacement also derives "Top N" — not needed
// for the card's Champion/Finalist badges.)
function placementRank(t: any, teamId: string): number | null {
  const finalStage = t?.stage2Bracket || t?.generatedBracket;
  const rounds = finalStage?.rounds ?? [];
  if (!rounds.length) return null;
  const lastRound = rounds[rounds.length - 1];
  const gf = lastRound?.[lastRound.length - 1];
  if (gf?.winner) {
    if (gf.winner === teamId) return 1;
    if (gf.team1Id === teamId || gf.team2Id === teamId) return 2;
  }
  return null;
}

interface Career {
  name: string;
  team: string;
  photo?: string;
  mapsPlayed: number;
  matches: number;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;
  hsPercent: number;
  kd: number;
  agents: string[];      // most-played first
  peakKills: number;
  titles: number;        // tournaments won
  finals: number;        // runner-up finishes
  completedEvents: number;
}

// Re-derive the player's unified career across every tournament/team where they
// appear (matched by Riot-ID identity), mirroring PlayerPage's useMemo.
function deriveCareer(tournaments: any[], playerId: string): Career | null {
  // Locate the player to seed identity.
  let seed: any = null;
  for (const t of tournaments) {
    for (const tm of t?.teams ?? []) {
      const p = (tm?.players ?? []).find((p: any) => p?.id === playerId);
      if (p) { seed = p; break; }
    }
    if (seed) break;
  }
  if (!seed) return null;

  let mapsPlayed = 0, kills = 0, deaths = 0, assists = 0, acsSum = 0, hsSum = 0, peakKills = 0;
  let titles = 0, finals = 0, completedEvents = 0;
  let team = '', photo: string | undefined;
  const matchIds = new Set<string>();
  const seenMap = new Set<string>();
  const agentCounts = new Map<string, number>();
  let latestActivity = -Infinity;

  for (const t of tournaments) {
    for (const tm of t?.teams ?? []) {
      const rosterPlayer = (tm?.players ?? []).find((p: any) => samePlayer(p, seed));
      if (!rosterPlayer) continue;
      if (rosterPlayer.photo && !photo) photo = rosterPlayer.photo;

      let teamPlayedHere = false;
      let eventActivity = t?.event?.startDate ? new Date(t.event.startDate).getTime() || 0 : 0;

      for (const bracket of bracketsOf(t)) {
        for (const match of flatMatches(bracket)) {
          for (const map of match?.maps ?? []) {
            const s = (map?.playerStats ?? []).find((ps: any) => statMatchesPlayer(ps, rosterPlayer));
            if (!s) continue;
            const key = `${match.id}|${map.mapName}`;
            if (seenMap.has(key)) continue;
            seenMap.add(key);
            teamPlayedHere = true;
            mapsPlayed += 1;
            matchIds.add(match.id);
            kills += s.kills ?? 0;
            deaths += s.deaths ?? 0;
            assists += s.assists ?? 0;
            acsSum += s.acs ?? 0;
            hsSum += s.hsPercent ?? 0;
            if ((s.kills ?? 0) > peakKills) peakKills = s.kills ?? 0;
            for (const ag of (s.agent ?? '').split(',').map((x: string) => x.trim()).filter(Boolean)) {
              agentCounts.set(ag, (agentCounts.get(ag) ?? 0) + 1);
            }
            if (match.date) {
              const ms = new Date(`${match.date}T00:00`).getTime();
              if (Number.isFinite(ms)) eventActivity = Math.max(eventActivity, ms);
            }
          }
        }
      }

      if (!teamPlayedHere) continue;

      // Latest stint = the team shown on the card.
      if (eventActivity >= latestActivity) { latestActivity = eventActivity; team = tm.name; }

      // Placement badges only count once a tournament is finished — i.e. its
      // final-stage grand final has a decided winner.
      const finalStage = t?.stage2Bracket || t?.generatedBracket;
      const finalRounds = finalStage?.rounds ?? [];
      const lastRound = finalRounds[finalRounds.length - 1] ?? [];
      const grandFinal = lastRound[lastRound.length - 1];
      if (grandFinal?.winner) {
        completedEvents += 1;
        const rank = placementRank(t, tm.id);
        if (rank === 1) titles += 1;
        else if (rank === 2) finals += 1;
      }
    }
  }

  if (mapsPlayed === 0) return null;

  const agents = [...agentCounts.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  return {
    name: seed.name,
    team,
    photo,
    mapsPlayed,
    matches: matchIds.size,
    kills, deaths, assists,
    acs: acsSum / mapsPlayed,
    hsPercent: hsSum / mapsPlayed,
    kd: deaths > 0 ? kills / deaths : kills,
    agents,
    peakKills,
    titles,
    finals,
    completedEvents,
  };
}

interface CardBadge { label: string; color: string; }

function computeBadges(c: Career): CardBadge[] {
  const out: CardBadge[] = [];
  if (c.titles > 0) out.push({ label: c.titles > 1 ? `${c.titles}× Champion` : 'Champion', color: '#fbbf24' });
  else if (c.finals > 0) out.push({ label: 'Finalist', color: '#cbd5e1' });
  if (c.mapsPlayed >= 5 && c.acs >= 250) out.push({ label: 'Star Fragger', color: ACCENT });
  if (c.mapsPlayed >= 5 && c.kd >= 1.2) out.push({ label: 'Positive K/D', color: '#4ade80' });
  if (c.mapsPlayed >= 5 && c.hsPercent >= 25) out.push({ label: 'Sharpshooter', color: '#60a5fa' });
  if (c.peakKills >= 30) out.push({ label: `${c.peakKills}-Bomb`, color: '#fbbf24' });
  if (c.completedEvents >= 3) out.push({ label: 'Veteran', color: '#cbd5e1' });
  return out.slice(0, 4); // keep the card uncluttered
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (w.length >= 2) return (w[0][0] + w[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// @vercel/og normally auto-loads a default font, but in a standalone (non-Next)
// Vercel edge function that implicit fetch can silently fail and Satori then
// renders an EMPTY image (a 200 with Content-Length: 0). Loading the font
// ourselves and passing it to ImageResponse makes the render deterministic.
// Cached per warm isolate so we fetch it at most once per cold start.
let cachedFont: ArrayBuffer | null = null;
async function loadFont(): Promise<ArrayBuffer | null> {
  if (cachedFont) return cachedFont;
  try {
    // Inter Bold TTF via the fontsource CDN (real TTF, not woff2 — Satori can't
    // use woff2; edge-friendly, no redirect). Covers the Latin glyphs the card uses.
    const res = await fetch(
      'https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf',
    );
    if (!res.ok) return null;
    cachedFont = await res.arrayBuffer();
    return cachedFont;
  } catch {
    return null;
  }
}

async function fetchTournaments(): Promise<any[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tournaments_blob?select=data&order=created_at.asc`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as { data: any }[];
  return rows.map(r => r.data);
}

// A compact stat block (value + label) for the card's stat strip.
function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <div style={{ fontSize: 64, fontWeight: 900, color: accent ? ACCENT : '#fff', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 22, color: '#9a9a9a', letterSpacing: 2, marginTop: 10, textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const pid = searchParams.get('pid') ?? '';
  const debug = searchParams.get('debug') === '1';

  let career: Career | null = null;
  let careerErr = '';
  try {
    if (pid) career = deriveCareer(await fetchTournaments(), pid);
  } catch (e) {
    career = null;
    careerErr = String((e as Error)?.message ?? e);
  }

  const font = await loadFont();

  const name = career?.name ?? 'ClutchGG Player';
  const team = career?.team ?? '';
  const badges = career ? computeBadges(career) : [];
  const acs = career ? Math.round(career.acs).toString() : '—';
  const kd = career ? career.kd.toFixed(2) : '—';
  const hs = career ? `${Math.round(career.hsPercent)}%` : '—';
  const maps = career ? career.mapsPlayed.toString() : '—';

  const card = (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: BG,
          // Vibrant accent glow bleeding from the top-right + a faint vignette.
          backgroundImage: `radial-gradient(900px 600px at 100% 0%, rgba(255,70,85,0.22), transparent 60%), radial-gradient(700px 500px at 0% 100%, rgba(255,70,85,0.10), transparent 55%)`,
          padding: 64,
          fontFamily: font ? 'Inter' : 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Accent top bar */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: ACCENT }} />

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 18, height: 40, background: ACCENT, borderRadius: 4 }} />
          <div style={{ display: 'flex', fontSize: 34, fontWeight: 900, color: '#fff', letterSpacing: 2 }}>
            <span>CLUTCH</span><span style={{ color: ACCENT }}>GG</span>
          </div>
          <div style={{ fontSize: 22, color: '#7a7a7a', letterSpacing: 4, marginLeft: 8, textTransform: 'uppercase' }}>
            Player Card
          </div>
        </div>

        {/* Identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, marginTop: 48 }}>
          <div
            style={{
              width: 168,
              height: 168,
              borderRadius: 24,
              border: `3px solid ${ACCENT}`,
              background: SURFACE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              boxShadow: '0 0 0 8px rgba(255,70,85,0.12)',
            }}
          >
            {/* Only embed the photo if it's an absolute http(s) URL — Satori
                throws on relative/data sources it can't fetch, which would blank
                the whole card. Anything else falls back to initials. */}
            {career?.photo && /^https?:\/\//.test(career.photo)
              ? <img src={career.photo} width={168} height={168} style={{ objectFit: 'cover' }} />
              : <div style={{ fontSize: 72, fontWeight: 900, color: '#777' }}>{initials(name)}</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 78, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{name}</div>
            {team ? (
              <div style={{ fontSize: 30, color: '#bdbdbd', marginTop: 14 }}>{team}</div>
            ) : null}
          </div>
        </div>

        {/* Stat strip */}
        <div
          style={{
            display: 'flex',
            marginTop: 'auto',
            background: 'rgba(22,22,22,0.85)',
            border: '1px solid #262626',
            borderRadius: 20,
            padding: '34px 24px',
          }}
        >
          <Stat value={acs} label="ACS" accent />
          <div style={{ width: 1, background: '#2a2a2a', margin: '0 8px' }} />
          <Stat value={kd} label="K/D" />
          <div style={{ width: 1, background: '#2a2a2a', margin: '0 8px' }} />
          <Stat value={hs} label="HS%" />
          <div style={{ width: 1, background: '#2a2a2a', margin: '0 8px' }} />
          <Stat value={maps} label="Maps" />
        </div>

        {/* Achievement badges */}
        {badges.length > 0 ? (
          <div style={{ display: 'flex', gap: 14, marginTop: 26, flexWrap: 'wrap' }}>
            {badges.map(b => (
              <div
                key={b.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 26,
                  fontWeight: 700,
                  color: b.color,
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${b.color}`,
                  borderRadius: 999,
                  padding: '10px 22px',
                }}
              >
                {b.label}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', marginTop: 26, fontSize: 24, color: '#7a7a7a' }}>
            View the full profile on clutchgg.gg
          </div>
        )}
      </div>
  );

  const fonts = font
    ? [{ name: 'Inter', data: font, weight: 700 as const, style: 'normal' as const }]
    : undefined;

  // ── Diagnostic mode: /api/og/player?...&debug=1 renders the REAL card and
  // materializes the body so a Satori layout failure surfaces as readable text
  // instead of a silent empty PNG. Remove once the card renders.
  if (debug) {
    let renderErr = '';
    let bytes = -1;
    try {
      const probe = new ImageResponse(card, { width: 1200, height: 630, fonts });
      bytes = (await probe.arrayBuffer()).byteLength;
    } catch (e) {
      renderErr = String((e as Error)?.stack ?? (e as Error)?.message ?? e);
    }
    return new Response(
      JSON.stringify(
        { pid, fontLoaded: !!font, careerFound: !!career, careerErr, renderedBytes: bytes, renderErr },
        null, 2,
      ),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    fonts,
    // Don't let a transient empty/failed render get cached for a year. Only
    // cache aggressively when we actually produced a real card (font loaded).
    headers: font
      ? { 'Cache-Control': 'public, immutable, no-transform, max-age=31536000' }
      : { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
  });
}
