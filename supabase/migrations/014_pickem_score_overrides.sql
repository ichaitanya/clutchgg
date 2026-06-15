-- ════════════════════════════════════════════════════════════════════════════
-- Allow specific organizers/superadmins to opt IN to a tournament's pickem
-- leaderboard despite manages_tournament() being true for them — e.g. a
-- superadmin who wants to play (not just administer) a particular event.
-- managers_among/manages_tournament are left untouched (still used by RLS for
-- draft visibility) — this only affects score-exclusion in recomputeScores.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pickem_score_overrides (
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tournament_id  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tournament_id)
);

ALTER TABLE public.pickem_score_overrides ENABLE ROW LEVEL SECURITY;
-- Writes are service-role only (via set-score-opt-in edge fn). Users may read
-- their own row so the admin UI can reflect current opt-in state on load.
CREATE POLICY pickem_score_overrides_select_own ON public.pickem_score_overrides
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Batch variant of managers_among that excludes a user only if they manage the
-- tournament AND have NOT opted in via pickem_score_overrides.
CREATE OR REPLACE FUNCTION public.excluded_from_pickem_scores(uids uuid[], tid text)
RETURNS TABLE(user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT u AS user_id
  FROM unnest(uids) AS u
  WHERE public.manages_tournament(u, tid)
    AND NOT EXISTS (
      SELECT 1 FROM public.pickem_score_overrides o
      WHERE o.user_id = u AND o.tournament_id = tid
    );
$function$;
REVOKE ALL ON FUNCTION public.excluded_from_pickem_scores(uuid[], text) FROM anon, authenticated, public;
