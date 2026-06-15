-- ════════════════════════════════════════════════════════════════════════════
-- Player-account privacy: stop leaking sensitive identifiers publicly.
--
-- player_accounts had a "Public read" RLS policy USING (true) AND a table-wide
-- SELECT grant, so ANY visitor (even anon) could read every column of every row
-- — including riot_id, riot_connection_id, discord_id, discord_username,
-- referral_code. That's a doxxing / enumeration vector (the new
-- riot_connection_id made it worse).
--
-- Fix: a TABLE-level SELECT grant implies all columns, and a column-level REVOKE
-- can't override it — so we REVOKE the table-wide SELECT and re-GRANT only the
-- safe columns. Public/own reads keep working:
--   • Public reads (other people's profiles) select ONLY safe columns.
--   • Own-row reads needing sensitive fields (profile editor, referral) go
--     through get_my_player_account() — SECURITY DEFINER, returns ONLY the
--     caller's own row (auth.uid() = id), nobody else's.
-- The blanket row policy can stay (USING true); the column grants gate access.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Replace the all-columns table grant with a safe-columns-only grant.
REVOKE SELECT ON public.player_accounts FROM anon, authenticated;
GRANT SELECT (
  id, display_name, avatar_url, bio, socials,
  google_linked, discord_linked, is_verified, created_at, updated_at
) ON public.player_accounts TO anon, authenticated;

-- 2. Own-row full read for the signed-in user. SECURITY DEFINER so it can return
--    the revoked columns, but ONLY for auth.uid() = id — never another user.
CREATE OR REPLACE FUNCTION public.get_my_player_account()
RETURNS public.player_accounts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.player_accounts WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.get_my_player_account() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_my_player_account() TO authenticated;
