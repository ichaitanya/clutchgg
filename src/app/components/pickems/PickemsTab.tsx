import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Lock, Check, X, Users, Copy, Sparkles, ShieldCheck, Zap } from 'lucide-react';
import type { Tournament, BracketMatch } from '../TournamentCreation';
import { useAuth } from '../../context/AuthContext';
import {
  getTournamentQuestions, getMyPicks, getMyQuota, getPickemLeaderboard,
  getPickDistribution, getMyReferralStats, getMatchStates, submitPick, isQuestionLocked,
  type PickemQuestion, type PickemPick, type PickemQuota, type PickemScoreRow,
  type ReferralStats, type PickemMatchState,
} from '../../services/pickems';

type SubTab = 'play' | 'leaderboard';

interface Props {
  tournament: Tournament;
  matches: { match: BracketMatch; stage: string; status: 'upcoming' | 'live' | 'completed' }[];
}

export function PickemsTab({ tournament, matches }: Props) {
  const { userId, playerAccount } = useAuth();
  const verified = !!playerAccount?.is_verified;
  const [sub, setSub] = useState<SubTab>('play');

  const [questions, setQuestions] = useState<PickemQuestion[]>([]);
  const [picks, setPicks] = useState<Record<string, PickemPick>>({});
  const [quota, setQuota] = useState<PickemQuota | null>(null);
  const [dist, setDist] = useState<Record<string, Record<string, number>>>({});
  const [states, setStates] = useState<Record<string, PickemMatchState>>({});
  const [referral, setReferral] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const tid = tournament.id;

  const loadAll = useCallback(async () => {
    const [qs, ds, ms] = await Promise.all([getTournamentQuestions(tid), getPickDistribution(tid), getMatchStates(tid)]);
    setQuestions(qs);
    setDist(ds);
    setStates(ms);
    if (userId) {
      const [ps, q, r] = await Promise.all([getMyPicks(tid), getMyQuota(), getMyReferralStats()]);
      setPicks(Object.fromEntries(ps.map(p => [p.question_id, p])));
      setQuota(q);
      setReferral(r);
    } else {
      setPicks({}); setQuota(null); setReferral(null);
    }
    setLoading(false);
  }, [tid, userId]);

  useEffect(() => { setLoading(true); loadAll(); }, [loadAll]);

  // Poll while the tab is visible so newly locked/graded questions, results, and
  // leaderboard movement appear without a manual refresh (mirrors the tournament
  // page's polling). Silent re-fetch — never flips the loader back on.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => { if (document.visibilityState === 'visible') loadAll(); };
    timer = setInterval(tick, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') loadAll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [loadAll]);

  // Group questions by match, ordered to match the page's match list.
  const byMatch = useMemo(() => {
    const map = new Map<string, PickemQuestion[]>();
    for (const q of questions) {
      const arr = map.get(q.match_id) ?? [];
      arr.push(q);
      map.set(q.match_id, arr);
    }
    return map;
  }, [questions]);

  const matchOrder = useMemo(() => {
    // Only PUBLISHED matches show in the player view (a staff viewer would
    // otherwise see drafts here — drafts belong in the admin panel). Live/
    // upcoming first (playable), completed after.
    const rank = (s: string) => (s === 'live' ? 0 : s === 'upcoming' ? 1 : 2);
    return [...matches]
      .filter(m => byMatch.has(m.match.id) && states[m.match.id]?.published)
      .sort((a, b) => rank(a.status) - rank(b.status));
  }, [matches, byMatch, states]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const onPick = async (q: PickemQuestion, optionId: string) => {
    if (!userId) { showToast('Sign in to play pickems.'); return; }
    if (!verified) { showToast('Verify your account to play.'); return; }
    // Optimistic update.
    const prev = picks[q.id];
    setPicks(p => ({ ...p, [q.id]: { question_id: q.id, option_id: optionId, is_correct: null, points_awarded: 0 } }));
    const res = await submitPick(q.id, optionId);
    if (res.ok) {
      if (res.quota) setQuota(res.quota);
      showToast('Pick saved.');
    } else {
      // Revert and explain.
      setPicks(p => { const n = { ...p }; if (prev) n[q.id] = prev; else delete n[q.id]; return n; });
      const reason = res.reason;
      showToast(
        reason === 'locked' ? 'Picks are locked for this question.'
        : reason === 'not_verified' ? 'Verify your account to play.'
        : reason === 'quota_exceeded' ? 'Out of picks — invite friends to unlock more.'
        : res.error || 'Could not save your pick.'
      );
      if (reason === 'quota_exceeded') getMyQuota().then(setQuota);
    }
  };

  if (loading) {
    return <div className="arena-pickems__empty">Loading pickems…</div>;
  }

  if (questions.length === 0) {
    return (
      <div className="arena-pickems__empty">
        <Sparkles className="w-5 h-5" />
        <p>No pickems yet for this tournament. Check back once the organizer publishes match questions.</p>
      </div>
    );
  }

  return (
    <div className="arena-pickems">
      {/* Sub-tab switch */}
      <div className="arena-pickems__subtabs">
        <button className={`arena-pickems__subtab${sub === 'play' ? ' is-active' : ''}`} onClick={() => setSub('play')}>
          Play
        </button>
        <button className={`arena-pickems__subtab${sub === 'leaderboard' ? ' is-active' : ''}`} onClick={() => setSub('leaderboard')}>
          <Trophy className="w-3.5 h-3.5" /> Leaderboard
        </button>
      </div>

      {sub === 'play' ? (
        <div className="arena-pickems__play">
          {/* Gate / quota banner */}
          <GateBanner userId={userId} verified={verified} quota={quota} />

          {/* Referral unlock card (signed-in verified users) */}
          {userId && verified && referral && (
            <ReferralCard referral={referral} quota={quota} onCopy={showToast} />
          )}

          {/* Matches */}
          {matchOrder.map(({ match, stage, status }) => {
            const qs = (byMatch.get(match.id) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
            return (
              <div key={match.id} className="arena-pickems__match">
                <div className="arena-pickems__match-head">
                  <div className="arena-pickems__match-headings">
                    <span className="arena-pickems__match-eyebrow">Match Predictions</span>
                    <div className="arena-pickems__match-teams">
                      <span className="arena-pickems__match-t1">{match.team1Name}</span>
                      <span className="arena-pickems__vs">vs</span>
                      {match.team2Name}
                    </div>
                  </div>
                  <div className="arena-pickems__match-meta">
                    <span className="arena-pickems__stage">{stage}</span>
                    {status === 'completed' && <span className="arena-pickems__chip arena-pickems__chip--done">Final</span>}
                    {status === 'live' && <span className="arena-pickems__chip arena-pickems__chip--live"><span className="arena-pickems__live-dot" />Live</span>}
                    {status === 'upcoming' && <span className="arena-pickems__chip arena-pickems__chip--soon">Upcoming</span>}
                  </div>
                </div>
                <div className="arena-pickems__questions">
                  {qs.map(q => (
                    <QuestionCard
                      key={q.id}
                      q={q}
                      pick={picks[q.id]}
                      dist={dist[q.id]}
                      resultsPublished={!!states[match.id]?.results_published}
                      disabled={!userId || !verified}
                      onPick={(opt) => onPick(q, opt)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <LeaderboardView tournamentId={tid} meId={userId} />
      )}

      {toast && <div className="arena-pickems__toast">{toast}</div>}
    </div>
  );
}

// ── Gate / quota banner ───────────────────────────────────────────────────────
function GateBanner({ userId, verified, quota }: { userId: string | null; verified: boolean; quota: PickemQuota | null }) {
  if (!userId) {
    return (
      <div className="arena-pickems__gate">
        <ShieldCheck className="w-4 h-4" />
        <span><Link to="/login" className="arena-pickems__link">Sign in</Link> and verify your account to make picks and earn points.</span>
      </div>
    );
  }
  if (!verified) {
    return (
      <div className="arena-pickems__gate">
        <ShieldCheck className="w-4 h-4" />
        <span>Pickems are for verified players. <Link to="/profile" className="arena-pickems__link">Verify your account</Link> (Google + Discord) to play.</span>
      </div>
    );
  }
  return (
    <div className="arena-pickems__quota">
      <Zap className="w-4 h-4" />
      {quota?.unlimited
        ? <span><strong>Unlimited picks</strong> unlocked — thanks for inviting friends!</span>
        : <span><strong>{Math.max(0, (quota?.allowance ?? 0) - (quota?.used ?? 0))} picks left</strong> of {quota?.allowance ?? 0}. Each question you answer uses one pick — changing an answer before lock is free. Invite friends to unlock more.</span>}
    </div>
  );
}

// ── Referral card ─────────────────────────────────────────────────────────────
function ReferralCard({ referral, quota, onCopy }: { referral: ReferralStats; quota: PickemQuota | null; onCopy: (m: string) => void }) {
  const link = `${window.location.origin}/login?ref=${referral.code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); onCopy('Invite link copied!'); }
    catch { onCopy('Copy failed — select and copy the link.'); }
  };
  const verified = referral.verified;
  const toUnlimited = Math.max(0, 3 - verified);
  return (
    <div className="arena-pickems__referral">
      <div className="arena-pickems__referral-head">
        <Users className="w-4 h-4" />
        <span>Invite & unlock picks</span>
      </div>
      <p className="arena-pickems__referral-sub">
        {quota?.unlimited
          ? 'You have unlimited picks. Keep sharing to grow the arena!'
          : `Each verified friend unlocks +5 picks. ${toUnlimited} more verified ${toUnlimited === 1 ? 'invite' : 'invites'} → unlimited.`}
      </p>
      <div className="arena-pickems__referral-link">
        <input readOnly value={link} onFocus={e => e.currentTarget.select()} />
        <button onClick={copy} title="Copy invite link"><Copy className="w-3.5 h-3.5" /> Copy</button>
      </div>
      <div className="arena-pickems__referral-progress">
        <span className={verified >= 1 ? 'is-on' : ''} />
        <span className={verified >= 2 ? 'is-on' : ''} />
        <span className={verified >= 3 ? 'is-on' : ''} />
        <em>{verified}/3 verified</em>
      </div>
    </div>
  );
}

// ── One question ──────────────────────────────────────────────────────────────
function QuestionCard({ q, pick, dist, resultsPublished, disabled, onPick }: {
  q: PickemQuestion;
  pick?: PickemPick;
  dist?: Record<string, number>;
  resultsPublished: boolean;
  disabled: boolean;
  onPick: (optionId: string) => void;
}) {
  const locked = isQuestionLocked(q);
  // Results (correct answer, ✓/✗, points) are only REVEALED once the organizer
  // publishes results for the match — even though the question is graded in the
  // DB. Before that players just see their pick as locked. We also treat a pick
  // that already carries a graded outcome (is_correct set) as a reveal signal, so
  // results show even if the match-state map momentarily lags.
  const decided = q.status === 'graded' || q.status === 'void';
  const graded = decided && (resultsPublished || pick?.is_correct != null);
  const totalVotes = dist ? Object.values(dist).reduce((a, b) => a + b, 0) : 0;
  // Player-pick questions (top ACS / MVP) get a denser 2-col grid with name+team.
  const isPlayerKind = q.kind === 'top_acs' || q.kind === 'mvp';

  const scored = graded && pick?.is_correct === true;
  const noPoints = graded && pick && pick.is_correct !== true;
  return (
    <div className="arena-pickems__q">
      <div className="arena-pickems__q-head">
        <span className="arena-pickems__q-prompt">{q.prompt}</span>
        <div className="arena-pickems__q-badges">
          {scored && <span className="arena-pickems__q-badge arena-pickems__q-badge--scored">+{pick?.points_awarded} pts</span>}
          {noPoints && <span className="arena-pickems__q-badge arena-pickems__q-badge--none">No points</span>}
          {locked && !graded && <span className="arena-pickems__q-badge arena-pickems__q-badge--lock"><Lock className="w-3 h-3" /> Locked</span>}
          {q.status === 'void' && !pick && <span className="arena-pickems__q-badge arena-pickems__q-badge--none">Void</span>}
          <span className="arena-pickems__q-pts">{q.points} pts</span>
        </div>
      </div>
      <div className={`arena-pickems__opts${isPlayerKind ? ' arena-pickems__opts--player' : ''}`}>
        {q.options.map(opt => {
          const mine = pick?.option_id === opt.id;
          const isCorrect = graded && q.correct_option_id === opt.id;
          const isWrongMine = graded && mine && q.correct_option_id !== opt.id;
          const votes = dist?.[opt.id] ?? 0;
          const pct = totalVotes > 0 ? Math.round((votes / totalVotes) * 100) : 0;
          // Player options come labelled "Name (Team)" — split for a two-line card.
          const m = isPlayerKind ? /^(.*?)\s*\(([^)]+)\)\s*$/.exec(opt.label) : null;
          const primary = m ? m[1] : opt.label;
          const secondary = m ? m[2] : null;
          const cls = [
            'arena-pickems__opt',
            isPlayerKind ? 'arena-pickems__opt--player' : '',
            mine ? 'is-mine' : '',
            isCorrect ? 'is-correct' : '',
            isWrongMine ? 'is-wrong' : '',
            locked ? 'is-locked' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={opt.id}
              className={cls}
              disabled={disabled || locked}
              onClick={() => onPick(opt.id)}
            >
              {/* sentiment bar (post-lock only) */}
              {locked && totalVotes > 0 && <span className="arena-pickems__opt-bar" style={{ width: `${pct}%` }} />}
              <span className="arena-pickems__opt-label">
                <span className="arena-pickems__opt-primary">{primary}</span>
                {secondary && <span className="arena-pickems__opt-secondary">{secondary}</span>}
              </span>
              <span className="arena-pickems__opt-right">
                {locked && totalVotes > 0 && <span className="arena-pickems__opt-pct">{pct}%</span>}
                {isCorrect && <Check className="w-3.5 h-3.5" />}
                {isWrongMine && <X className="w-3.5 h-3.5" />}
                {!graded && mine && <span className="arena-pickems__opt-dot" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function initials(name?: string) { return (name ?? '?').slice(0, 2).toUpperCase(); }

function LeaderboardView({ tournamentId, meId }: { tournamentId: string; meId: string | null }) {
  const [rows, setRows] = useState<PickemScoreRow[] | null>(null);
  useEffect(() => { getPickemLeaderboard(tournamentId).then(setRows); }, [tournamentId]);

  if (rows === null) return <div className="arena-pickems__empty">Loading leaderboard…</div>;
  if (rows.length === 0) return <div className="arena-pickems__empty">No scores yet — points appear once matches are graded.</div>;

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  // wrong = answered questions that didn't score. total_picks counts graded picks.
  const wrongOf = (r: PickemScoreRow) => Math.max(0, (r.total_picks ?? 0) - (r.correct_count ?? 0));

  return (
    <div className="arena-pickems__lb-wrap">
      {/* Podium — top 3, with #1 raised in the centre. */}
      {top3.length > 0 && (
        <div className="arena-pickems__podium">
          {/* order: 2nd, 1st, 3rd */}
          {[top3[1], top3[0], top3[2]].map((r, i) => {
            if (!r) return <div key={`empty-${i}`} className="arena-pickems__podium-slot is-empty" />;
            const place = r === top3[0] ? 1 : r === top3[1] ? 2 : 3;
            return (
              <div
                key={r.user_id}
                className={`arena-pickems__podium-slot is-p${place}${r.user_id === meId ? ' is-me' : ''}`}
              >
                <div className="arena-pickems__podium-avatar">
                  {r.avatar_url
                    ? <img src={r.avatar_url} alt="" />
                    : <span>{initials(r.display_name)}</span>}
                </div>
                <div className="arena-pickems__podium-id">
                  <span className="arena-pickems__podium-name">{r.display_name ?? 'Player'}</span>
                  <span className="arena-pickems__podium-rank">#{place}</span>
                </div>
                <div className="arena-pickems__podium-pts">{r.points} pts</div>
                <div className="arena-pickems__podium-record">
                  <span className="is-correct"><Check className="w-3 h-3" />{r.correct_count}</span>
                  <span className="is-wrong"><X className="w-3 h-3" />{wrongOf(r)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table for ranks 4+ */}
      {rest.length > 0 && (
        <div className="arena-pickems__lb">
          <div className="arena-pickems__lb-head">
            <span className="arena-pickems__lb-rank">#</span>
            <span className="arena-pickems__lb-player">Player</span>
            <span className="arena-pickems__lb-num arena-pickems__lb--hide">Correct</span>
            <span className="arena-pickems__lb-num arena-pickems__lb--hide">Wrong</span>
            <span className="arena-pickems__lb-num">Points</span>
          </div>
          {rest.map((r, i) => (
            <div key={r.user_id} className={`arena-pickems__lb-row${r.user_id === meId ? ' is-me' : ''}`}>
              <span className="arena-pickems__lb-rank">{i + 4}</span>
              <span className="arena-pickems__lb-player">
                {r.avatar_url
                  ? <img src={r.avatar_url} alt="" className="arena-pickems__lb-avatar" />
                  : <span className="arena-pickems__lb-avatar arena-pickems__lb-avatar--ph">{initials(r.display_name)}</span>}
                <span className="arena-pickems__lb-name">{r.display_name ?? 'Player'}</span>
                {r.user_id === meId && <span className="arena-pickems__lb-you">YOU</span>}
                {r.is_verified && <ShieldCheck className="w-3.5 h-3.5 arena-pickems__lb-badge" />}
              </span>
              <span className="arena-pickems__lb-num arena-pickems__lb--hide arena-pickems__lb-correct"><Check className="w-3 h-3" />{r.correct_count}</span>
              <span className="arena-pickems__lb-num arena-pickems__lb--hide arena-pickems__lb-wrong"><X className="w-3 h-3" />{wrongOf(r)}</span>
              <span className="arena-pickems__lb-num arena-pickems__lb-pts">{r.points}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
