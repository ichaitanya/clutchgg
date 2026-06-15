import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// manage-pickem-question v2 — organizer/superadmin CRUD + the publish lifecycle.
//
// Lifecycle rules:
//   • A match's questions are DRAFT until 'publish' flips pickem_match_state.published.
//     Players can't see a draft match (enforced by RLS); seeding/editing happens here.
//   • BEFORE publish: an organizer scoped to the tournament may create/update/delete.
//   • AFTER publish: an organizer may NOT change questions — only a SUPERADMIN may.
//     (Organizers keep answer/result control via grade-pickems.)
//   • 'publish' requires >= MIN_QUESTIONS and that all questions still validate.
//   • 'publish-results' reveals graded correctness + points to players (sets
//     results_published); grade-pickems stages results, this makes them public.
//
// Actions: create | update | delete | lock | publish | unpublish | publish-results

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const MIN_QUESTIONS = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated" }, 401);
  const callerId = userData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const action = body.action as string;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  async function tournamentForQuestion(qid: string): Promise<{ tournamentId: string; matchId: string; status: string } | null> {
    const { data } = await admin.from("pickem_questions").select("tournament_id, match_id, status").eq("id", qid).maybeSingle();
    return data ? { tournamentId: data.tournament_id, matchId: data.match_id, status: data.status } : null;
  }
  async function isPublished(tid: string, mid: string): Promise<boolean> {
    const { data } = await admin.from("pickem_match_state").select("published").eq("tournament_id", tid).eq("match_id", mid).maybeSingle();
    return !!data?.published;
  }
  // Who may edit QUESTIONS of this match right now? Draft → organizer/superadmin;
  // published → superadmin only.
  async function canEditQuestions(tid: string, mid: string): Promise<{ ok: boolean; reason?: string }> {
    const published = await isPublished(tid, mid);
    if (published) {
      const sa = await isSuperadmin(admin, callerId);
      return sa ? { ok: true } : { ok: false, reason: "published_superadmin_only" };
    }
    const org = await isOrganizerOf(admin, callerId, tid);
    return org ? { ok: true } : { ok: false, reason: "forbidden" };
  }

  // ── create ──
  if (action === "create") {
    const { tournamentId, matchId, prompt, options, points, stage } = body;
    if (!tournamentId || !matchId || !prompt || !Array.isArray(options)) {
      return json({ error: "tournamentId, matchId, prompt, options[] required" }, 400);
    }
    const perm = await canEditQuestions(tournamentId, matchId);
    if (!perm.ok) return json({ error: perm.reason === "published_superadmin_only" ? "Published questions can only be changed by a superadmin." : "Forbidden", reason: perm.reason }, 403);
    const cleanOpts = sanitizeOptions(options);
    if (cleanOpts.length < 2) return json({ error: "A question needs at least 2 options" }, 400);
    const { data: maxRow } = await admin.from("pickem_questions").select("sort_order").eq("tournament_id", tournamentId).eq("match_id", matchId).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const sort = (maxRow?.sort_order ?? 0) + 1;
    const { error } = await admin.from("pickem_questions").insert({
      tournament_id: tournamentId, match_id: matchId, stage: stage ?? null, kind: "custom",
      prompt: String(prompt).slice(0, 240), options: cleanOpts, auto_grade: false,
      points: clampPoints(points), sort_order: sort, status: "open", created_by: callerId,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // ── update ──
  if (action === "update") {
    const { questionId, prompt, options, points, sortOrder } = body;
    if (!questionId) return json({ error: "questionId required" }, 400);
    const ctx = await tournamentForQuestion(questionId);
    if (!ctx) return json({ error: "Question not found" }, 404);
    const perm = await canEditQuestions(ctx.tournamentId, ctx.matchId);
    if (!perm.ok) return json({ error: perm.reason === "published_superadmin_only" ? "Published questions can only be changed by a superadmin." : "Forbidden", reason: perm.reason }, 403);
    if (ctx.status !== "open") return json({ error: "Can't edit a locked or graded question", reason: "not_open" }, 409);
    const patch: any = {};
    if (prompt !== undefined) patch.prompt = String(prompt).slice(0, 240);
    if (options !== undefined) {
      const cleanOpts = sanitizeOptions(options);
      if (cleanOpts.length < 2) return json({ error: "A question needs at least 2 options" }, 400);
      patch.options = cleanOpts;
    }
    if (points !== undefined) patch.points = clampPoints(points);
    if (sortOrder !== undefined) patch.sort_order = Number(sortOrder) || 0;
    const { error } = await admin.from("pickem_questions").update(patch).eq("id", questionId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // ── delete ──
  if (action === "delete") {
    const { questionId } = body;
    if (!questionId) return json({ error: "questionId required" }, 400);
    const ctx = await tournamentForQuestion(questionId);
    if (!ctx) return json({ error: "Question not found" }, 404);
    const perm = await canEditQuestions(ctx.tournamentId, ctx.matchId);
    if (!perm.ok) return json({ error: perm.reason === "published_superadmin_only" ? "Published questions can only be changed by a superadmin." : "Forbidden", reason: perm.reason }, 403);
    if (ctx.status !== "open") return json({ error: "Can't delete a locked or graded question", reason: "not_open" }, 409);
    const { count } = await admin.from("pickem_questions").select("id", { count: "exact", head: true }).eq("tournament_id", ctx.tournamentId).eq("match_id", ctx.matchId);
    if ((count ?? 0) <= MIN_QUESTIONS) return json({ error: `Each match must keep at least ${MIN_QUESTIONS} questions.`, reason: "min_questions" }, 409);
    const { error } = await admin.from("pickem_questions").delete().eq("id", questionId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // ── lock (manual early lock; schedule lock is automatic) ──
  if (action === "lock") {
    const { tournamentId, matchId } = body;
    if (!tournamentId || !matchId) return json({ error: "tournamentId + matchId required" }, 400);
    if (!(await isOrganizerOf(admin, callerId, tournamentId))) return json({ error: "Forbidden" }, 403);
    await admin.from("pickem_questions").update({ status: "locked" }).eq("tournament_id", tournamentId).eq("match_id", matchId).eq("status", "open");
    return json({ ok: true });
  }

  // ── unlock (superadmin only; reverts locked questions back to open) ──
  if (action === "unlock") {
    const { tournamentId, matchId } = body;
    if (!tournamentId || !matchId) return json({ error: "tournamentId + matchId required" }, 400);
    const sa = await isSuperadmin(admin, callerId);
    if (!sa) return json({ error: "Only superadmin can unlock questions" }, 403);
    await admin.from("pickem_questions").update({ status: "open" }).eq("tournament_id", tournamentId).eq("match_id", matchId).eq("status", "locked");
    return json({ ok: true });
  }

  // ── publish: make a draft match's questions visible to players ──
  if (action === "publish") {
    const { tournamentId, matchId } = body;
    if (!tournamentId || !matchId) return json({ error: "tournamentId + matchId required" }, 400);
    if (!(await isOrganizerOf(admin, callerId, tournamentId))) return json({ error: "Forbidden" }, 403);
    const { count } = await admin.from("pickem_questions").select("id", { count: "exact", head: true }).eq("tournament_id", tournamentId).eq("match_id", matchId);
    if ((count ?? 0) < MIN_QUESTIONS) return json({ error: `Add at least ${MIN_QUESTIONS} questions before publishing.`, reason: "min_questions" }, 409);
    const { error } = await admin.from("pickem_match_state").upsert({
      tournament_id: tournamentId, match_id: matchId, published: true,
      published_at: new Date().toISOString(), published_by: callerId, updated_at: new Date().toISOString(),
    }, { onConflict: "tournament_id,match_id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, published: true });
  }

  // ── unpublish: only allowed while NO picks exist (so we never yank a live game) ──
  if (action === "unpublish") {
    const { tournamentId, matchId } = body;
    if (!tournamentId || !matchId) return json({ error: "tournamentId + matchId required" }, 400);
    if (!(await isOrganizerOf(admin, callerId, tournamentId))) return json({ error: "Forbidden" }, 403);
    const { count: pickCount } = await admin.from("pickem_picks").select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId).in("question_id",
        (await admin.from("pickem_questions").select("id").eq("tournament_id", tournamentId).eq("match_id", matchId)).data?.map((r: any) => r.id) ?? ["__none__"]);
    if ((pickCount ?? 0) > 0) return json({ error: "Players have already made picks — can't unpublish.", reason: "has_picks" }, 409);
    const { error } = await admin.from("pickem_match_state").update({ published: false, updated_at: new Date().toISOString() }).eq("tournament_id", tournamentId).eq("match_id", matchId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, published: false });
  }

  // ── publish-results: reveal graded correctness + points to players ──
  if (action === "publish-results") {
    const { tournamentId, matchId } = body;
    if (!tournamentId || !matchId) return json({ error: "tournamentId + matchId required" }, 400);
    if (!(await isOrganizerOf(admin, callerId, tournamentId))) return json({ error: "Forbidden" }, 403);
    // Must be published first, and every question should be decided (graded/void).
    const { data: open } = await admin.from("pickem_questions").select("id").eq("tournament_id", tournamentId).eq("match_id", matchId).in("status", ["open", "locked"]);
    if ((open ?? []).length > 0) {
      return json({ error: "Grade all questions before publishing results.", reason: "ungraded", remaining: (open ?? []).length }, 409);
    }
    const { error } = await admin.from("pickem_match_state").upsert({
      tournament_id: tournamentId, match_id: matchId, published: true,
      results_published: true, results_published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "tournament_id,match_id" });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, results_published: true });
  }

  // ── set-score-opt-in: let a superadmin opt themselves IN to (or out of) this
  // tournament's pickem leaderboard, despite manages_tournament() normally
  // excluding all superadmins from scoring. Self only — an organizer can't opt
  // other users in. ──
  if (action === "set-score-opt-in") {
    const { tournamentId, optIn } = body;
    if (!tournamentId) return json({ error: "tournamentId required" }, 400);
    if (!(await isSuperadmin(admin, callerId))) return json({ error: "Forbidden" }, 403);
    if (optIn) {
      const { error } = await admin.from("pickem_score_overrides").upsert({ user_id: callerId, tournament_id: tournamentId }, { onConflict: "user_id,tournament_id" });
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await admin.from("pickem_score_overrides").delete().eq("user_id", callerId).eq("tournament_id", tournamentId);
      if (error) return json({ error: error.message }, 500);
    }
    return json({ ok: true, optIn: !!optIn });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});

function sanitizeOptions(options: any[]): { id: string; label: string }[] {
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (let i = 0; i < options.length && out.length < 8; i++) {
    const label = String(options[i]?.label ?? "").trim().slice(0, 120);
    if (!label) continue;
    const id = String(options[i]?.id ?? `opt_${i}`).slice(0, 40);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
  }
  return out;
}

function clampPoints(p: any): number {
  const n = Math.round(Number(p));
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(10, n));
}

async function isSuperadmin(admin: any, callerId: string): Promise<boolean> {
  const { data: profile } = await admin.from("profiles").select("role").eq("id", callerId).maybeSingle();
  return profile?.role === "superadmin";
}

async function isOrganizerOf(admin: any, callerId: string, tournamentId: string): Promise<boolean> {
  const { data: profile } = await admin.from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (profile?.role === "superadmin") return true;
  const { data: scope } = await admin.from("organizer_tournaments").select("tournament_id").eq("user_id", callerId).eq("tournament_id", tournamentId).maybeSingle();
  return !!scope;
}
