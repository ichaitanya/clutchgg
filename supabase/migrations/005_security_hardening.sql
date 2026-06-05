-- 005_security_hardening.sql
-- Closes privilege-escalation and data-integrity gaps found in a security audit.

-- ── 1. Freeze privileged profile columns ───────────────────────────────────
-- The "Authenticated users can manage own profile" policy is cmd=ALL with
-- (auth.uid() = id), and `authenticated` holds column UPDATE/INSERT on `role`
-- and `tournament_id`. RLS cannot restrict WHICH columns change, so without
-- this guard an organizer could `update profiles set role='superadmin'` on
-- themselves — or self-INSERT such a row — and seize the whole admin.
-- This trigger freezes role/tournament_id for everyone except a superadmin
-- (service_role bypasses RLS+triggers, so edge functions still assign).

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF is_superadmin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role IS DISTINCT FROM 'organizer' THEN
      RAISE EXCEPTION 'Not allowed to set role on insert';
    END IF;
    IF NEW.tournament_id IS NOT NULL THEN
      RAISE EXCEPTION 'Not allowed to self-assign a tournament';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Not allowed to change role';
  END IF;
  IF NEW.tournament_id IS DISTINCT FROM OLD.tournament_id THEN
    RAISE EXCEPTION 'Not allowed to change tournament assignment';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON public.profiles;
CREATE TRIGGER guard_profile_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_privileged_columns();

-- A trigger function must never be directly callable via PostgREST RPC.
REVOKE ALL ON FUNCTION public.guard_profile_privileged_columns() FROM anon, authenticated, public;

-- ── 2. Lock site-wide leaderboards to staff ─────────────────────────────────
-- standings / top_players are site-wide (staff) content but were writable by
-- ANY authenticated user (auth.uid() IS NOT NULL) — an organizer could wipe
-- them. Restrict writes to staff; public read stays open.

DROP POLICY IF EXISTS "Authenticated users can manage standings" ON public.standings;
CREATE POLICY "Staff manage standings" ON public.standings
  FOR ALL USING (is_staff()) WITH CHECK (is_staff());

DROP POLICY IF EXISTS "Authenticated users can manage top_players" ON public.top_players;
CREATE POLICY "Staff manage top_players" ON public.top_players
  FOR ALL USING (is_staff()) WITH CHECK (is_staff());

-- ── 3. Retire the unused singular helper from the API surface ───────────────
-- my_tournament_id() (singular) is no longer referenced by any policy; it is
-- only an internal union source inside my_tournament_ids(). Revoke its RPC.
REVOKE ALL ON FUNCTION public.my_tournament_id() FROM anon, authenticated, public;
