import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, ShieldQuestion, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  clearClaimIntent,
  getClaimForCard,
  getMyActiveClaim,
  getPublicPlayerAccount,
  readClaimIntent,
  startClaimReauth,
  submitClaim,
  type ClaimSubmitResult,
  type PlayerAccount,
  type PlayerClaim,
} from '../services/supabase';

// Claim state + claimed-owner profile for one tournament player card.
// `tournamentId`/`playerId` must identify the card where the player actually
// lives (the resolved source tournament) — the edge function looks the card up
// in that tournament's blob.
export function useClaim(tournamentId: string, playerId: string) {
  const { userId } = useAuth();
  const [claim, setClaim] = useState<PlayerClaim | null>(null);
  const [owner, setOwner] = useState<PlayerAccount | null>(null);
  // The signed-in user's active claim anywhere (a user may hold only one).
  const [myActiveClaim, setMyActiveClaim] = useState<PlayerClaim | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!tournamentId || !playerId) { setLoaded(true); return; }
    const [c, mine] = await Promise.all([
      getClaimForCard(tournamentId, playerId),
      userId ? getMyActiveClaim() : Promise.resolve(null),
    ]);
    setClaim(c);
    setMyActiveClaim(mine);
    setOwner(c?.status === 'approved' ? await getPublicPlayerAccount(c.user_id) : null);
    setLoaded(true);
  }, [tournamentId, playerId, userId]);

  // userId in deps: the claimant's own pending claim only becomes visible
  // (RLS) once their session is known.
  useEffect(() => { reload(); }, [reload, userId]);

  return { claim, owner, myActiveClaim, loaded, reload };
}

type DialogKind =
  | { kind: 'submitted' }
  | { kind: 'no_riot_connection' }
  | { kind: 'riot_unverified' }
  | { kind: 'riot_mismatch'; got?: string; expected?: string }
  | { kind: 'claim_taken' }
  | { kind: 'already_has_claim' }
  | { kind: 'reconnect' }
  | { kind: 'error' };

interface ClaimControlsProps {
  tournamentId: string;
  playerId: string;
  /** The card's Riot ID (claim requires one). */
  cardRiotId?: string;
  claim: PlayerClaim | null;
  /** The viewer's active claim on ANOTHER card, if any (blocks claiming here). */
  myActiveClaim: PlayerClaim | null;
  claimLoaded: boolean;
  /**
   * True only when this card's Riot ID matches the signed-in viewer's verified
   * Riot ID (background match in find-my-player-profiles). The claim button is
   * shown ONLY for a confirmed match — never to every verified user — so the
   * generic "claim anything" button is gone. The server still re-verifies on
   * submit, so this is a UX gate, not a security one.
   */
  isSuggestedMatch?: boolean;
  onClaimChanged: () => void;
  /** Fired with a short status when a submit resolves, so the parent can toast
   *  (e.g. "claim in review") and hide its suggestion banner without a refresh. */
  onClaimResult?: (result: ClaimSubmitResult['status']) => void;
}

// The "Claim this profile" button, pending chip, and the post-OAuth resume +
// result dialogs. Rendered inside the player hero. Desktop and mobile share
// the same markup (arena chips/buttons are responsive already).
export function ClaimControls({
  tournamentId,
  playerId,
  cardRiotId,
  claim,
  myActiveClaim,
  claimLoaded,
  isSuggestedMatch,
  onClaimChanged,
  onClaimResult,
}: ClaimControlsProps) {
  const { userId, playerAccount, providerToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [busy, setBusy] = useState(false);
  // Submit-once guard for the resume effect (StrictMode double-mount etc). Only
  // set once we ACTUALLY act (submit or give up) — never while still waiting for
  // the provider token to arrive (see the grace-window logic below).
  const resumed = useRef(false);
  // True from the moment we see a valid claim intent for this card on return,
  // until the provider token arrives or the grace window elapses. Used to start
  // the one-shot "give up → reconnect" timer exactly once.
  const waitingForToken = useRef(false);

  // Resume after the Discord round-trip: a stashed intent for THIS card (the
  // ?claim=1 param is just a hint; the intent is authoritative).
  //
  // RACE FIX: on return from Discord, `claimLoaded` (DB queries) and
  // `providerToken` (delivered async via onAuthStateChange SIGNED_IN) settle
  // INDEPENDENTLY. The old code consumed its single shot the instant
  // claimLoaded+userId were ready; if the token hadn't landed yet it wrongly
  // showed "reconnect" and the guard blocked recovery — the intermittent
  // "it didn't claim / shows the claim message again" bug. Now we hold the shot
  // open: while a valid reauth intent exists for this card but the token is not
  // here yet, we WAIT (this effect re-runs when providerToken arrives via deps),
  // and only fall back to reconnect after a bounded grace window.
  useEffect(() => {
    if (resumed.current || !claimLoaded) return;
    const intent = readClaimIntent();
    const isForThisCard = intent && intent.tournamentId === tournamentId && intent.playerId === playerId;
    if (!isForThisCard) return;
    if (!userId) return; // session not resolved yet — wait for a later render

    const submit = (token: string) => {
      resumed.current = true;
      clearClaimIntent();
      if (searchParams.has('claim')) {
        searchParams.delete('claim');
        setSearchParams(searchParams, { replace: true });
      }
      setBusy(true);
      submitClaim(token, tournamentId, playerId)
        .then((result: ClaimSubmitResult) => {
          onClaimResult?.(result.status);
          if (result.status === 'submitted') {
            setDialog({ kind: 'submitted' });
            onClaimChanged();
          } else if (result.status === 'no_riot_connection') setDialog({ kind: 'no_riot_connection' });
          else if (result.status === 'riot_unverified') setDialog({ kind: 'riot_unverified' });
          else if (result.status === 'riot_mismatch') setDialog({ kind: 'riot_mismatch', got: result.got, expected: result.expected });
          else if (result.status === 'claim_taken') { setDialog({ kind: 'claim_taken' }); onClaimChanged(); }
          else if (result.status === 'already_has_claim') { setDialog({ kind: 'already_has_claim' }); onClaimChanged(); }
          else if (result.status === 'bad_token') setDialog({ kind: 'reconnect' });
          else setDialog({ kind: 'error' });
        })
        .catch(() => setDialog({ kind: 'error' }))
        .finally(() => setBusy(false));
    };

    const giveUp = () => {
      // No claim-grade token arrived (hash consumed without one, a plain login /
      // background refresh token, or the intent wasn't a genuine reauth). Don't
      // submit a token we can't trust — offer a fresh reconnect.
      resumed.current = true;
      clearClaimIntent();
      if (searchParams.has('claim')) {
        searchParams.delete('claim');
        setSearchParams(searchParams, { replace: true });
      }
      setDialog({ kind: 'reconnect' });
    };

    // Happy path: a claim-grade token from this reauth is in hand → submit now.
    if (providerToken && intent.reauth) {
      submit(providerToken);
      return;
    }

    // The intent wasn't a real reauth (e.g. leftover) — nothing to wait for.
    if (!intent.reauth) {
      giveUp();
      return;
    }

    // Reauth intent but token not here yet. Hold the shot open: this effect will
    // re-run when providerToken lands (it's in deps). Arm a single fallback timer
    // so we don't wait forever if the token truly never comes.
    if (!waitingForToken.current) {
      waitingForToken.current = true;
      const timer = setTimeout(() => {
        if (!resumed.current) giveUp();
      }, 8000); // generous: covers slow SIGNED_IN delivery without hanging the UX
      return () => clearTimeout(timer);
    }
  }, [claimLoaded, userId, providerToken, tournamentId, playerId, searchParams, setSearchParams, onClaimChanged, onClaimResult]);

  const begin = async () => {
    setDialog(null);
    setBusy(true);
    try {
      await startClaimReauth(tournamentId, playerId);
      // Browser redirects to Discord — nothing more here.
    } catch {
      setBusy(false);
      setDialog({ kind: 'error' });
    }
  };

  const isMine = !!claim && claim.user_id === userId;

  // Does the viewer already hold an active claim on a DIFFERENT card? A user
  // may own only one profile at a time, so that blocks claiming here.
  const hasClaimElsewhere =
    !!myActiveClaim &&
    !(myActiveClaim.tournament_id === tournamentId && myActiveClaim.player_id === playerId);

  // Visibility rules:
  // - approved claim → nothing here (the hero shows the claimed profile)
  // - my pending claim on THIS card → status chip
  // - everyone else → nothing
  //
  // NOTE: the "Claim this profile" CTA lives in the PlayerPage suggestion banner
  // (arena-pp-claim-suggest), NOT here — having both produced two buttons. This
  // component still owns the pending chip, the post-OAuth resume, and every
  // result dialog; the banner's button just calls startClaimReauth, and the
  // resume effect below picks it up on return regardless of what triggered it.
  // `isSuggestedMatch`/`hasClaimElsewhere` are no longer used to render a button
  // here (the banner is the sole CTA), but remain part of the props/contract.
  void isSuggestedMatch; void hasClaimElsewhere;
  let control: React.ReactNode = null;
  if (claimLoaded && claim?.status === 'pending' && isMine) {
    control = (
      <span className="arena-pp-chip" style={{ borderColor: 'var(--arena-accent)', color: 'var(--arena-accent)' }}>
        <ShieldQuestion className="w-3.5 h-3.5" />
        Claim pending review
      </span>
    );
  }

  return (
    <>
      {control}
      {dialog && (
        <div className="arena-success-overlay" role="dialog" aria-modal="true" onClick={() => setDialog(null)}>
          <div className="arena-success-modal" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setDialog(null)}
              aria-label="Close"
              style={{ position: 'absolute', top: 10, right: 10, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              <X className="w-5 h-5" />
            </button>

            {dialog.kind === 'submitted' && (
              <>
                <span className="arena-success-modal__icon">✅</span>
                <p className="arena-success-modal__title">Claim submitted</p>
                <p className="arena-success-modal__body">
                  Your Riot ID matched this player. An admin will review your claim —
                  once approved, this profile is yours to customize from your{' '}
                  <Link to="/profile" style={{ textDecoration: 'underline' }}>player profile</Link>.
                </p>
              </>
            )}

            {(dialog.kind === 'no_riot_connection' || dialog.kind === 'riot_unverified') && (
              <>
                <span className="arena-success-modal__icon">🔗</span>
                <p className="arena-success-modal__title">
                  {dialog.kind === 'no_riot_connection' ? 'Riot account not connected' : 'Riot connection not verified'}
                </p>
                <p className="arena-success-modal__body">
                  {dialog.kind === 'no_riot_connection'
                    ? 'We couldn’t find a Riot Games connection on your Discord account.'
                    : 'Your Riot Games connection exists but isn’t verified by Discord.'}{' '}
                  Open Discord → <strong>Settings → Connections</strong>, connect your
                  <strong> Riot Games</strong> account (sign in through Riot so it shows as
                  verified), then try again.
                </p>
                <button className="arena-success-modal__btn" onClick={begin} disabled={busy}>
                  {busy ? 'Working…' : 'Try again'}
                </button>
              </>
            )}

            {dialog.kind === 'riot_mismatch' && (
              <>
                <span className="arena-success-modal__icon">❌</span>
                <p className="arena-success-modal__title">Riot ID doesn't match</p>
                <p className="arena-success-modal__body">
                  The Riot ID on your Discord{dialog.got ? <> (<strong>{dialog.got}</strong>)</> : null} doesn't
                  match this player{dialog.expected ? <> (<strong>{dialog.expected}</strong>)</> : null}.
                  You can only claim a profile that belongs to your own Riot account.
                </p>
              </>
            )}

            {dialog.kind === 'claim_taken' && (
              <>
                <span className="arena-success-modal__icon">🔒</span>
                <p className="arena-success-modal__title">Already claimed</p>
                <p className="arena-success-modal__body">
                  Someone has already claimed (or is claiming) this profile. If you believe
                  that's wrong, contact the tournament admins.
                </p>
              </>
            )}

            {dialog.kind === 'already_has_claim' && (
              <>
                <span className="arena-success-modal__icon">👤</span>
                <p className="arena-success-modal__title">You already have a profile</p>
                <p className="arena-success-modal__body">
                  You can only hold one claimed player profile at a time. To claim this
                  one instead, first unclaim your current profile from your{' '}
                  <Link to="/profile" style={{ textDecoration: 'underline' }}>player profile</Link> page.
                </p>
                <Link to="/profile" className="arena-success-modal__btn" style={{ display: 'inline-block', textDecoration: 'none' }}>
                  Go to my profile
                </Link>
              </>
            )}

            {dialog.kind === 'reconnect' && (
              <>
                <span className="arena-success-modal__icon">🔁</span>
                <p className="arena-success-modal__title">Reconnect Discord</p>
                <p className="arena-success-modal__body">
                  We need a fresh Discord authorization to read your Riot connection.
                  This takes a few seconds.
                </p>
                <button className="arena-success-modal__btn" onClick={begin} disabled={busy}>
                  {busy ? 'Working…' : 'Reconnect Discord'}
                </button>
              </>
            )}

            {dialog.kind === 'error' && (
              <>
                <span className="arena-success-modal__icon">⚠️</span>
                <p className="arena-success-modal__title">Something went wrong</p>
                <p className="arena-success-modal__body">
                  The claim couldn't be processed. Please try again in a moment.
                </p>
                <button className="arena-success-modal__btn" onClick={begin} disabled={busy}>
                  {busy ? 'Working…' : 'Try again'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Claimed-owner block: bio + socials shown on the hero once a claim is
// approved. The Verified Player tick is rendered by PlayerPage next to the
// name; this block carries the owner-authored content.
export function ClaimedProfileBlock({ owner }: { owner: PlayerAccount }) {
  const socials = Object.entries(owner.socials ?? {}).filter(([, v]) => v && String(v).trim());
  if (!owner.bio && socials.length === 0) return null;
  return (
    <div className="arena-pp-hero__claimed" style={{ marginTop: '0.75rem' }}>
      {owner.bio && (
        <p className="arena-body--sm" style={{ maxWidth: 560, whiteSpace: 'pre-wrap' }}>{owner.bio}</p>
      )}
      {socials.length > 0 && (
        <div className="arena-pp-hero__chips" style={{ marginTop: '0.5rem' }}>
          {socials.map(([key, url]) => (
            <a
              key={key}
              href={String(url)}
              target="_blank"
              rel="noopener noreferrer"
              className="arena-pp-chip arena-pp-chip--link arena-pp-chip--ghost"
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
