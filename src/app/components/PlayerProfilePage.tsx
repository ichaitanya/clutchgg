import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { LoadingState } from './LoadingState';
import {
  BadgeCheck,
  Camera,
  LogOut,
  CheckCircle2,
  Users,
  Copy,
  Sparkles,
  Gamepad2,
  ChevronRight,
} from 'lucide-react';
import { SOCIAL_FIELDS } from './socials';
import { useAuth } from '../context/AuthContext';
import {
  getMyClaims,
  linkProvider,
  signOut,
  unclaimProfile,
  upsertPlayerAccount,
  updateProfile,
  verifyRiotConnection,
  findMyPlayerProfiles,
  captureRiotId,
  type OAuthProvider,
  type PlayerClaim,
  type ProfileMatch,
} from '../services/supabase';
import { getMyReferralStats, type ReferralStats } from '../services/pickems';
import { optimizeAvatar, AvatarError } from '../utils/avatarImage';

// Social platforms (with icons) live in the shared socials module so the editor
// and the public hero icon row stay in sync.

// Product bio limit is 250 (the DB CHECK stays at 500 so no existing longer bio
// is invalidated; the edge function and this UI enforce 250 going forward).
const BIO_LIMIT = 250;
const NAME_LIMIT = 30;

export function PlayerProfilePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userId, playerAccount, duplicateEmail, accountError, loading, refresh, providerToken } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkPending, setLinkPending] = useState<OAuthProvider | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // Optimistic local preview (object URL) shown while the new photo uploads.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [myClaims, setMyClaims] = useState<PlayerClaim[]>([]);
  const [unclaiming, setUnclaiming] = useState<string | null>(null);
  const [referral, setReferral] = useState<ReferralStats | null>(null);
  const [refCopied, setRefCopied] = useState(false);
  // Background "this could be your profile" matches (by verified Riot ID).
  const [profileMatches, setProfileMatches] = useState<ProfileMatch[]>([]);
  const [matchHasActiveClaim, setMatchHasActiveClaim] = useState(false);
  const [riotPending, setRiotPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Seed the form once per account load, not on every render.
  const seededFor = useRef<string | null>(null);

  // Not signed in → to login (once the initial resolution settles). A
  // duplicate-email collision keeps the user here (they ARE signed in) to show
  // the recovery screen, so don't redirect in that case.
  useEffect(() => {
    if (!loading && !userId && !duplicateEmail) navigate('/login', { replace: true });
  }, [loading, userId, duplicateEmail, navigate]);

  // Claimed tournament profiles (pending + approved + rejected history).
  useEffect(() => {
    if (userId) getMyClaims().then(setMyClaims);
  }, [userId]);

  // Pickems referral stats — the invite link + how many friends have joined.
  useEffect(() => {
    if (userId) getMyReferralStats().then(setReferral);
  }, [userId]);

  // Transient toast for the Riot-connection verify result (after ?riot=1).
  const [riotToast, setRiotToast] = useState<{ kind: 'ok' | 'none'; msg: string } | null>(null);
  // While true, the next account refresh after returning from ?riot=1 decides
  // the toast based on whether a connection actually got captured.
  const awaitingRiot = useRef(false);

  // Background match: player cards that belong to this user (verified Riot ID).
  // Drives the "we found a profile that may be you" card. Re-runs when the
  // account's verified state changes (e.g. right after connecting Riot).
  useEffect(() => {
    let cancelled = false;
    if (!userId || !playerAccount?.riot_connection_verified) {
      setProfileMatches([]);
      setMatchHasActiveClaim(false);
      return;
    }
    findMyPlayerProfiles().then(res => {
      if (cancelled) return;
      setProfileMatches(res.matches);
      setMatchHasActiveClaim(res.hasActiveClaim);
    });
    return () => { cancelled = true; };
  }, [userId, playerAccount?.riot_connection_verified]);

  const handleConnectRiot = async () => {
    setError(null);
    setRiotPending(true);
    try { await verifyRiotConnection(); /* redirects to Discord */ }
    catch (e: any) { setRiotPending(false); setError(e?.message || 'Could not start Riot verification.'); }
  };

  const handleUnclaim = async (claim: PlayerClaim) => {
    setUnclaiming(claim.id);
    setError(null);
    try {
      await unclaimProfile(claim.id);
      setMyClaims(await getMyClaims());
    } catch (e: any) {
      setError(e?.message || 'Could not unclaim. Please try again.');
    } finally {
      setUnclaiming(null);
    }
  };

  // Returning from a linkIdentity redirect (?linked=1): force a re-sync of the
  // linked-provider flags (they only update on a write, not a read), so the
  // newly linked provider shows "Linked" and the badge appears. Then clean URL.
  useEffect(() => {
    if (searchParams.get('linked')) {
      refresh(true);
      searchParams.delete('linked');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, refresh]);

  // Returning from the Riot-connection verify (?riot=1): capture the connection
  // DIRECTLY here using the one-shot provider_token from this OAuth round-trip,
  // and surface the real result as a toast. We don't rely on AuthContext's
  // background capture (its provider gate can miss for Google-primary accounts,
  // and we want the actual status here). Waits for providerToken to arrive
  // (it lands on the SIGNED_IN event after the redirect), one-shot guarded.
  useEffect(() => {
    if (!searchParams.get('riot')) return;
    if (awaitingRiot.current) return;
    // Clean the URL immediately so a refresh doesn't re-trigger.
    const sp = new URLSearchParams(searchParams);
    sp.delete('riot');
    setSearchParams(sp, { replace: true });

    if (!providerToken) {
      // Token not present yet — the SIGNED_IN event hasn't delivered it. The
      // effect re-runs when providerToken updates (it's in the dep array).
      return;
    }
    awaitingRiot.current = true;
    const token = providerToken;
    (async () => {
      const status = await captureRiotId(token);
      if (status === 'captured') {
        setRiotToast({ kind: 'ok', msg: 'Game account verified — we’ll check for your player profile.' });
        await refresh(true); // pull the refreshed riot_connection_verified + matches
      } else {
        setRiotToast({
          kind: 'none',
          msg: status === 'no_discord'
            ? 'Link your Discord account first, then verify your game account.'
            : 'No verified game account found on your Discord. Link it in Discord → Settings → Connections (sign in through the game so it shows as verified), then try again.',
        });
      }
    })();
  }, [searchParams, setSearchParams, providerToken, refresh]);

  // Auto-dismiss the Riot toast.
  useEffect(() => {
    if (!riotToast) return;
    const t = setTimeout(() => setRiotToast(null), 6000);
    return () => clearTimeout(t);
  }, [riotToast]);

  useEffect(() => {
    if (playerAccount && seededFor.current !== playerAccount.id) {
      seededFor.current = playerAccount.id;
      setDisplayName(playerAccount.display_name);
      setBio(playerAccount.bio ?? '');
      setSocials(playerAccount.socials ?? {});
    }
  }, [playerAccount]);

  const handleSave = async () => {
    if (!displayName.trim()) {
      setError('Display name cannot be empty.');
      return;
    }
    const trimmedBio = bio.trim();
    if (trimmedBio.length > BIO_LIMIT) {
      setError(`Bio must be ${BIO_LIMIT} characters or fewer.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const cleanSocials = Object.fromEntries(
        Object.entries(socials).filter(([, v]) => v.trim() !== '')
      );
      // Name + socials are client-writable; bio is frozen against direct writes
      // (migration 017) and must go through the moderated edge function. Only
      // send the bio if it actually changed, so a name/socials edit doesn't burn
      // a bio rate-limit slot or re-run moderation needlessly.
      const bioChanged = trimmedBio !== (playerAccount?.bio ?? '').trim();
      await upsertPlayerAccount({
        display_name: displayName.trim().slice(0, NAME_LIMIT),
        socials: cleanSocials,
      });
      if (bioChanged) {
        const res = await updateProfile({ bio: trimmedBio || null });
        if (res.error) {
          setError(res.error);
          return;
        }
      }
      await refresh();
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingAvatar(true);
    let localPreview: string | null = null;
    try {
      // 1. Validate + optimize in the browser → 512x512 WEBP (also strips EXIF).
      //    Format/size/animated rejections surface here as AvatarError messages.
      const optimized = await optimizeAvatar(file);
      // 2. Optimistic preview from the optimized blob (what will actually save).
      localPreview = URL.createObjectURL(optimized.blob);
      setAvatarPreview(localPreview);
      // 3. Secure write: edge function re-validates bytes, moderates, stores.
      const res = await updateProfile({ avatarBase64: optimized.base64 });
      if (res.error) {
        setError(res.error);
        setAvatarPreview(null);
        return;
      }
      await refresh();
    } catch (err: any) {
      // AvatarError carries a user-friendly message; anything else gets a generic.
      setError(
        err instanceof AvatarError
          ? err.message
          : err?.message || 'Could not upload the photo. Please try again.'
      );
      setAvatarPreview(null);
    } finally {
      // Revoke the optimistic object URL once the real (or failed) state settles.
      if (localPreview) { try { URL.revokeObjectURL(localPreview); } catch { /* */ } }
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLink = async (provider: OAuthProvider) => {
    setError(null);
    setLinkPending(provider);
    try {
      await linkProvider(provider);
      // Redirecting to the provider now.
    } catch (e: any) {
      setError(e?.message || `Could not start ${provider} verification.`);
      setLinkPending(null);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
    // signOut purges the token synchronously but the context's SIGNED_OUT
    // event is fire-and-forget — reload guarantees every component resets.
    window.location.reload();
  };

  // Duplicate-email collision: this provider minted a second account for an
  // email that already owns one. Don't let them build a rival profile — guide
  // them to sign in with their original provider and link this one instead.
  if (duplicateEmail) {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
        <Header />
        <main className="flex-1 flex items-start justify-center py-12 px-4">
          <div className="arena-contact__card" style={{ maxWidth: 460, textAlign: 'center' }}>
            <h1 className="arena-contact__title">Account already exists</h1>
            <p className="arena-contact__sub" style={{ marginTop: '0.75rem' }}>
              There's already a ClutchGG account for <strong>{duplicateEmail}</strong>.
              To keep everything on one profile — and to earn your Verified badge —
              sign in with the provider you used the first time, then add this one
              from your profile's <em>Account Verification</em> section.
            </p>
            <button
              onClick={handleSignOut}
              className="arena-btn arena-btn--primary"
              style={{ display: 'inline-block', marginTop: '1.5rem' }}
            >
              Back to Login
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Resolved a session but couldn't load/create the account → offer a retry
  // rather than spinning forever.
  if (accountError && userId) {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
        <Header />
        <main className="flex-1 flex items-start justify-center py-12 px-4">
          <div className="arena-contact__card" style={{ maxWidth: 420, textAlign: 'center' }}>
            <h1 className="arena-contact__title">Couldn't load your profile</h1>
            <p className="arena-contact__sub" style={{ marginTop: '0.75rem' }}>
              Something went wrong setting up your player profile. Please try again.
            </p>
            <button
              onClick={() => refresh()}
              className="arena-btn arena-btn--primary"
              style={{ display: 'inline-block', marginTop: '1.5rem' }}
            >
              Retry
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (loading || (!playerAccount && userId)) {
    return (
      <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
        <Header />
        <main className="flex-1 flex items-center justify-center px-4">
          <LoadingState label="Loading your profile…" inline />
        </main>
      </div>
    );
  }
  if (!playerAccount) return null; // redirecting to /login

  const initials = playerAccount.display_name.trim().slice(0, 2).toUpperCase();
  const verifyTarget: OAuthProvider | null = !playerAccount.google_linked
    ? 'google'
    : !playerAccount.discord_linked
    ? 'discord'
    : null;

  // Profile completion: live score from the current form state so the meter
  // animates as the user fills things in (before they even hit Save).
  const completionItems = [
    { label: 'Add a profile photo', done: !!playerAccount.avatar_url },
    { label: 'Set a display name', done: displayName.trim().length > 0 },
    { label: 'Write a bio', done: bio.trim().length > 0 },
    { label: 'Link a social account', done: Object.values(socials).some(v => v.trim() !== '') },
    { label: 'Verify your account', done: playerAccount.is_verified },
  ];
  const completedCount = completionItems.filter(i => i.done).length;
  const completionPct = Math.round((completedCount / completionItems.length) * 100);
  const nextStep = completionItems.find(i => !i.done);

  return (
    <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
      <Header />

      <main className="flex-1 py-12 px-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleAvatarPick}
          style={{ display: 'none' }}
        />

        <div className="arena-profile">
          {/* Page heading */}
          <div className="arena-profile__heading">
            <h1>Profile Settings</h1>
            <p>Manage your public identity and linked accounts</p>
          </div>

          <div className="arena-profile__grid">
            {/* ── Left sidebar ── */}
            <aside className="arena-profile__aside">
              {/* Avatar card */}
              <div className="arena-profile__card arena-profile__card--pad arena-profile__avatar-card">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  aria-label="Change profile photo"
                  className="arena-profile__avatar-btn"
                >
                  <span className="arena-profile__avatar">
                    {avatarPreview || playerAccount.avatar_url ? (
                      <img
                        src={avatarPreview ?? playerAccount.avatar_url!}
                        alt={playerAccount.display_name}
                        style={uploadingAvatar ? { opacity: 0.6 } : undefined}
                      />
                    ) : (
                      <span className="arena-profile__avatar-initials">{initials}</span>
                    )}
                  </span>
                  <span className="arena-profile__avatar-cam">
                    <Camera className="w-3.5 h-3.5" />
                  </span>
                </button>

                <div>
                  <p className="arena-profile__avatar-name">{playerAccount.display_name}</p>
                  {playerAccount.is_verified && (
                    <span className="arena-profile__verified-pill" title="Google and Discord verified">
                      <BadgeCheck className="w-3 h-3" /> Verified User
                    </span>
                  )}
                  {uploadingAvatar && (
                    <p className="arena-contact__hint" style={{ textAlign: 'center' }}>Uploading photo…</p>
                  )}
                </div>

                <button onClick={handleSignOut} className="arena-profile__side-btn" title="Sign out">
                  <LogOut className="w-3.5 h-3.5" /> Sign Out
                </button>
              </div>

              {/* Claimed tournament profiles — placed high in the sidebar (right
                  under the avatar) so it's seen before the right-column form ends
                  on scroll; users wouldn't expect a card stranded below the form. */}
              {myClaims.length > 0 && (
                <div className="arena-profile__card arena-profile__card--pad">
                  <p className="arena-profile__label">My Claimed Profiles</p>
                  <div className="arena-profile__claims">
                    {myClaims.map(c => (
                      <div key={c.id} className="arena-profile__claim">
                        <Link
                          to={`/player/${c.tournament_id}/${c.player_id}`}
                          className="arena-profile__claim-id"
                        >
                          <span className="arena-profile__claim-name">{c.player_name || c.riot_id}</span>
                          <span className="arena-profile__claim-riot">{c.riot_id}</span>
                        </Link>
                        <div className="arena-profile__claim-meta">
                          <span
                            className="arena-profile__claim-status inline-flex items-center gap-1"
                            style={{
                              color:
                                c.status === 'approved'
                                  ? '#4ade80'
                                  : c.status === 'pending'
                                  ? 'var(--arena-accent)'
                                  : '#f87171',
                            }}
                          >
                            {c.status === 'approved' && <CheckCircle2 className="w-3 h-3" />}
                            {c.status === 'approved' ? 'VERIFIED' : c.status.toUpperCase()}
                          </span>
                          {/* Active claims (pending/approved) can be released to free
                              the slot for a different card. Rejected ones can't. */}
                          {c.status !== 'rejected' && (
                            <button
                              type="button"
                              onClick={() => handleUnclaim(c)}
                              disabled={unclaiming === c.id}
                              className="arena-btn--ghost"
                              style={{ fontSize: '0.7rem', flexShrink: 0 }}
                              title="Release this profile"
                            >
                              {unclaiming === c.id ? 'Removing…' : 'Unclaim'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Profile completion meter — only shown until the profile is
                  fully filled out, then it gracefully disappears. */}
              {completionPct < 100 && (
                <div className="arena-profile__card arena-profile__card--pad">
                  <div className="arena-profile__complete-head">
                    <p className="arena-profile__label" style={{ margin: 0 }}>Profile Completion</p>
                    <span className="arena-profile__complete-pct">{completionPct}%</span>
                  </div>
                  <div className="arena-profile__meter">
                    <span className="arena-profile__meter-fill" style={{ width: `${completionPct}%` }} />
                  </div>
                  {nextStep && (
                    <p className="arena-profile__complete-next">
                      Next: <strong>{nextStep.label}</strong>
                    </p>
                  )}
                </div>
              )}

              {/* Account Verification */}
              <div className="arena-profile__card arena-profile__card--pad">
                <p className="arena-profile__label">Account Verification</p>
                <div className="arena-profile__verify-list">
                  <VerificationRow
                    label="Google"
                    linked={playerAccount.google_linked}
                    pending={linkPending === 'google'}
                    onVerify={verifyTarget === 'google' ? () => handleLink('google') : undefined}
                  />
                  <VerificationRow
                    label={
                      playerAccount.discord_username
                        ? `Discord — ${playerAccount.discord_username}`
                        : 'Discord'
                    }
                    linked={playerAccount.discord_linked}
                    pending={linkPending === 'discord'}
                    onVerify={verifyTarget === 'discord' ? () => handleLink('discord') : undefined}
                  />
                </div>
                {!playerAccount.is_verified && (
                  <p className="arena-contact__hint" style={{ marginTop: '0.85rem', textAlign: 'left' }}>
                    Verify both accounts to earn your Verified User badge.
                  </p>
                )}
              </div>

              {/* "We found a profile that may be you" — cards matching the user's
                  verified Riot ID. Hidden once they already hold an active claim
                  (one profile per user). */}
              {profileMatches.length > 0 && !matchHasActiveClaim && (
                <div className="arena-profile__card arena-profile__card--pad arena-profile__match">
                  <p className="arena-profile__label" style={{ color: 'var(--arena-accent)' }}>
                    <Sparkles className="w-4 h-4" /> We found you
                  </p>
                  <p className="arena-profile__match-blurb">
                    Your verified game account matches {profileMatches.length === 1 ? 'a player profile' : `${profileMatches.length} player profiles`}.
                    Open {profileMatches.length === 1 ? 'it' : 'one'} to claim {profileMatches.length === 1 ? 'it' : 'your profile'}.
                  </p>
                  <div className="arena-profile__match-list">
                    {profileMatches.map(m => (
                      <Link
                        key={`${m.tournamentId}-${m.playerId}`}
                        to={`/player/${m.tournamentId}/${m.playerId}`}
                        className="arena-profile__match-row"
                      >
                        <span className="arena-profile__match-id">
                          <span className="arena-profile__match-name">{m.playerName || m.riotId}</span>
                          <span className="arena-profile__match-meta">
                            {m.teamName ? `${m.teamName} · ` : ''}{m.tournamentName || 'Tournament'}
                          </span>
                        </span>
                        <ChevronRight className="w-4 h-4 arena-profile__match-chevron" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Connect-game-account nudge — Discord linked but no verified game
                  connection captured yet, so we can't find their profile. Hidden
                  once a connection is captured, or if they already hold ANY claim
                  (active or historic) — covers users who claimed before this
                  feature existed (they have riot_id_verified but not
                  riot_connection_verified, so the match fetch never ran). */}
              {playerAccount.discord_linked && !playerAccount.riot_connection_verified &&
               profileMatches.length === 0 && !matchHasActiveClaim &&
               !myClaims.some(c => c.status !== 'rejected') && (
                <div className="arena-profile__card arena-profile__card--pad arena-profile__riot-nudge">
                  <p className="arena-profile__label">
                    <Gamepad2 className="w-4 h-4" /> Find your player profile
                  </p>
                  <p className="arena-profile__match-blurb">
                    Link your <strong>game account</strong> to your Discord (Discord → Settings →
                    Connections), then verify here — we’ll check if any tournament player profile is
                    yours and let you claim it.
                  </p>
                  <button
                    type="button"
                    className="arena-profile__side-btn"
                    onClick={handleConnectRiot}
                    disabled={riotPending}
                    style={{ borderColor: 'var(--arena-accent-dim)', color: 'var(--arena-accent)' }}
                  >
                    <Gamepad2 className="w-3.5 h-3.5" />
                    {riotPending ? 'Redirecting…' : 'Verify game account'}
                  </button>
                </div>
              )}

              {/* Invite friends / referral — unlocks more pickems */}
              {referral && (
                <ReferralCard
                  referral={referral}
                  verified={playerAccount.is_verified}
                  copied={refCopied}
                  onCopy={() => {
                    const link = `${window.location.origin}/login?ref=${referral.code}`;
                    navigator.clipboard.writeText(link)
                      .then(() => { setRefCopied(true); setTimeout(() => setRefCopied(false), 2000); })
                      .catch(() => {});
                  }}
                />
              )}

            </aside>

            {/* ── Right: edit form ── */}
            <div className="arena-profile__card">
              {/* Public Identity */}
              <div className="arena-profile__section">
                <p className="arena-profile__label">Public Identity</p>
                <div className="arena-contact__form">
                  <div className="arena-contact__field">
                    <label htmlFor="pp-name" className="arena-contact__hint" style={{ textAlign: 'left' }}>
                      Display Name
                    </label>
                    <input
                      id="pp-name"
                      value={displayName}
                      maxLength={NAME_LIMIT}
                      onChange={e => setDisplayName(e.target.value)}
                      className="arena-contact__input"
                    />
                  </div>

                  <div className="arena-contact__field">
                    <label htmlFor="pp-bio" className="arena-contact__hint" style={{ textAlign: 'left' }}>
                      Bio
                    </label>
                    <textarea
                      id="pp-bio"
                      value={bio}
                      maxLength={BIO_LIMIT}
                      rows={4}
                      onChange={e => setBio(e.target.value)}
                      className="arena-contact__input arena-contact__textarea"
                      placeholder="Tell the arena who you are…"
                    />
                    <p className="arena-contact__hint">{bio.length}/{BIO_LIMIT}</p>
                  </div>
                </div>
              </div>

              <div className="arena-profile__divider" />

              {/* Social Links */}
              <div className="arena-profile__section">
                <p className="arena-profile__label">Social Links</p>
                <div className="arena-contact__form">
                  {SOCIAL_FIELDS.map(f => {
                    const Icon = f.icon;
                    return (
                      <div key={f.key} className="arena-contact__field">
                        <label htmlFor={`pp-${f.key}`} className="arena-contact__hint" style={{ textAlign: 'left' }}>
                          {f.label}
                        </label>
                        <div className="arena-profile__input-wrap">
                          <Icon className="w-4 h-4" />
                          <input
                            id={`pp-${f.key}`}
                            value={socials[f.key] ?? ''}
                            onChange={e => setSocials(prev => ({ ...prev, [f.key]: e.target.value }))}
                            placeholder={f.placeholder}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="arena-profile__divider" />

              {/* Save */}
              <div className="arena-profile__save-bar">
                <p>
                  {error ? (
                    <span className="arena-contact__error">{error}</span>
                  ) : (
                    'Changes are visible on your public profile immediately.'
                  )}
                </p>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="arena-btn arena-btn--primary"
                >
                  {saving ? 'Saving…' : savedToast ? 'Saved ✓' : 'Save Profile'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Riot-connection verify result toast (after ?riot=1). */}
      {riotToast && (
        <div
          className={`arena-toast${riotToast.kind === 'none' ? ' arena-toast--warn' : ''}`}
          role="status"
          aria-live="polite"
        >
          {riotToast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <Gamepad2 className="w-4 h-4" />}
          {riotToast.msg}
        </div>
      )}

      <Footer />
    </div>
  );
}

function VerificationRow({
  label,
  linked,
  pending,
  onVerify,
}: {
  label: string;
  linked: boolean;
  pending: boolean;
  onVerify?: () => void;
}) {
  return (
    <div className={`arena-profile__verify-row${linked ? ' is-linked' : ''}`}>
      <span className="arena-profile__verify-id">
        <span className={`arena-profile__verify-dot${linked ? ' is-on' : ''}`} />
        <span>{label}</span>
      </span>
      {linked ? (
        <span className="arena-profile__verify-tag is-linked">
          <BadgeCheck className="w-3.5 h-3.5" /> Linked
        </span>
      ) : onVerify ? (
        <button onClick={onVerify} disabled={pending} className="arena-profile__verify-btn">
          {pending ? 'Redirecting…' : 'Verify'}
        </button>
      ) : (
        <span className="arena-profile__verify-tag is-muted">Not linked</span>
      )}
    </div>
  );
}

// Invite-a-friend card. Surfaces the user's referral link + explains the payoff:
// each verified friend unlocks more pickem predictions, unlimited after 3.
function ReferralCard({
  referral,
  verified,
  copied,
  onCopy,
}: {
  referral: ReferralStats;
  verified: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const link = `${window.location.origin}/login?ref=${referral.code}`;
  const toUnlimited = Math.max(0, 3 - referral.verified);
  return (
    <div className="arena-profile__card arena-profile__card--pad arena-profile__referral">
      <p className="arena-profile__label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Users className="w-4 h-4" /> Invite Friends
      </p>
      <p className="arena-profile__referral-blurb">
        Share your invite link. When a friend signs up and verifies (Google + Discord),
        you unlock <strong>+5 pickem predictions</strong> for every tournament — and after
        <strong> 3 verified friends</strong> your pickems become <strong>unlimited</strong>.
      </p>

      <div className="arena-profile__referral-link">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Your invite link" />
        <button onClick={onCopy} className="arena-profile__referral-copy" title="Copy invite link">
          {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="arena-profile__referral-stats">
        <div className="arena-profile__referral-progress">
          <span className={referral.verified >= 1 ? 'is-on' : ''} />
          <span className={referral.verified >= 2 ? 'is-on' : ''} />
          <span className={referral.verified >= 3 ? 'is-on' : ''} />
        </div>
        <span className="arena-profile__referral-count">
          {referral.verified >= 3
            ? 'Unlimited unlocked 🎉'
            : `${referral.verified}/3 verified · ${toUnlimited} more to unlimited`}
        </span>
      </div>
      {referral.total > referral.verified && (
        <p className="arena-profile__referral-pending">
          {referral.total - referral.verified} invited friend{referral.total - referral.verified === 1 ? '' : 's'} not verified yet.
        </p>
      )}
      {!verified && (
        <p className="arena-contact__hint" style={{ marginTop: '0.6rem', textAlign: 'left' }}>
          Tip: verify your own account to start playing pickems with the picks you unlock.
        </p>
      )}
    </div>
  );
}
