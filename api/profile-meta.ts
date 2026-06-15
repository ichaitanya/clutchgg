// ─────────────────────────────────────────────────────────────────────────────
// Open Graph meta-tag injector for player profile links.
//
// A Vite SPA serves the same static index.html for every route, so crawlers
// (Discord, Twitter/X, iMessage, Slack, …) never see player-specific tags. This
// function is the rewrite target for /player/:tid/:pid (see vercel.json): it
// returns index.html with per-player <meta og:*> / <meta twitter:*> tags
// injected, pointing og:image at /api/og/player (the generated card). Humans get
// the same HTML and the SPA boots normally — the injected tags are inert to them.
//
// Querystring (supplied by the vercel.json rewrite): ?tid=<id>&pid=<id>
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = 'https://atjongzdifyjnzkbqyoc.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0am9uZ3pkaWZ5am56a2JxeW9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTYzNzUsImV4cCI6MjA5NTg5MjM3NX0.wfoor7uOkbooSt01NJGrqTxWRjPSgPzN8K5tgFG5nzY';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Just the player's display name — enough for og:title. The card image itself
// re-derives the full stats independently in /api/og/player.
async function fetchPlayerName(pid: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tournaments_blob?select=data&order=created_at.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { data: any }[];
    for (const row of rows) {
      for (const tm of row.data?.teams ?? []) {
        const p = (tm?.players ?? []).find((pl: any) => pl?.id === pid);
        if (p?.name) return p.name as string;
      }
    }
  } catch {
    /* fall through to generic title */
  }
  return null;
}

// Read the built index.html once per cold start (it's in the deployment output).
let cachedHtml: string | null = null;
function indexHtml(): string {
  if (cachedHtml) return cachedHtml;
  // Vercel includes the build output under the function's working dir; index.html
  // sits at the project root of the deployment.
  for (const candidate of ['index.html', 'public/index.html', 'dist/index.html']) {
    try {
      cachedHtml = readFileSync(join(process.cwd(), candidate), 'utf8');
      return cachedHtml;
    } catch {
      /* try next */
    }
  }
  // Minimal fallback bootstrap if the file can't be located.
  cachedHtml =
    '<!doctype html><html><head><meta charset="utf-8"/></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
  return cachedHtml;
}

export default async function handler(req: any, res: any) {
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'clutchgg.gg') as string;
  const proto = (req.headers['x-forwarded-proto'] || 'https') as string;
  const origin = `${proto}://${host}`;

  const tid = (Array.isArray(req.query.tid) ? req.query.tid[0] : req.query.tid) || '';
  const pid = (Array.isArray(req.query.pid) ? req.query.pid[0] : req.query.pid) || '';

  const name = (pid && (await fetchPlayerName(pid))) || 'Player Profile';
  const title = `${name} · ClutchGG`;
  const description = `${name}'s competitive Valorant profile — stats, achievements and match history on ClutchGG.`;
  const imageUrl = `${origin}/api/og/player?tid=${encodeURIComponent(tid)}&pid=${encodeURIComponent(pid)}`;
  const pageUrl = `${origin}/player/${encodeURIComponent(tid)}/${encodeURIComponent(pid)}`;

  const tags = `
    <meta property="og:type" content="profile" />
    <meta property="og:site_name" content="ClutchGG" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  `.trim();

  // Inject the tags into <head> (replace the static <title> too so unfurls and
  // browser tabs both show the player name).
  let html = indexHtml().replace(/<title>.*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = html.replace(/<\/head>/i, `${tags}\n</head>`);

  // Short CDN cache so repeated crawls + shares are fast, but stats stay current.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
}
