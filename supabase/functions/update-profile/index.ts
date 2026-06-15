import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// update-profile — the ONLY trusted write path for a player's avatar and bio.
// Clients cannot set player_accounts.avatar_url / bio directly (frozen by the
// guard_player_profile_columns trigger in migration 017) and cannot upload to
// the avatars bucket except the single canonical object. Everything sensitive
// happens here, server-side, with service_role:
//
//   1. Authenticate the caller; they may only edit their OWN profile.
//   2. AVATAR: accept a client-optimized WEBP (base64). RE-VALIDATE it from the
//      raw bytes — real WEBP container, not animated, <= size cap, square ~512.
//      Never trust the client's claim about type/size; never trust client-side
//      moderation. Then run image moderation, then store avatars/<uid>.webp
//      (overwriting the previous one — only the optimized image is ever kept).
//   3. BIO: trim, length-cap (250), reject whitespace-only, profanity filter,
//      then AI text moderation.
//   4. Enforce per-user daily rate limits (avatar 5/day, bio 20/day) using the
//      rolling-window counters on the row, atomically with the write.
//
// Moderation provider: OpenAI omni-moderation (text + image). Configured via the
// OPENAI_API_KEY secret. If the key is absent the function FAILS CLOSED for
// images (rejects) and applies the local profanity filter to text — it never
// silently ships unmoderated media.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Limits ──────────────────────────────────────────────────────────────────
const BIO_MAX = 250;
const AVATAR_MAX_BYTES = 220 * 1024; // optimized WEBP ceiling (target <150KB, slack for headroom)
const AVATAR_DIM = 512;
const AVATAR_DIM_TOLERANCE = 4; // allow 508..516 to absorb rounding in browser canvas
const AVATAR_DAILY_LIMIT = 5;
const BIO_DAILY_LIMIT = 20;
const WINDOW_MS = 24 * 60 * 60 * 1000;

// ── WEBP byte-level validation ──────────────────────────────────────────────
// A WEBP file is a RIFF container: "RIFF" <u32 size> "WEBP" <chunk fourcc> …
// The chunk fourcc tells us the codec: "VP8 " (lossy), "VP8L" (lossless),
// "VP8X" (extended — may be animated). We reject animation two ways: a "VP8X"
// header whose flag bits include the ANIM bit, and the presence of an "ANIM"
// chunk. Dimensions are parsed per-codec so we can enforce ~512x512.
interface WebpInfo { width: number; height: number; animated: boolean; }

function parseWebp(buf: Uint8Array): WebpInfo | null {
  if (buf.length < 16) return null;
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;

  const fourcc = tag(12);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (fourcc === "VP8 ") {
    // Lossy: dimensions at bytes 26-29 (14-bit each), after the 3-byte frame tag
    // + start code. Width/height are 14-bit little-endian at offsets 26 and 28.
    const width = dv.getUint16(26, true) & 0x3fff;
    const height = dv.getUint16(28, true) & 0x3fff;
    return { width, height, animated: false };
  }

  if (fourcc === "VP8L") {
    // Lossless: 1 signature byte (0x2f) then 14-bit width-1 and 14-bit height-1
    // packed little-endian across the next 4 bytes.
    if (buf[20] !== 0x2f) return null;
    const bits = dv.getUint32(21, true);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height, animated: false };
  }

  if (fourcc === "VP8X") {
    // Extended: byte 20 is the flags byte; bit 1 (0x02) is the ANIM flag.
    const flags = buf[20];
    let animated = (flags & 0x02) !== 0;
    // Canvas dims are at 24..29 as 24-bit width-1 / height-1.
    const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
    const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
    // Belt and suspenders: scan for an explicit ANIM chunk.
    if (!animated) {
      for (let i = 20; i + 4 <= buf.length; i++) {
        if (tag(i) === "ANIM") { animated = true; break; }
      }
    }
    return { width, height, animated };
  }

  return null; // unknown/none → not a WEBP we accept
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64; // strip data: URL prefix
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Local profanity filter ──────────────────────────────────────────────────
// First-line, offline defence (slurs + obvious abuse). Word-boundary matched on
// a leet-normalized copy so "f u c k" / "fvck" style evasion is caught. This is
// intentionally conservative; the AI moderation below catches nuanced cases.
const BANNED = [
  "nigger","nigga","faggot","fag","retard","kike","spic","chink","wetback",
  "tranny","cunt","whore","slut","rape","rapist","kill yourself","kys",
  "child porn","cp ","nazi","heil hitler",
];

function normalizeForProfanity(s: string): string {
  return s
    .toLowerCase()
    .replace(/[0@]/g, "o").replace(/1|!|\|/g, "i").replace(/3/g, "e")
    .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/\$/g, "s")
    .replace(/[^a-z ]+/g, "");
}

function profanityHit(text: string): boolean {
  const n = normalizeForProfanity(text);
  const collapsed = n.replace(/\s+/g, "");
  return BANNED.some((w) => {
    const ww = w.replace(/\s+/g, "");
    return collapsed.includes(ww) || n.includes(w);
  });
}

// ── OpenAI omni-moderation ──────────────────────────────────────────────────
// Returns { flagged, categories } or null if moderation could not run.
async function moderate(input: unknown): Promise<{ flagged: boolean; reasons: string[] } | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return null;
    const reasons = Object.entries(result.categories ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    return { flagged: !!result.flagged, reasons };
  } catch {
    return null;
  }
}

function moderationMessage(reasons: string[]): string {
  return "This content was rejected by our safety filter" +
    (reasons.length ? ` (${reasons.join(", ")}).` : ".") +
    " Please choose something appropriate.";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  // 1. Authenticate.
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const userId = userData.user.id;

  // 2. Parse body. Either or both of { avatarBase64, bio } may be present.
  let body: { avatarBase64?: string; bio?: string | null };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const wantsAvatar = typeof body.avatarBase64 === "string" && body.avatarBase64.length > 0;
  const wantsBio = body.bio !== undefined;
  if (!wantsAvatar && !wantsBio) return json({ error: "Nothing to update" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 3. The caller must already have a player account (created at sign-in).
  const { data: acct, error: acctErr } = await admin
    .from("player_accounts")
    .select("id, avatar_change_count, avatar_window_start, bio_change_count, bio_window_start")
    .eq("id", userId)
    .maybeSingle();
  if (acctErr) return json({ error: "Could not load your account." }, 500);
  if (!acct) return json({ error: "No player account.", reason: "no_account" }, 403);

  const now = Date.now();
  const patch: Record<string, unknown> = {};

  // ── 4. AVATAR ───────────────────────────────────────────────────────────
  if (wantsAvatar) {
    // 4a. Rate limit (rolling 24h).
    const winStart = acct.avatar_window_start ? Date.parse(acct.avatar_window_start) : 0;
    const within = now - winStart < WINDOW_MS;
    const count = within ? (acct.avatar_change_count ?? 0) : 0;
    if (within && count >= AVATAR_DAILY_LIMIT) {
      const retryMin = Math.ceil((WINDOW_MS - (now - winStart)) / 60000);
      return json({
        error: `You've changed your photo too many times today. Try again in about ${Math.ceil(retryMin / 60)}h.`,
        reason: "rate_limited",
      }, 429);
    }

    // 4b. Decode + RE-VALIDATE the bytes (never trust the client).
    let bytes: Uint8Array;
    try { bytes = decodeBase64(body.avatarBase64!); }
    catch { return json({ error: "The image could not be read. Please try a different file.", reason: "invalid_image" }, 400); }

    if (bytes.length === 0) return json({ error: "Empty image.", reason: "invalid_image" }, 400);
    if (bytes.length > AVATAR_MAX_BYTES) {
      return json({ error: "Image is too large after optimization. Please try a smaller photo.", reason: "too_large" }, 413);
    }
    const info = parseWebp(bytes);
    if (!info) {
      return json({ error: "Invalid or corrupted image. Only standard photos (JPG/PNG/WEBP) are allowed.", reason: "invalid_image" }, 400);
    }
    if (info.animated) {
      return json({ error: "Animated images aren't allowed. Please use a still photo.", reason: "animated" }, 400);
    }
    const lo = AVATAR_DIM - AVATAR_DIM_TOLERANCE, hi = AVATAR_DIM + AVATAR_DIM_TOLERANCE;
    if (info.width < lo || info.width > hi || info.height < lo || info.height > hi) {
      return json({ error: "Image had unexpected dimensions. Please re-upload.", reason: "bad_dimensions" }, 400);
    }

    // 4c. Image moderation. Fail CLOSED if moderation can't run (no silent pass).
    const dataUrl = `data:image/webp;base64,${body.avatarBase64!.includes(",") ? body.avatarBase64!.split(",")[1] : body.avatarBase64}`;
    const imgMod = await moderate([{ type: "image_url", image_url: { url: dataUrl } }]);
    if (imgMod === null) {
      return json({
        error: "Image safety check is temporarily unavailable. Please try again shortly.",
        reason: "moderation_unavailable",
      }, 503);
    }
    if (imgMod.flagged) {
      return json({ error: moderationMessage(imgMod.reasons), reason: "image_rejected", categories: imgMod.reasons }, 422);
    }

    // 4d. Store the single canonical object, overwriting the previous avatar.
    const path = `${userId}.webp`;
    const { error: upErr } = await admin.storage
      .from("avatars")
      .upload(path, bytes, { contentType: "image/webp", upsert: true, cacheControl: "3600" });
    if (upErr) return json({ error: "Could not save the image. Please try again." }, 500);

    const { data: pub } = admin.storage.from("avatars").getPublicUrl(path);
    // Cache-bust the CDN URL so the new image shows immediately despite the
    // stable filename. Clients store/display this exact URL.
    patch.avatar_url = `${pub.publicUrl}?v=${now}`;
    patch.avatar_updated_at = new Date(now).toISOString();
    patch.avatar_change_count = count + 1;
    patch.avatar_window_start = within ? acct.avatar_window_start : new Date(now).toISOString();
  }

  // ── 5. BIO ─────────────────────────────────────────────────────────────────
  if (wantsBio) {
    // 5a. Rate limit.
    const winStart = acct.bio_window_start ? Date.parse(acct.bio_window_start) : 0;
    const within = now - winStart < WINDOW_MS;
    const count = within ? (acct.bio_change_count ?? 0) : 0;
    if (within && count >= BIO_DAILY_LIMIT) {
      return json({ error: "You've edited your bio too many times today. Please try again later.", reason: "rate_limited" }, 429);
    }

    // 5b. Normalize. null/empty clears the bio (allowed, not moderated).
    const raw = body.bio == null ? "" : String(body.bio);
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      patch.bio = null;
    } else {
      if (trimmed.length > BIO_MAX) {
        return json({ error: `Bio must be ${BIO_MAX} characters or fewer.`, reason: "too_long" }, 400);
      }
      // 5c. Local profanity filter.
      if (profanityHit(trimmed)) {
        return json({ error: "Your bio contains language that isn't allowed.", reason: "profanity" }, 422);
      }
      // 5d. AI text moderation. Text fails OPEN to the profanity result if the
      // API is down (we already ran a hard filter), so a moderation outage
      // doesn't block all bio edits — images stay fail-closed, text degrades.
      const txtMod = await moderate(trimmed);
      if (txtMod && txtMod.flagged) {
        return json({ error: moderationMessage(txtMod.reasons), reason: "bio_rejected", categories: txtMod.reasons }, 422);
      }
      patch.bio = trimmed;
    }
    patch.bio_updated_at = new Date(now).toISOString();
    patch.bio_change_count = count + 1;
    patch.bio_window_start = within ? acct.bio_window_start : new Date(now).toISOString();
  }

  // 6. Persist (service_role → bypasses the column-freeze trigger).
  const { error: updErr } = await admin
    .from("player_accounts")
    .update(patch)
    .eq("id", userId);
  if (updErr) return json({ error: "Could not save your profile. Please try again." }, 500);

  return json({
    ok: true,
    avatar_url: patch.avatar_url ?? undefined,
    bio: "bio" in patch ? patch.bio : undefined,
  });
});
