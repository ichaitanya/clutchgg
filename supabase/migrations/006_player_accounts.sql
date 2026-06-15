-- 006_player_accounts.sql
-- Public player accounts: Google/Discord OAuth login + identity-link "Verified
-- User" badge. Deliberately a SEPARATE table from `profiles` — that table is
-- staff-only (admin/superadmin/organizer) and its privileged-column trigger
-- (005) raises on any non-organizer self-INSERT, so player rows must never
-- touch it. All staff logic (isAdmin, organizer scoping) stays untouched.

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE public.player_accounts (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar_url text,
  bio text CHECK (char_length(bio) <= 500),
  socials jsonb NOT NULL DEFAULT '{}',
  discord_id text UNIQUE,
  discord_username text,
  google_linked boolean NOT NULL DEFAULT false,
  discord_linked boolean NOT NULL DEFAULT false,
  is_verified boolean GENERATED ALWAYS AS (google_linked AND discord_linked) STORED,
  riot_id text,                                     -- future profile-claim flow ("Name#Tag")
  riot_id_verified boolean NOT NULL DEFAULT false,  -- future: set server-side only
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.player_accounts ENABLE ROW LEVEL SECURITY;

-- Public read: player profiles are public content (bio, socials, badge). The
-- table intentionally stores NO email — nothing here is private.
CREATE POLICY "Public read player accounts" ON public.player_accounts
  FOR SELECT USING (true);
CREATE POLICY "Self insert player account" ON public.player_accounts
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Self update player account" ON public.player_accounts
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ── 2. Identity-flag sync trigger ───────────────────────────────────────────
-- The verified badge must not be client-forgeable. Whatever flag values a
-- client sends, this trigger overwrites them from auth.identities — the source
-- of truth GoTrue maintains when a provider is signed in or linked. SECURITY
-- DEFINER because `authenticated` has no SELECT on auth.identities.
-- riot_id_verified is likewise frozen for everyone except service_role (the
-- future claim flow verifies it in an edge function).
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

  -- Freeze riot verification for ordinary clients (service_role keeps control).
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.riot_id_verified := false;
    ELSE
      NEW.riot_id_verified := OLD.riot_id_verified;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sync_player_identity_flags ON public.player_accounts;
CREATE TRIGGER sync_player_identity_flags
  BEFORE INSERT OR UPDATE ON public.player_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_player_identity_flags();

-- A trigger function must never be directly callable via PostgREST RPC.
REVOKE ALL ON FUNCTION public.sync_player_identity_flags() FROM anon, authenticated, public;

-- ── 3. Avatars bucket ───────────────────────────────────────────────────────
-- Players upload their profile photo to avatars/<their-uid>/…; public read.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- NB: a public bucket already serves object URLs WITHOUT any storage.objects
-- SELECT policy. We deliberately do NOT add a broad "FOR SELECT USING
-- (bucket_id='avatars')" policy — that would let any client LIST every file in
-- the bucket and enumerate other users' uploads. Public photo URLs still load.
CREATE POLICY "Players upload own avatar" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Players update own avatar" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Players delete own avatar" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
