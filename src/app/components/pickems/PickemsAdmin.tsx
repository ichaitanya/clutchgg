import { useEffect, useMemo, useState, useCallback } from 'react';
import { Sparkles, Lock, Trophy, Plus, Trash2, Check, ChevronDown, AlertTriangle, RefreshCw, Pencil, Eye, EyeOff, Send } from 'lucide-react';
import type { Tournament, BracketMatch } from '../TournamentCreation';
import {
  getTournamentQuestions, getMatchStates, seedPickems, gradeMatchPickems, overridePickemAnswer,
  createCustomQuestion, updateQuestion, deleteQuestion, lockMatchPickems, unlockMatchPickems,
  publishMatch, unpublishMatch, publishResults, setMyPickemScoreOptIn, getMyPickemScoreOptIn,
  type PickemQuestion, type PickemMatchState,
} from '../../services/pickems';
import { supabase } from '../../services/supabase';

// Organizer-facing pickems management for one tournament. Lives inside the
// TournamentManager detail view. Uses the admin panel's Tailwind dark styling
// (not the public arena-* classes) to match its surroundings. Every mutating
// action goes through an edge function (service role) — this UI only orchestrates.
//
// Lifecycle: DRAFT (org edits) → PUBLISH (visible to players) → grade → review →
// PUBLISH RESULTS (points revealed). After publish, only a superadmin can edit
// the questions; the organizer keeps grade/results control.

interface Props { tournament: Tournament; isSuperAdmin?: boolean }

// Pull every listable match (both teams real) across the tournament's brackets.
function collectMatches(t: Tournament): { match: BracketMatch; stage: string }[] {
  const out: { match: BracketMatch; stage: string }[] = [];
  const push = (b: any, stage: string) => {
    for (const round of b?.rounds ?? []) {
      for (const m of round ?? []) {
        if (!m?.team1Id || !m?.team2Id) continue;
        // Skip placeholder slots ("Winner of N").
        const slotish = (n?: string) => !n || /^(winner|loser) of/i.test(n) || n.includes('TBD');
        if (slotish(m.team1Name) || slotish(m.team2Name)) continue;
        out.push({ match: m, stage });
      }
    }
  };
  push(t.generatedBracket, 'Main');
  push(t.stage1Bracket, 'Stage 1');
  push(t.stage2Bracket, 'Stage 2');
  push(t.knockoutBracket, 'Knockout');
  return out;
}

export function PickemsAdmin({ tournament, isSuperAdmin = false }: Props) {
  const [questions, setQuestions] = useState<PickemQuestion[]>([]);
  const [states, setStates] = useState<Record<string, PickemMatchState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [scoreOptIn, setScoreOptIn] = useState(false);

  const matches = useMemo(() => collectMatches(tournament), [tournament]);

  const reload = useCallback(async () => {
    const [qs, ms] = await Promise.all([getTournamentQuestions(tournament.id, supabase), getMatchStates(tournament.id)]);
    setQuestions(qs);
    setStates(ms);
  }, [tournament.id]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (isSuperAdmin) getMyPickemScoreOptIn(tournament.id).then(setScoreOptIn);
  }, [tournament.id, isSuperAdmin]);

  const toggleScoreOptIn = async () => {
    const next = !scoreOptIn;
    setBusy('score-opt-in'); setErr(null);
    try { await setMyPickemScoreOptIn(tournament.id, next); setScoreOptIn(next); }
    catch (e: any) { setErr(e?.message || 'Action failed'); }
    finally { setBusy(null); }
  };

  const byMatch = useMemo(() => {
    const m = new Map<string, PickemQuestion[]>();
    for (const q of questions) {
      const arr = m.get(q.match_id);
      if (arr) arr.push(q);
      else m.set(q.match_id, [q]);
    }
    return m;
  }, [questions]);

  const run = async (key: string, fn: () => Promise<any>) => {
    setBusy(key); setErr(null);
    try { await fn(); await reload(); }
    catch (e: any) { setErr(e?.message || 'Action failed'); }
    finally { setBusy(null); }
  };

  return (
    <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#ff4655]" /> Pickems
        </h3>
        <span className="text-gray-500 text-xs">{questions.length} questions across {byMatch.size} matches</span>
      </div>

      {isSuperAdmin && (
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={scoreOptIn}
            disabled={busy === 'score-opt-in'}
            onChange={toggleScoreOptIn}
            className="accent-[#ff4655]"
          />
          Include me on this tournament's pickem leaderboard (superadmins are excluded by default)
        </label>
      )}

      {err && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-3 py-2 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> {err}
        </div>
      )}

      {matches.length === 0 && (
        <p className="text-gray-500 text-sm">No matches with both teams assigned yet. Assign teams in the bracket to enable pickems.</p>
      )}

      <div className="space-y-3">
        {matches.map(({ match, stage }) => {
          const qs = (byMatch.get(match.id) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const seeded = qs.length > 0;
          const st = states[match.id];
          const published = !!st?.published;
          const resultsLive = !!st?.results_published;
          const ungraded = qs.filter(q => q.status === 'open' || q.status === 'locked').length;
          const needsGrading = !!match.winner && ungraded > 0;
          const canEditQuestions = !published || isSuperAdmin; // org pre-publish, else superadmin
          const isOpen = open === match.id;
          return (
            <div key={match.id} className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg">
              <button
                onClick={() => setOpen(isOpen ? null : match.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left gap-2"
              >
                <div className="min-w-0">
                  <p className="text-white text-sm font-semibold truncate">
                    {match.team1Name} <span className="text-gray-500">vs</span> {match.team2Name}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {stage} · {seeded ? `${qs.length} questions` : 'not seeded'}
                    {needsGrading && <span className="text-yellow-400"> · needs grading</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Lifecycle badge */}
                  {!published && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-700/50 text-gray-300 uppercase tracking-wide">Draft</span>}
                  {published && !resultsLive && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-900/40 text-green-300 uppercase tracking-wide">Published</span>}
                  {resultsLive && <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#ff4655]/20 text-[#ff8a93] uppercase tracking-wide">Results live</span>}
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t border-[#2a2d3a] pt-3">
                  {/* Lifecycle hint */}
                  {published && !isSuperAdmin && (
                    <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                      <Lock className="w-3 h-3" /> Questions are published — only a superadmin can change them now. You can still grade and publish results.
                    </p>
                  )}

                  {/* Authoring actions (pre-publish for org; always for superadmin) */}
                  <div className="flex flex-wrap gap-2">
                    {canEditQuestions && (
                      <button
                        onClick={() => run(`seed-${match.id}`, () => seedPickems(tournament.id, match.id))}
                        disabled={busy !== null}
                        className="px-3 py-1.5 rounded-lg bg-[#1e2130] hover:bg-[#2a2d3a] text-gray-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Sparkles className="w-3.5 h-3.5" /> {seeded ? 'Add missing defaults' : 'Seed default questions'}
                      </button>
                    )}

                    {/* Publish / unpublish */}
                    {seeded && !published && (
                      <button
                        onClick={() => run(`pub-${match.id}`, () => publishMatch(tournament.id, match.id))}
                        disabled={busy !== null || qs.length < 5}
                        title={qs.length < 5 ? 'Add at least 5 questions first' : 'Make these questions visible to players'}
                        className="px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Eye className="w-3.5 h-3.5" /> Publish to players
                      </button>
                    )}
                    {published && !resultsLive && (
                      <button
                        onClick={() => run(`unpub-${match.id}`, () => unpublishMatch(tournament.id, match.id))}
                        disabled={busy !== null}
                        title="Hide again (only works before anyone has picked)"
                        className="px-3 py-1.5 rounded-lg bg-[#1e2130] hover:bg-[#2a2d3a] text-gray-300 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <EyeOff className="w-3.5 h-3.5" /> Unpublish
                      </button>
                    )}
                  </div>

                  {/* Grading + results actions (available once published) */}
                  {seeded && published && (
                    <div className="flex flex-wrap gap-2">
                      {/* Check if any questions are open to show lock button */}
                      {qs.some(q => q.status === 'open') && (
                        <button
                          onClick={() => run(`lock-${match.id}`, () => lockMatchPickems(tournament.id, match.id))}
                          disabled={busy !== null}
                          className="px-3 py-1.5 rounded-lg bg-[#1e2130] hover:bg-[#2a2d3a] text-gray-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Lock className="w-3.5 h-3.5" /> Lock all
                        </button>
                      )}
                      {/* Superadmin unlock: only show when some questions are locked */}
                      {isSuperAdmin && qs.some(q => q.status === 'locked') && (
                        <button
                          onClick={() => { if (confirm('Unlock all questions in this match? Players will be able to change their picks.')) run(`unlock-${match.id}`, () => unlockMatchPickems(tournament.id, match.id)); }}
                          disabled={busy !== null}
                          className="px-3 py-1.5 rounded-lg bg-yellow-700 hover:bg-yellow-600 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Lock className="w-3.5 h-3.5" /> Unlock all
                        </button>
                      )}
                      <button
                        onClick={() => run(`grade-${match.id}`, () => gradeMatchPickems(tournament.id, match.id))}
                        disabled={busy !== null}
                        className="px-3 py-1.5 rounded-lg bg-[#1e2130] hover:bg-[#2a2d3a] text-gray-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <Trophy className="w-3.5 h-3.5" /> Grade from stats
                      </button>
                      <button
                        onClick={() => { if (confirm('Re-grade every question in this match from the current stats? This overwrites previous results.')) run(`regrade-${match.id}`, () => gradeMatchPickems(tournament.id, match.id, true)); }}
                        disabled={busy !== null}
                        title="Re-evaluate all questions from current stats (use after correcting a result)"
                        className="px-3 py-1.5 rounded-lg bg-[#1e2130] hover:bg-[#2a2d3a] text-gray-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Re-grade
                      </button>
                      {!resultsLive && (
                        <button
                          onClick={() => run(`results-${match.id}`, () => publishResults(tournament.id, match.id))}
                          disabled={busy !== null || ungraded > 0}
                          title={ungraded > 0 ? 'Grade all questions first' : 'Reveal results and award points to players'}
                          className="px-3 py-1.5 rounded-lg bg-[#ff4655] hover:bg-[#ff3344] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" /> Publish results
                        </button>
                      )}
                    </div>
                  )}

                  {/* Questions */}
                  {qs.map(q => (
                    <QuestionRow key={q.id} q={q} canEdit={canEditQuestions} busy={busy !== null} onAction={run} />
                  ))}

                  {seeded && canEditQuestions && <AddCustom tournamentId={tournament.id} matchId={match.id} stage={stage} busy={busy !== null} onAction={run} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuestionRow({ q, canEdit, busy, onAction }: {
  q: PickemQuestion;
  canEdit: boolean;
  busy: boolean;
  onAction: (key: string, fn: () => Promise<any>) => Promise<void>;
}) {
  const [overrideOpt, setOverrideOpt] = useState('');
  const [editing, setEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState(q.prompt);
  const statusColor =
    q.status === 'graded' ? 'text-green-400'
    : q.status === 'void' ? 'text-gray-500'
    : q.status === 'locked' ? 'text-yellow-400'
    : 'text-gray-400';

  const saveEdit = async () => {
    if (editPrompt.trim() && editPrompt.trim() !== q.prompt) {
      await onAction(`edit-${q.id}`, () => updateQuestion({ questionId: q.id, prompt: editPrompt.trim() }));
    }
    setEditing(false);
  };

  return (
    <div className="bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={editPrompt}
                onChange={e => setEditPrompt(e.target.value)}
                className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded text-gray-200 text-sm px-2 py-1"
              />
              <button onClick={saveEdit} disabled={busy} className="text-green-400 hover:text-green-300 disabled:opacity-50"><Check className="w-3.5 h-3.5" /></button>
              <button onClick={() => { setEditing(false); setEditPrompt(q.prompt); }} className="text-gray-500 hover:text-white text-xs">Cancel</button>
            </div>
          ) : (
            <p className="text-white text-sm">{q.prompt}</p>
          )}
          <p className="text-gray-500 text-[11px] mt-0.5">
            {q.kind} · +{q.points} · <span className={statusColor}>{q.status}</span>
            {q.correct_option_id && <> · answer: {q.options.find(o => o.id === q.correct_option_id)?.label ?? q.correct_option_id}</>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && q.status === 'open' && !editing && (
            <button onClick={() => setEditing(true)} disabled={busy} title="Edit prompt" className="text-gray-500 hover:text-white disabled:opacity-50">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {canEdit && q.status === 'open' && q.kind === 'custom' && (
            <button
              onClick={() => onAction(`del-${q.id}`, () => deleteQuestion(q.id))}
              disabled={busy}
              title="Delete question"
              className="text-gray-500 hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Manual answer override — available in EVERY state (incl. graded), so an
          organizer can always correct a mis-graded or subjective question. */}
      <div className="flex items-center gap-2 mt-2">
        <select
          value={overrideOpt}
          onChange={e => setOverrideOpt(e.target.value)}
          className="flex-1 bg-[#0d0f16] border border-[#2a2d3a] rounded text-gray-200 text-xs px-2 py-1.5"
        >
          <option value="">{q.status === 'graded' ? 'Change correct answer…' : 'Set correct answer…'}</option>
          {q.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          <option value="__void">Mark void (no points)</option>
        </select>
        <button
          onClick={() => overrideOpt && onAction(`ovr-${q.id}`, () => overridePickemAnswer(q.id, overrideOpt === '__void' ? '' : overrideOpt))}
          disabled={busy || !overrideOpt}
          className="px-2.5 py-1.5 rounded bg-[#1e2130] hover:bg-[#2a2d3a] text-gray-200 text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> Set
        </button>
      </div>
    </div>
  );
}

function AddCustom({ tournamentId, matchId, stage, busy, onAction }: {
  tournamentId: string; matchId: string; stage: string; busy: boolean;
  onAction: (key: string, fn: () => Promise<any>) => Promise<void>;
}) {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [opts, setOpts] = useState<string[]>(['', '']);

  const submit = async () => {
    const options = opts.map((label, i) => ({ id: `opt_${i}`, label: label.trim() })).filter(o => o.label);
    if (!prompt.trim() || options.length < 2) return;
    await onAction(`add-${matchId}`, () => createCustomQuestion({ tournamentId, matchId, stage, prompt: prompt.trim(), options }));
    setPrompt(''); setOpts(['', '']); setShow(false);
  };

  if (!show) {
    return (
      <button onClick={() => setShow(true)} className="text-[#ff4655] text-xs font-semibold flex items-center gap-1 hover:underline">
        <Plus className="w-3.5 h-3.5" /> Add custom question
      </button>
    );
  }
  return (
    <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3 space-y-2">
      <input
        value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Question prompt"
        className="w-full bg-[#151821] border border-[#2a2d3a] rounded text-gray-200 text-sm px-2.5 py-1.5"
      />
      {opts.map((o, i) => (
        <div key={i} className="flex gap-2">
          <input
            value={o}
            onChange={e => setOpts(prev => prev.map((x, j) => j === i ? e.target.value : x))}
            placeholder={`Option ${i + 1}`}
            className="flex-1 bg-[#151821] border border-[#2a2d3a] rounded text-gray-200 text-xs px-2.5 py-1.5"
          />
          {opts.length > 2 && (
            <button onClick={() => setOpts(prev => prev.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpts(prev => prev.length < 8 ? [...prev, ''] : prev)}
          className="text-gray-400 text-xs hover:text-white flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add option
        </button>
        <div className="flex gap-2">
          <button onClick={() => { setShow(false); setPrompt(''); setOpts(['', '']); }} className="px-3 py-1.5 rounded text-gray-400 text-xs hover:text-white">
            Cancel
          </button>
          <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded bg-[#ff4655] hover:bg-[#ff3344] text-white text-xs font-semibold disabled:opacity-50">
            Add question
          </button>
        </div>
      </div>
    </div>
  );
}
