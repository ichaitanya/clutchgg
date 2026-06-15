-- 007_prevent_duplicate_player_email.sql
-- Closes the account-duplication gap in the player OAuth flow.
--
-- The problem: Supabase auto-links a second provider into ONE user only when
-- that provider returns an email that is ALREADY VERIFIED on the existing user.
-- If the emails differ, or the second provider's email is unverified, GoTrue
-- creates a SECOND auth user instead. A player could then end up with two
-- half-verified player_accounts and never get the badge — and worse, two
-- profiles claiming to be the same person.
--
-- The correct UX is "link the second provider from /profile", never "log in
-- again with it". We can't stop GoTrue from minting the user, but we CAN make
-- the collision detectable and refuse to stand up a competing player profile
-- for it, so the duplicate is inert until the user resolves it by linking.

-- ── 1. Detect whether an email already belongs to a DIFFERENT auth user ──────
-- SECURITY DEFINER so it can read auth.users (authenticated has no access).
-- Returns the existing user's id when `email` is already in use by someone
-- other than `self`, else NULL. Used by the player-account insert guard and
-- callable by the client to warn before/after an OAuth round-trip.
CREATE OR REPLACE FUNCTION public.email_owner_other_than(p_email text, p_self uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(p_email)
    AND u.id <> p_self
  ORDER BY u.created_at ASC
  LIMIT 1;
$function$;

-- This is an internal helper for the duplicate-email trigger only — NOT for
-- client use. Exposing it via RPC would be an email-enumeration oracle, so
-- revoke EXECUTE from everyone. The trigger (also SECURITY DEFINER, owned by a
-- privileged role) can still call it.
REVOKE ALL ON FUNCTION public.email_owner_other_than(text, uuid) FROM anon, authenticated, public;

-- ── 2. Refuse to create a SECOND player profile for a duplicate email ────────
-- Extends the existing sync_player_identity_flags trigger path with a guard on
-- INSERT: if this new user's email already belongs to an earlier auth user,
-- block the insert. The earlier account is the canonical one; the user must
-- sign in as that account and LINK the new provider instead. (Service role is
-- exempt so support tooling can still reconcile.)
CREATE OR REPLACE FUNCTION public.guard_player_account_duplicate_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  my_email text;
  other_owner uuid;
BEGIN
  -- service_role (edge functions / support) bypasses the guard.
  IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT u.email INTO my_email FROM auth.users u WHERE u.id = NEW.id;
  IF my_email IS NULL THEN
    RETURN NEW; -- no email on file (shouldn't happen for OAuth); let it through
  END IF;

  other_owner := public.email_owner_other_than(my_email, NEW.id);
  IF other_owner IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_player_email'
      USING HINT = 'An account already exists for this email. Sign in with your original provider and link this one from your profile instead.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_player_account_duplicate_email ON public.player_accounts;
CREATE TRIGGER guard_player_account_duplicate_email
  BEFORE INSERT ON public.player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_player_account_duplicate_email();

REVOKE ALL ON FUNCTION public.guard_player_account_duplicate_email() FROM anon, authenticated, public;
