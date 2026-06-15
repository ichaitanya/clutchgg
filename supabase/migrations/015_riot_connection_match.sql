-- ════════════════════════════════════════════════════════════════════════════
-- Riot-connection capture for the background "this could be your profile" match.
--
-- Separates two concepts that were dangerously overloaded onto riot_id_verified:
--   • riot_id_verified  → an ADMIN-APPROVED claim exists (set by decide-claim,
--                          cleared by unclaim-profile). UNCHANGED here.
--   • riot_connection_* → the user's CURRENT verified Discord→Riot connection,
--                          captured at login by capture-riot-id. Drives the match
--                          suggestion ONLY. Never grants a verified badge.
--
-- Why separate: capture-riot-id runs on every Discord login and would otherwise
-- clobber/clear riot_id_verified — silently invalidating an approved claimant's
-- badge whenever they logged in without their Riot connection present.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.player_accounts
  ADD COLUMN IF NOT EXISTS riot_connection_id        text,
  ADD COLUMN IF NOT EXISTS riot_connection_verified  boolean NOT NULL DEFAULT false;

-- Extend the identity-flag trigger to FREEZE the new columns for every non
-- service-role writer (same posture as riot_id_verified) — only capture-riot-id
-- (service role) may set them, so a client can't self-assert a connection to
-- fabricate a match suggestion. We re-create the whole function to keep it as the
-- single source of truth (mirrors 006/007).
CREATE OR REPLACE FUNCTION public.sync_player_identity_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  has_google boolean;
  has_discord boolean;
  d_id text;
  d_name text;
BEGIN
  SELECT
    bool_or(i.provider = 'google'),
    bool_or(i.provider = 'discord')
  INTO has_google, has_discord
  FROM auth.identities i
  WHERE i.user_id = NEW.id;

  NEW.google_linked  := COALESCE(has_google, false);
  NEW.discord_linked := COALESCE(has_discord, false);

  IF NEW.discord_linked THEN
    SELECT
      COALESCE(i.provider_id, i.identity_data->>'provider_id', i.identity_data->>'sub'),
      COALESCE(i.identity_data#>>'{custom_claims,global_name}', i.identity_data->>'full_name', i.identity_data->>'name')
    INTO d_id, d_name
    FROM auth.identities i
    WHERE i.user_id = NEW.id AND i.provider = 'discord'
    LIMIT 1;
    NEW.discord_id := d_id;
    NEW.discord_username := d_name;
  ELSE
    NEW.discord_id := NULL;
    NEW.discord_username := NULL;
  END IF;

  -- Freeze riot verification + connection capture for ordinary clients
  -- (service_role keeps control).
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.riot_id_verified := false;
      NEW.riot_connection_id := NULL;
      NEW.riot_connection_verified := false;
    ELSE
      NEW.riot_id_verified := OLD.riot_id_verified;
      NEW.riot_connection_id := OLD.riot_connection_id;
      NEW.riot_connection_verified := OLD.riot_connection_verified;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_player_identity_flags() FROM anon, authenticated, public;
