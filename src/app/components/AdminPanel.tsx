import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildMentionIndex, makeMentionToken, type MentionEntity } from '../utils/mentions';
import {
  Shield, Plus, Trash2, Edit3, Save, X, ChevronDown, ChevronUp, ChevronRight,
  Tv, Calendar, Clock, Users, Trophy, AlertCircle,
  CheckCircle, Eye, EyeOff, Swords, BarChart2, Globe,
  Lock, LogOut, KeyRound, User, TrendingUp, Zap, Settings, Image as ImageIcon, Loader
} from 'lucide-react';
import { CreateTournamentScreen, type Tournament } from './TournamentCreation';
import { TournamentManager } from './TournamentManager';
import { supabase, signIn, signOut, getCurrentProfile, changePassword, type Profile, type UserRole } from '../services/supabase';
import {
  loadAdminDataAuthed, upsertTournament, deleteTournament, upsertNews, deleteNews, replaceStandings,
  setSiteConfig, migrateFromLocalStorage, uploadHeroVideo, uploadImage, clearDbCache,
  getTournamentRequests, approveTournamentRequest, denyTournamentRequest, resendInvite, type TournamentRequest,
} from '../services/db';

// EmailJS config for the "your tournament is ready" email sent to organizers on
// approval. Fill these when the EmailJS account is set up (same account as the
// contact form). Until then, approval still works — the email send is skipped.
const ORGANIZER_EMAILJS_SERVICE_ID = 'service_7kaukdv';
const ORGANIZER_EMAILJS_TEMPLATE_ID = 'template_a6piesm';
const ORGANIZER_EMAILJS_PUBLIC_KEY = 'p_AaPkV8j41bh5dtO';

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);

  const attempt = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError('');
    try {
      await signIn(email, password);
      onSuccess();
    } catch (e: any) {
      // Distinguish a genuine credential rejection (Supabase AuthApiError,
      // HTTP 400) from a network/timeout/cold-start failure. Reporting a
      // stalled connection as "wrong password" sends the user down the wrong
      // path (resetting a password that was actually correct).
      const status = e?.status ?? e?.statusCode;
      const isCredentialError = status === 400 || /invalid login|invalid credentials/i.test(e?.message ?? '');
      setError(isCredentialError
        ? 'Invalid email or password'
        : 'Connection problem — please check your network and try again.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') attempt();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0f16] flex items-center justify-center">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'linear-gradient(#ff4655 1px, transparent 1px), linear-gradient(90deg, #ff4655 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#ff4655]/5 rounded-full blur-3xl pointer-events-none" />

      <div
        className={`relative w-full max-w-sm mx-4 transition-all duration-150 ${shake ? 'translate-x-2' : ''}`}
        style={{ animation: shake ? 'shake 0.4s ease' : 'none' }}
      >
        {/* Card */}
        <div className="bg-[#151821] border border-[#2a2d3a] rounded-2xl overflow-hidden shadow-2xl">
          {/* Top stripe */}
          <div className="h-1 bg-gradient-to-r from-[#ff4655] via-[#ff6670] to-[#ff4655]" />

          <div className="p-8">
            {/* Logo */}
            <div className="flex flex-col items-center mb-8">
              <div className="w-14 h-14 bg-[#ff4655]/10 border border-[#ff4655]/20 rounded-2xl flex items-center justify-center mb-4">
                <Shield className="w-7 h-7 text-[#ff4655]" />
              </div>
              <h1 className="text-white font-bold text-xl tracking-tight">Clutchgg Admin Panel</h1>
              <p className="text-gray-500 text-sm mt-1">Sign in to manage content</p>
            </div>

            {/* Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1.5">Email</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <input
                    autoFocus
                    type="email"
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
                    placeholder="Enter email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError(''); }}
                    onKeyDown={onKey}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 font-medium mb-1.5">Password</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-xl pl-10 pr-10 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
                    placeholder="Enter password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    onKeyDown={onKey}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 bg-[#ff4655]/10 border border-[#ff4655]/20 rounded-xl px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-[#ff4655] flex-shrink-0" />
                  <span className="text-[#ff4655] text-xs font-medium">{error}</span>
                </div>
              )}

              <button
                onClick={attempt}
                disabled={!email || !password || loading}
                className="w-full bg-[#ff4655] hover:bg-[#ff3344] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm mt-2 flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" /> {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
      `}</style>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type MatchStatus = 'live' | 'upcoming' | 'completed';

export interface Match {
  id: string;
  team1: string;
  team2: string;
  score1: number;
  score2: number;
  map: string;
  viewers: string;
  status: MatchStatus;
  tournament: string;
  date: string;
  time: string;
  visible: boolean;
}

export interface StandingTeam {
  id: string;
  rank: number;
  name: string;
  wins: number;
  losses: number;
}

// A block of article body content. Articles are composed of an ordered list of
// these (HLTV-style): subheadings, paragraphs, and inline images.
export type NewsBlock =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'image'; url: string; caption?: string };

export interface NewsItem {
  id: string;
  title: string;
  category: string;
  timeAgo: string;
  imageUrl: string;   // cover image
  link: string;       // optional external link (legacy / "read more")
  visible: boolean;
  author?: string;
  body?: NewsBlock[];
  tournamentId?: string; // optional: tournament this article is about
}

export interface TopPlayer {
  id: string;
  rank: number;
  name: string;
  team: string;
  rating: number;
  kills: number;
  deaths: number;
}

interface AdminData {
  matches: Match[];
  standings: StandingTeam[];
  news: NewsItem[];
  players: TopPlayer[];
  tournaments: Tournament[];
  heroLink: string;
  heroVideo?: string;
  // Tournament id for the spotlight/featured tournament — displays on homepage standings,
  // tournaments page spotlight card, and can be featured in matches/stats pages.
  spotlightTournamentId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Generate a real UUID. Several tables (news_items, top_players) key on a
// Postgres `uuid` column, so IDs must be valid UUIDs or the upsert is rejected
// with "invalid input syntax for type uuid". Falls back to a manual v4 builder
// for older environments without crypto.randomUUID.
const uid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const defaultData: AdminData = {
  matches: [],
  standings: [],
  news: [],
  players: [],
  tournaments: [],
  heroLink: '',
  heroVideo: '',
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-xl text-sm font-medium transition-all duration-300 ${
      type === 'success'
        ? 'bg-[#0d1f16] border-[#1a4a2e] text-[#4ade80]'
        : 'bg-[#1f0d0d] border-[#4a1a1a] text-[#f87171]'
    }`}>
      {type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {message}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: MatchStatus }) {
  const map = {
    live: 'bg-[#ff4655]/20 text-[#ff4655] border-[#ff4655]/30',
    upcoming: 'bg-[#3b82f6]/20 text-[#60a5fa] border-[#3b82f6]/30',
    completed: 'bg-[#374151] text-[#9ca3af] border-[#4b5563]',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border ${map[status]}`}>
      {status === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-[#ff4655] animate-pulse" />}
      {status.toUpperCase()}
    </span>
  );
}

// ─── Match Form ───────────────────────────────────────────────────────────────

const emptyMatch = (): Match => ({
  id: uid(), team1: '', team2: '', score1: 0, score2: 0,
  map: '', viewers: '', status: 'upcoming',
  tournament: 'Valorant Tournament', date: '', time: '', visible: true,
});

function MatchForm({ match, onSave, onCancel, teamNames }: {
  match: Match;
  onSave: (m: Match) => void;
  onCancel: () => void;
  teamNames: string[];
}) {
  const [form, setForm] = useState<Match>(match);
  const set = (key: keyof Match, val: any) => setForm(f => ({ ...f, [key]: val }));

  const teamSelectClass = "w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors appearance-none cursor-pointer";

  return (
    <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-bold text-base flex items-center gap-2">
          <Swords className="w-4 h-4 text-[#ff4655]" />
          {match.team1 ? 'Edit Match' : 'New Match'}
        </h3>
        <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Teams Row */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">Team 1</label>
          {teamNames.length > 0 ? (
            <select
              className={teamSelectClass}
              value={form.team1}
              onChange={e => set('team1', e.target.value)}
            >
              <option value="">— Select Team —</option>
              {teamNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <input
              className={teamSelectClass}
              value={form.team1} onChange={e => set('team1', e.target.value)} placeholder="e.g. Paper Rex"
            />
          )}
        </div>
        <div className="pb-2.5 text-gray-600 font-bold text-sm">VS</div>
        <div>
          <label className="block text-xs text-gray-400 mb-1.5 font-medium">Team 2</label>
          {teamNames.length > 0 ? (
            <select
              className={teamSelectClass}
              value={form.team2}
              onChange={e => set('team2', e.target.value)}
            >
              <option value="">— Select Team —</option>
              {teamNames.filter(n => n !== form.team1).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <input
              className={teamSelectClass}
              value={form.team2} onChange={e => set('team2', e.target.value)} placeholder="e.g. Fnatic"
            />
          )}
        </div>
      </div>

      {/* Status */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5 font-medium">Match Status</label>
        <div className="flex gap-2">
          {(['upcoming', 'live', 'completed'] as MatchStatus[]).map(s => (
            <button
              key={s}
              onClick={() => set('status', s)}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                form.status === s
                  ? s === 'live' ? 'bg-[#ff4655]/20 border-[#ff4655] text-[#ff4655]'
                    : s === 'upcoming' ? 'bg-[#3b82f6]/20 border-[#3b82f6] text-[#60a5fa]'
                    : 'bg-[#374151] border-[#6b7280] text-[#9ca3af]'
                  : 'bg-transparent border-[#2a2d3a] text-gray-500 hover:border-gray-500'
              }`}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Scores (only for live/completed) */}
      {(form.status === 'live' || form.status === 'completed') && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Score — {form.team1 || 'Team 1'}</label>
            <input type="number" min={0}
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={form.score1} onChange={e => set('score1', Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Score — {form.team2 || 'Team 2'}</label>
            <input type="number" min={0}
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={form.score2} onChange={e => set('score2', Number(e.target.value))}
            />
          </div>
        </div>
      )}

      {/* Live-specific */}
      {form.status === 'live' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Map / Round Info</label>
            <input
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={form.map} onChange={e => set('map', e.target.value)} placeholder="e.g. Bind - Round 19/24"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Viewer Count</label>
            <input
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={form.viewers} onChange={e => set('viewers', e.target.value)} placeholder="e.g. 125K"
            />
          </div>
        </div>
      )}

      {/* Upcoming-specific */}
      {form.status === 'upcoming' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Date</label>
            <input
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={form.date} onChange={e => set('date', e.target.value)} placeholder="e.g. May 25"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Time</label>
            <input
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={form.time} onChange={e => set('time', e.target.value)} placeholder="e.g. 14:00 PST"
            />
          </div>
        </div>
      )}

      {/* Tournament */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5 font-medium">Tournament / Stage</label>
        <input
          className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2.5 text-white text-sm focus:border-[#ff4655] focus:outline-none"
          value={form.tournament} onChange={e => set('tournament', e.target.value)} placeholder="e.g. Valorant Tournament - Playoffs"
        />
      </div>

      {/* Visibility */}
      <div className="flex items-center justify-between bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-4 py-3">
        <div>
          <p className="text-white text-sm font-medium">Visible on website</p>
          <p className="text-gray-500 text-xs">Show this match to visitors</p>
        </div>
        <button
          onClick={() => set('visible', !form.visible)}
          className={`w-11 h-6 rounded-full transition-all duration-200 relative ${form.visible ? 'bg-[#ff4655]' : 'bg-[#2a2d3a]'}`}
        >
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${form.visible ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all">
          Cancel
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.team1 || !form.team2}
          className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Save className="w-4 h-4" /> Save Match
        </button>
      </div>
    </div>
  );
}

// ─── Standings Editor ─────────────────────────────────────────────────────────

function StandingsEditor({ teams, onChange }: { teams: StandingTeam[]; onChange: (t: StandingTeam[]) => void }) {
  const update = (id: string, key: keyof StandingTeam, val: any) => {
    onChange(teams.map(t => t.id === id ? { ...t, [key]: val } : t));
  };
  const addTeam = () => {
    const newTeam: StandingTeam = { id: uid(), rank: teams.length + 1, name: '', wins: 0, losses: 0 };
    onChange([...teams, newTeam]);
  };
  const remove = (id: string) => onChange(teams.filter(t => t.id !== id));
  const recalcWinRate = (t: StandingTeam) => {
    const total = t.wins + t.losses;
    return total === 0 ? '0%' : `${Math.round((t.wins / total) * 100)}%`;
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-[#2a2d3a]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#151821] text-gray-400 text-xs uppercase">
              <th className="px-4 py-3 text-left">Rank</th>
              <th className="px-4 py-3 text-left">Team Name</th>
              <th className="px-4 py-3 text-center w-24">Wins</th>
              <th className="px-4 py-3 text-center w-24">Losses</th>
              <th className="px-4 py-3 text-center w-20">Win%</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {teams.map((team, i) => (
              <tr key={team.id} className="border-t border-[#2a2d3a] hover:bg-[#151821] transition-colors">
                <td className="px-4 py-2">
                  <input type="number" min={1}
                    className="w-12 bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                    value={team.rank} onChange={e => update(team.id, 'rank', Number(e.target.value))}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                    value={team.name} onChange={e => update(team.id, 'name', e.target.value)}
                    placeholder="Team name"
                  />
                </td>
                <td className="px-4 py-2">
                  <input type="number" min={0}
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-green-400 text-sm text-center focus:border-[#ff4655] focus:outline-none"
                    value={team.wins} onChange={e => update(team.id, 'wins', Number(e.target.value))}
                  />
                </td>
                <td className="px-4 py-2">
                  <input type="number" min={0}
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-red-400 text-sm text-center focus:border-[#ff4655] focus:outline-none"
                    value={team.losses} onChange={e => update(team.id, 'losses', Number(e.target.value))}
                  />
                </td>
                <td className="px-4 py-2 text-center text-gray-400 text-xs">{recalcWinRate(team)}</td>
                <td className="px-4 py-2">
                  <button onClick={() => remove(team.id)} className="text-gray-600 hover:text-[#ff4655] transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addTeam} className="flex items-center gap-2 text-sm text-[#ff4655] hover:text-[#ff6670] transition-colors px-1">
        <Plus className="w-4 h-4" /> Add team
      </button>
    </div>
  );
}

// ─── News / Article Editor ─────────────────────────────────────────────────────

// A paragraph textarea with @-mention autocomplete. Typing "@" opens a picker of
// teams/players from the DB; selecting one inserts a mention token that becomes a
// link when the article is rendered.
function ParagraphEditor({ value, onChange, mentionIndex }: {
  value: string;
  onChange: (v: string) => void;
  mentionIndex: MentionEntity[];
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ at: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Detect an active "@query" immediately before the caret.
  const detect = (text: string, caret: number) => {
    const upto = text.slice(0, caret);
    const at = upto.lastIndexOf('@');
    if (at === -1) { setMenu(null); return; }
    const between = upto.slice(at + 1);
    // The query runs until the @ — abort if it contains whitespace/newline or a token bracket.
    if (/[\s\n\]\)]/.test(between)) { setMenu(null); return; }
    setMenu({ at, query: between });
    setActiveIdx(0);
  };

  const matches = menu
    ? mentionIndex
        .filter(e => e.name.toLowerCase().includes(menu.query.toLowerCase()))
        .slice(0, 8)
    : [];

  const choose = (e: MentionEntity) => {
    if (!menu) return;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    const before = value.slice(0, menu.at);
    const after = value.slice(caret);
    const token = makeMentionToken(e);
    const next = `${before}${token} ${after}`;
    onChange(next);
    setMenu(null);
    // Restore focus + caret after the inserted token.
    requestAnimationFrame(() => {
      if (ta) {
        const pos = (before + token + ' ').length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      }
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menu || matches.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[activeIdx]); }
    else if (e.key === 'Escape') { setMenu(null); }
  };

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        rows={3}
        className="w-full bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none resize-y"
        value={value}
        onChange={e => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKeyDown}
        onClick={e => detect(value, (e.target as HTMLTextAreaElement).selectionStart)}
        onBlur={() => setTimeout(() => setMenu(null), 150)}
        placeholder="Paragraph text…  (type @ to mention a team or player)"
      />
      {menu && matches.length > 0 && (
        <div className="absolute z-20 left-3 right-3 mt-1 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg shadow-xl overflow-hidden max-h-56 overflow-y-auto">
          {matches.map((e, i) => (
            <button
              key={`${e.kind}-${e.id}`}
              onMouseDown={ev => { ev.preventDefault(); choose(e); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${i === activeIdx ? 'bg-[#ff4655]/15 text-white' : 'text-gray-300 hover:bg-[#151821]'}`}
            >
              <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${e.kind === 'team' ? 'text-blue-400 bg-blue-400/10' : 'text-green-400 bg-green-400/10'}`}>
                {e.kind}
              </span>
              <span className="font-medium">{e.name}</span>
              {e.kind === 'player' && e.teamName && <span className="text-gray-500 text-xs">· {e.teamName}</span>}
            </button>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-600 mt-1">Type <span className="text-gray-400">@</span> to link a team or player.</p>
    </div>
  );
}

// Editor for a single article's body blocks (headings, paragraphs, images).
function ArticleBodyEditor({ blocks, onChange, mentionIndex }: { blocks: NewsBlock[]; onChange: (b: NewsBlock[]) => void; mentionIndex: MentionEntity[] }) {
  const updateBlock = (id: string, patch: Partial<NewsBlock>) =>
    onChange(blocks.map(b => (b.id === id ? { ...b, ...patch } as NewsBlock : b)));
  const removeBlock = (id: string) => onChange(blocks.filter(b => b.id !== id));
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[j]] = [next[j], next[index]];
    onChange(next);
  };
  const addHeading = () => onChange([...blocks, { id: uid(), type: 'heading', text: '' }]);
  const addParagraph = () => onChange([...blocks, { id: uid(), type: 'paragraph', text: '' }]);
  const addImage = () => onChange([...blocks, { id: uid(), type: 'image', url: '', caption: '' }]);

  const handleBlockImage = async (id: string, file: File) => {
    updateBlock(id, { url: URL.createObjectURL(file) } as Partial<NewsBlock>);
    try {
      const url = await uploadImage(file, 'news-images');
      updateBlock(id, { url } as Partial<NewsBlock>);
    } catch (err) {
      console.error('Image upload failed', err);
      alert('Image upload failed. Please try again.');
      updateBlock(id, { url: '' } as Partial<NewsBlock>);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs text-gray-400 font-medium">Article Body</label>
      {blocks.length === 0 && (
        <p className="text-xs text-gray-600">No content yet. Add a heading, paragraph, or image below.</p>
      )}
      {blocks.map((block, i) => (
        <div key={block.id} className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
              {block.type}
            </span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-600 hover:text-white disabled:opacity-30 transition-colors p-0.5">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="text-gray-600 hover:text-white disabled:opacity-30 transition-colors p-0.5">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => removeBlock(block.id)} className="text-gray-600 hover:text-[#ff4655] transition-colors p-0.5">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {block.type === 'heading' && (
            <input
              className="w-full bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm font-bold focus:border-[#ff4655] focus:outline-none"
              value={block.text}
              onChange={e => updateBlock(block.id, { text: e.target.value })}
              placeholder="Section heading (bold)"
            />
          )}

          {block.type === 'paragraph' && (
            <ParagraphEditor
              value={block.text}
              onChange={text => updateBlock(block.id, { text })}
              mentionIndex={mentionIndex}
            />
          )}

          {block.type === 'image' && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {block.url && (
                  <img src={block.url} alt="" className="w-24 h-16 object-cover rounded border border-[#2a2d3a]" />
                )}
                <label className="flex-1 flex items-center justify-center gap-2 bg-[#151821] border border-dashed border-[#2a2d3a] rounded-lg py-4 cursor-pointer hover:border-[#ff4655]/50 transition-colors">
                  <ImageIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-500">{block.url ? 'Replace image' : 'Upload image'}</span>
                  <input
                    type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleBlockImage(block.id, f); }}
                  />
                </label>
              </div>
              <input
                className="w-full bg-[#151821] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                value={block.caption ?? ''}
                onChange={e => updateBlock(block.id, { caption: e.target.value } as Partial<NewsBlock>)}
                placeholder="Image caption (optional)"
              />
            </div>
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <button onClick={addHeading} className="flex items-center gap-1.5 text-xs bg-[#0d0f16] border border-[#2a2d3a] text-gray-300 hover:border-[#ff4655]/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> Heading
        </button>
        <button onClick={addParagraph} className="flex items-center gap-1.5 text-xs bg-[#0d0f16] border border-[#2a2d3a] text-gray-300 hover:border-[#ff4655]/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> Paragraph
        </button>
        <button onClick={addImage} className="flex items-center gap-1.5 text-xs bg-[#0d0f16] border border-[#2a2d3a] text-gray-300 hover:border-[#ff4655]/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors">
          <Plus className="w-3.5 h-3.5" /> Image
        </button>
      </div>
    </div>
  );
}

function NewsEditor({ items, onChange, onSaveArticle, onToggleVisible, onDeleteArticle, savingId, tournaments, lockedTournamentId }: {
  items: NewsItem[];
  onChange: (n: NewsItem[]) => void;
  onSaveArticle: (item: NewsItem) => void;
  onToggleVisible: (item: NewsItem) => void;
  onDeleteArticle: (id: string) => void;
  savingId: string | null;
  tournaments: Tournament[];
  // When set (organizer mode), every new article is tagged to this tournament and
  // the per-article tournament dropdown is locked to it.
  lockedTournamentId?: string;
}) {
  const mentionIndex = useMemo(() => buildMentionIndex(tournaments), [tournaments]);
  // Which article is currently expanded for editing (only one at a time).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<NewsItem>) => {
    onChange(items.map(n => n.id === id ? { ...n, ...patch } : n));
  };
  // Flip visibility and persist immediately.
  const toggleVisible = (item: NewsItem) => onToggleVisible({ ...item, visible: !item.visible });
  const addItem = () => {
    const id = uid();
    onChange([...items, { id, title: '', category: 'NEWS', timeAgo: 'Just now', imageUrl: '', link: '', visible: true, author: '', body: [], tournamentId: lockedTournamentId }]);
    setExpandedId(id); // open the new article for editing
  };

  const handleCover = async (id: string, file: File) => {
    // Show an instant local preview, then replace with the uploaded Storage URL.
    update(id, { imageUrl: URL.createObjectURL(file) });
    try {
      const url = await uploadImage(file, 'news-images');
      update(id, { imageUrl: url });
    } catch (err) {
      console.error('Cover upload failed', err);
      alert('Image upload failed. Please try again.');
      update(id, { imageUrl: '' });
    }
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="text-center py-10 bg-[#151821] border border-[#2a2d3a] rounded-xl text-gray-600 text-sm">
          No articles yet. Add one below.
        </div>
      )}
      {items.map(item => {
        const isOpen = expandedId === item.id;

        // Collapsed row — title + meta + edit/delete.
        if (!isOpen) {
          return (
            <div key={item.id} className="bg-[#151821] border border-[#2a2d3a] rounded-xl px-4 py-3 flex items-center gap-3">
              {item.imageUrl ? (
                <img src={item.imageUrl} alt="" className="w-16 h-10 object-cover rounded flex-shrink-0 border border-[#2a2d3a]" />
              ) : (
                <div className="w-16 h-10 rounded flex-shrink-0 bg-[#0d0f16] flex items-center justify-center">
                  <ImageIcon className="w-4 h-4 text-gray-600" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-semibold truncate">{item.title || 'Untitled article'}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {item.category && <span className="text-[10px] text-gray-500 uppercase tracking-wider">{item.category}</span>}
                  {!item.visible && <span className="text-[10px] text-gray-600">· Hidden</span>}
                </div>
              </div>
              <button
                onClick={() => toggleVisible(item)}
                className={`flex items-center gap-1 text-xs transition-colors ${item.visible ? 'text-[#ff4655]' : 'text-gray-600 hover:text-gray-400'}`}
                title={item.visible ? 'Visible — click to hide' : 'Hidden — click to show'}
              >
                {item.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => setExpandedId(item.id)}
                className="flex items-center gap-1.5 text-xs bg-[#0d0f16] border border-[#2a2d3a] text-gray-300 hover:border-[#ff4655]/50 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </button>
              <button onClick={() => onDeleteArticle(item.id)} className="text-gray-600 hover:text-[#ff4655] transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        }

        // Expanded editor.
        return (
        <div key={item.id} className="bg-[#151821] border border-[#ff4655]/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <button onClick={() => setExpandedId(null)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors">
              <ChevronUp className="w-3.5 h-3.5" /> Collapse
            </button>
            <div className="flex items-center gap-3">
              <button onClick={() => toggleVisible(item)} className={`flex items-center gap-1 text-xs transition-colors ${item.visible ? 'text-[#ff4655]' : 'text-gray-600 hover:text-gray-400'}`}>
                {item.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {item.visible ? 'Visible' : 'Hidden'}
              </button>
              <button onClick={() => onDeleteArticle(item.id)} className="text-gray-600 hover:text-[#ff4655] transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Title</label>
            <input
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={item.title} onChange={e => update(item.id, { title: e.target.value })} placeholder="Article title…"
            />
          </div>

          {/* Category + Author */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Category</label>
              <input
                className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                value={item.category} onChange={e => update(item.id, { category: e.target.value })} placeholder="e.g. ROSTER MOVE"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">Author <span className="text-gray-600">(optional)</span></label>
              <input
                className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                value={item.author ?? ''} onChange={e => update(item.id, { author: e.target.value })} placeholder="e.g. king_dempz"
              />
            </div>
          </div>

          {/* Tournament link */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">
              Tournament {lockedTournamentId ? '' : <span className="text-gray-600">(optional)</span>}
            </label>
            <select
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none disabled:opacity-70 disabled:cursor-not-allowed"
              value={lockedTournamentId ?? item.tournamentId ?? ''}
              disabled={!!lockedTournamentId}
              onChange={e => update(item.id, { tournamentId: e.target.value || undefined })}
            >
              {!lockedTournamentId && <option value="">No tournament</option>}
              {tournaments.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {lockedTournamentId && (
              <p className="text-xs text-gray-600 mt-1">Articles are automatically linked to your tournament.</p>
            )}
          </div>

          {/* Cover image */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Cover Image</label>
            <div className="flex items-center gap-3">
              {item.imageUrl && (
                <img src={item.imageUrl} alt="" className="w-28 h-16 object-cover rounded border border-[#2a2d3a]" />
              )}
              <label className="flex-1 flex items-center justify-center gap-2 bg-[#0d0f16] border border-dashed border-[#2a2d3a] rounded-lg py-4 cursor-pointer hover:border-[#ff4655]/50 transition-colors">
                <ImageIcon className="w-4 h-4 text-gray-500" />
                <span className="text-xs text-gray-500">{item.imageUrl ? 'Replace cover' : 'Upload cover'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCover(item.id, f); }} />
              </label>
            </div>
            <input
              className="w-full mt-2 bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={item.imageUrl} onChange={e => update(item.id, { imageUrl: e.target.value })} placeholder="…or paste image URL (https://)"
            />
          </div>

          {/* Body blocks */}
          <ArticleBodyEditor blocks={item.body ?? []} onChange={body => update(item.id, { body })} mentionIndex={mentionIndex} />

          {/* Optional external link */}
          <div>
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">External Link <span className="text-gray-600">(optional)</span></label>
            <input
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={item.link} onChange={e => update(item.id, { link: e.target.value })} placeholder="https://… (opens externally instead of the article page)"
            />
          </div>

          {/* Per-article save */}
          <div className="pt-2 border-t border-[#2a2d3a] flex justify-end gap-2">
            <button
              onClick={() => setExpandedId(null)}
              className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-xl border border-[#2a2d3a] hover:border-gray-500 transition-all"
            >
              Done
            </button>
            <button
              onClick={() => onSaveArticle(item)}
              disabled={savingId === item.id || !item.title.trim()}
              className="flex items-center gap-2 bg-[#ff4655] hover:bg-[#ff3344] text-white text-sm font-semibold px-5 py-2 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingId === item.id ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingId === item.id ? 'Saving…' : 'Save Article'}
            </button>
          </div>
        </div>
        );
      })}
      <button onClick={addItem} className="flex items-center gap-2 text-sm text-[#ff4655] hover:text-[#ff6670] transition-colors px-1">
        <Plus className="w-4 h-4" /> Add article
      </button>
    </div>
  );
}


// ─── Sidebar Tab ──────────────────────────────────────────────────────────────

// ─── Tournament Requests (superadmin) ──────────────────────────────────────────
// Lists organizer registration requests from the public contact form and lets a
// superadmin approve (creates account + tournament via Edge Function, then emails
// the organizer) or deny them.

function RequestsPanel({ onApproved, showToast }: {
  onApproved: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const [requests, setRequests] = useState<TournamentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000)
      );
      setRequests(await Promise.race([getTournamentRequests(), timeout]));
    } catch (e) {
      const msg = e instanceof Error && e.message === 'timeout'
        ? 'Request timed out — check your connection'
        : 'Failed to load requests';
      showToast(msg, 'error');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sendApprovalEmail = async (to: { email: string; organizerName: string; tournamentName: string }) => {
    if (ORGANIZER_EMAILJS_SERVICE_ID === 'YOUR_SERVICE_ID') return; // not configured yet
    try {
      const emailjs = await import('@emailjs/browser');
      await emailjs.send(
        ORGANIZER_EMAILJS_SERVICE_ID,
        ORGANIZER_EMAILJS_TEMPLATE_ID,
        {
          to_email: to.email,
          organizer_name: to.organizerName,
          tournament_name: to.tournamentName,
          admin_email: to.email,
          admin_panel_link: 'https://clutchgg-five.vercel.app/admin',
        },
        ORGANIZER_EMAILJS_PUBLIC_KEY,
      );
    } catch (e) {
      console.warn('[Requests] approval email failed:', e);
      showToast('Approved, but the email failed to send', 'error');
    }
  };

  const approve = async (req: TournamentRequest) => {
    setBusyId(req.id);
    try {
      const result = await approveTournamentRequest(req.id);
      await sendApprovalEmail({
        email: result.email,
        organizerName: result.organizerName,
        tournamentName: result.tournamentName,
      });
      showToast(`Approved — "${result.tournamentName}" created`, 'success');
      onApproved();
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Approval failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const deny = async (req: TournamentRequest) => {
    setBusyId(req.id);
    try {
      await denyTournamentRequest(req.id);
      showToast('Request denied', 'success');
      await load();
    } catch {
      showToast('Failed to deny request', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (req: TournamentRequest) => {
    setBusyId(req.id);
    try {
      const { mode } = await resendInvite(req.email);
      showToast(
        mode === 'recovery'
          ? `Password-reset link sent to ${req.email}`
          : `Invite re-sent to ${req.email}`,
        'success',
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to resend invite', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const pending = requests.filter(r => r.status === 'pending');
  const handled = requests.filter(r => r.status !== 'pending');

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-bold text-lg">Tournament Requests</h2>
          <p className="text-gray-500 text-sm">Approve to create the organizer's account and tournament, or deny.</p>
        </div>
        <button onClick={load} className="text-xs text-gray-400 hover:text-white bg-[#1e2130] border border-[#2a2d3a] px-3 py-1.5 rounded-lg transition-all">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-gray-600 text-sm bg-[#151821] border border-[#2a2d3a] rounded-xl">
          No requests yet.
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <p className="text-gray-600 text-xs font-semibold uppercase">Pending ({pending.length})</p>
              {pending.map(req => (
                <div key={req.id} className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-white font-bold text-base">{req.tournamentName}</h3>
                      <p className="text-gray-400 text-sm mt-0.5">
                        {req.organizerName} · <a href={`mailto:${req.email}`} className="text-[#ff4655] hover:underline">{req.email}</a>
                        {req.phone ? ` · ${req.phone}` : ''}
                      </p>
                      {req.tournamentDetails && (
                        <p className="text-gray-500 text-sm mt-2 whitespace-pre-wrap">{req.tournamentDetails}</p>
                      )}
                      <p className="text-gray-600 text-xs mt-2">{new Date(req.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button
                        onClick={() => approve(req)}
                        disabled={busyId === req.id}
                        className="flex items-center gap-2 bg-[#ff4655] hover:bg-[#ff3344] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all"
                      >
                        {busyId === req.id ? <Loader className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Approve
                      </button>
                      <button
                        onClick={() => deny(req)}
                        disabled={busyId === req.id}
                        className="flex items-center gap-2 text-gray-400 hover:text-[#ff4655] disabled:opacity-50 bg-[#1e2130] border border-[#2a2d3a] text-sm font-medium px-4 py-2 rounded-lg transition-all"
                      >
                        <X className="w-4 h-4" /> Deny
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {handled.length > 0 && (
            <div className="space-y-3">
              <p className="text-gray-600 text-xs font-semibold uppercase">History</p>
              {handled.map(req => (
                <div key={req.id} className="bg-[#101218] border border-[#1e2130] rounded-xl px-5 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-gray-300 text-sm font-medium truncate">{req.tournamentName}</p>
                    <p className="text-gray-600 text-xs">{req.organizerName} · {req.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {req.status === 'approved' && (
                      <button
                        onClick={() => resend(req)}
                        disabled={busyId === req.id}
                        title="Resend the invite / password link to this organizer"
                        className="flex items-center gap-1.5 text-gray-400 hover:text-[#ff4655] disabled:opacity-50 bg-[#1e2130] border border-[#2a2d3a] text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
                      >
                        {busyId === req.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                        Resend
                      </button>
                    )}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      req.status === 'approved' ? 'bg-[#0d1f16] text-[#4ade80] border border-[#1a4a2e]' : 'bg-[#1f0d0d] text-[#f87171] border border-[#4a1a1a]'
                    }`}>
                      {req.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Forced password change ─────────────────────────────────────────────────────
// Shown after login when profile.must_change_password is set (default-password
// path). Organizers must set a personal password before reaching the panel.

function ChangePasswordScreen({ onDone, firstTime = false }: { onDone: () => void; firstTime?: boolean }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError('');
    if (pw.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (pw !== confirm) { setError('Passwords do not match'); return; }
    setSaving(true);
    try {
      await changePassword(pw);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0f16] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#151821] border border-[#2a2d3a] rounded-2xl overflow-hidden shadow-2xl">
        <div className="h-1 bg-gradient-to-r from-[#ff4655] via-[#ff6670] to-[#ff4655]" />
        <div className="p-8">
          <div className="flex flex-col items-center mb-6">
            <div className="w-14 h-14 bg-[#ff4655]/10 border border-[#ff4655]/20 rounded-2xl flex items-center justify-center mb-4">
              <KeyRound className="w-7 h-7 text-[#ff4655]" />
            </div>
            <h1 className="text-white font-bold text-xl tracking-tight">
              {firstTime ? 'Welcome — Set Your Password' : 'Set a New Password'}
            </h1>
            <p className="text-gray-500 text-sm mt-1 text-center">
              {firstTime
                ? 'Your tournament account is ready. Create a password to access your admin panel.'
                : 'For your security, choose a personal password before continuing.'}
            </p>
          </div>
          <div className="space-y-4">
            <input
              type="password" placeholder="New password" value={pw}
              onChange={e => { setPw(e.target.value); setError(''); }}
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-xl px-4 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
            />
            <input
              type="password" placeholder="Confirm password" value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-xl px-4 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
            />
            {error && (
              <div className="flex items-center gap-2 bg-[#ff4655]/10 border border-[#ff4655]/20 rounded-xl px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-[#ff4655] flex-shrink-0" />
                <span className="text-[#ff4655] text-xs font-medium">{error}</span>
              </div>
            )}
            <button
              onClick={submit} disabled={saving || !pw || !confirm}
              className="w-full bg-[#ff4655] hover:bg-[#ff3344] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm flex items-center justify-center gap-2"
            >
              {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SideTab({ icon: Icon, label, active, count, onClick }: {
  icon: any; label: string; active: boolean; count?: number; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-left ${
        active
          ? 'bg-[#ff4655]/10 text-[#ff4655] border border-[#ff4655]/20'
          : 'text-gray-400 hover:text-white hover:bg-[#1e2130] border border-transparent'
      }`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {count !== undefined && (
        <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${active ? 'bg-[#ff4655]/20 text-[#ff4655]' : 'bg-[#2a2d3a] text-gray-500'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ─── Main Admin Panel ─────────────────────────────────────────────────────────

type Tab = 'news' | 'tournaments' | 'settings' | 'requests';

export function AdminPanel({ onClose, onDataChange }: {
  onClose: () => void;
  onDataChange?: (data: AdminData) => void;
}) {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needsPasswordChange, setNeedsPasswordChange] = useState(false);

  // Load the signed-in user's profile (role + tournament scope). Re-runs on auth change.
  const refreshProfile = async (hasSession: boolean) => {
    if (!hasSession) { setProfile(null); setNeedsPasswordChange(false); return; }
    const p = await getCurrentProfile();
    setProfile(p);
    setNeedsPasswordChange(!!p?.must_change_password);
  };

  // True when the user arrived via a Supabase invite or password-recovery link.
  // In that flow they have a valid session but have NOT set a password yet, so
  // we must force the set-password screen instead of dropping them into the panel.
  const [mustSetPassword, setMustSetPassword] = useState(false);

  useEffect(() => {
    // The invite/recovery link lands here with a token in the URL hash, e.g.
    // #access_token=…&type=invite (or type=recovery). The Supabase client parses
    // it and emits SIGNED_IN; we read the hash to know it's a first-time setup.
    const hash = window.location.hash || '';
    const isInviteFlow = hash.includes('type=invite') || hash.includes('type=recovery');
    if (isInviteFlow) setMustSetPassword(true);

    supabase.auth.getSession().then(async ({ data }) => {
      setAuthed(!!data.session);
      await refreshProfile(!!data.session);
      setChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // PASSWORD_RECOVERY fires for recovery links; invite links arrive as
      // SIGNED_IN but with the type=invite hash captured above.
      if (event === 'PASSWORD_RECOVERY') setMustSetPassword(true);
      setAuthed(!!session);
      await refreshProfile(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0d0f16] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#ff4655] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) {
    return <AdminLogin onSuccess={async () => { setAuthed(true); await refreshProfile(true); }} />;
  }

  if (needsPasswordChange || mustSetPassword) {
    return (
      <ChangePasswordScreen
        firstTime={mustSetPassword}
        onDone={() => {
          setNeedsPasswordChange(false);
          setMustSetPassword(false);
          // Strip the invite token from the URL so a refresh doesn't re-trigger.
          if (window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname);
          }
        }}
      />
    );
  }

  return <AdminPanelInner profile={profile} onClose={onClose} onDataChange={onDataChange} onLogout={async () => {
    await signOut();
    setAuthed(false);
    setProfile(null);
    navigate('/');
  }} />;
}

function AdminPanelInner({ profile, onClose, onDataChange, onLogout }: {
  profile: Profile | null;
  onClose: () => void;
  onDataChange?: (data: AdminData) => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const role: UserRole = profile?.role ?? 'admin';
  const isOrganizer = role === 'organizer';
  const isSuperadmin = role === 'superadmin';
  // Organizers are scoped to exactly one tournament.
  const scopedTournamentId = isOrganizer ? (profile?.tournament_id ?? null) : null;
  const [tab, setTab] = useState<Tab>('tournaments');
  const [data, setData] = useState<AdminData>(defaultData);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [savingNewsId, setSavingNewsId] = useState<string | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const videoFileRef = useRef<HTMLInputElement>(null);
  // IDs of news items currently persisted in the DB. Used on save to delete any
  // items the admin removed from the editor (the upsert pass alone can't remove).
  const persistedNewsIds = useRef<Set<string>>(new Set());

  // Load from Supabase on mount. Clear the read cache first so the admin always
  // edits the freshest data (not a copy cached during an earlier public-page visit).
  useEffect(() => {
    clearDbCache();
    loadAdminDataAuthed()
      .then(d => {
        setData(d);
        persistedNewsIds.current = new Set(d.news.map(n => n.id));
      })
      .catch(() => {})
      .finally(() => setDbLoading(false));
  }, []);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  const save = (newData: AdminData) => {
    setData(newData);
    onDataChange?.(newData);
    showToast('Changes saved!', 'success');
  };

  // Organizers only ever see/edit their one assigned tournament. Staff see all.
  const visibleTournaments = useMemo(
    () => isOrganizer
      ? data.tournaments.filter(t => t.id === scopedTournamentId)
      : data.tournaments,
    [data.tournaments, isOrganizer, scopedTournamentId],
  );

  // Organizers only see/manage news scoped to their tournament; the article
  // editor's tournament dropdown is locked to that single tournament.
  const visibleNews = useMemo(
    () => isOrganizer
      ? data.news.filter(n => n.tournamentId === scopedTournamentId)
      : data.news,
    [data.news, isOrganizer, scopedTournamentId],
  );

  // Keep organizers off tabs they can't access (e.g. if default 'tournaments'
  // ever changes, or a stale 'settings'/'requests' selection lingers).
  useEffect(() => {
    if (isOrganizer && (tab === 'settings' || tab === 'requests')) setTab('tournaments');
    if (!isSuperadmin && tab === 'requests') setTab('tournaments');
  }, [isOrganizer, isSuperadmin, tab]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0d0f16] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2130] bg-[#0d0f16]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#ff4655]/10 rounded-lg flex items-center justify-center">
            <Shield className="w-4 h-4 text-[#ff4655]" />
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-none">Clutchgg Admin Panel</h1>
            <p className="text-gray-500 text-xs mt-0.5">Match &amp; content management</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#1e2130] border border-[#2a2d3a] rounded-lg px-3 py-1.5">
            <User className="w-3.5 h-3.5 text-gray-500" />
            <span className="text-xs text-gray-400 font-medium">
              {profile?.display_name ? `${profile.display_name} · ` : ''}{role}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-[#1e2130] border border-[#2a2d3a] rounded-lg px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-gray-400">Live preview synced</span>
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-[#1e2130] border border-[#2a2d3a] hover:border-gray-500 px-3 py-1.5 rounded-lg transition-all"
          >
            <Globe className="w-3.5 h-3.5" /> Back to site
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-[#ff4655] bg-[#1e2130] border border-[#2a2d3a] hover:border-[#ff4655]/30 px-3 py-1.5 rounded-lg transition-all"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 bg-[#0d0f16] border-r border-[#1e2130] flex flex-col p-4 gap-1 flex-shrink-0">
          <p className="text-gray-600 text-xs font-semibold uppercase px-4 py-2">Content</p>
          <SideTab icon={Trophy} label={isOrganizer ? 'My Tournament' : 'Tournaments'} active={tab === 'tournaments'} count={visibleTournaments.length} onClick={() => setTab('tournaments')} />
          <SideTab icon={Trophy} label="News" active={tab === 'news'} count={visibleNews.length} onClick={() => setTab('news')} />

          {/* Superadmin-only: review tournament registration requests */}
          {isSuperadmin && (
            <>
              <div className="my-3 border-t border-[#1e2130]" />
              <p className="text-gray-600 text-xs font-semibold uppercase px-4 py-2">Administration</p>
              <SideTab icon={Users} label="Requests" active={tab === 'requests'} onClick={() => setTab('requests')} />
            </>
          )}

          {/* Site-wide settings are staff-only; organizers never see this. */}
          {!isOrganizer && (
            <>
              <div className="my-3 border-t border-[#1e2130]" />
              <p className="text-gray-600 text-xs font-semibold uppercase px-4 py-2">Site Settings</p>
              <SideTab icon={Settings} label="Hero Section" active={tab === 'settings'} onClick={() => setTab('settings')} />
            </>
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* ── TOURNAMENTS TAB ── */}
          {tab === 'tournaments' && (
            <div className="max-w-6xl">
              <TournamentManager
                tournaments={visibleTournaments}
                organizerMode={isOrganizer}
                onTournamentsChange={async (tournaments) => {
                  // For organizers, `tournaments` only contains their scoped tournament(s).
                  // Merge back into the full list so we never drop other tournaments.
                  const merged = isOrganizer
                    ? data.tournaments.map(t => tournaments.find(x => x.id === t.id) ?? t)
                    : tournaments;

                  // Upsert new/changed tournaments to Supabase. Organizers cannot
                  // create or delete tournaments — only edit their assigned one.
                  const curr = new Set(merged.map(t => t.id));
                  const deleted = isOrganizer ? [] : data.tournaments.filter(t => !curr.has(t.id));
                  const upserted = isOrganizer
                    ? merged.filter(t => t.id === scopedTournamentId)
                    : merged;
                  try {
                    await Promise.all([
                      ...upserted.map(upsertTournament),
                      ...deleted.map(t => deleteTournament(t.id)),
                    ]);
                  } catch { showToast('DB sync failed, saved locally', 'error'); }
                  save({ ...data, tournaments: merged });
                }}
              />
            </div>
          )}

          {/* ── REQUESTS TAB (superadmin) ── */}
          {tab === 'requests' && isSuperadmin && (
            <RequestsPanel
              showToast={showToast}
              onApproved={() => {
                // A new tournament was created server-side — reload admin data.
                clearDbCache();
                loadAdminDataAuthed().then(d => setData(d)).catch(() => {});
              }}
            />
          )}

          {/* ── NEWS TAB ── */}
          {tab === 'news' && (
            <div className="max-w-3xl space-y-5">
              <div>
                <h2 className="text-white font-bold text-lg">Latest News</h2>
                <p className="text-gray-500 text-sm">
                  {isOrganizer
                    ? 'Manage news articles for your tournament. New articles are automatically tagged to your tournament.'
                    : 'Manage news articles shown on the homepage. Each article saves on its own.'}
                </p>
              </div>
              <NewsEditor
                items={visibleNews}
                tournaments={visibleTournaments}
                lockedTournamentId={isOrganizer ? (scopedTournamentId ?? undefined) : undefined}
                onChange={news => setData(d => {
                  // For organizers, `news` is only their scoped subset — merge it
                  // back into the full list so other tournaments' news is untouched.
                  if (!isOrganizer) return { ...d, news };
                  const scopedIds = new Set(news.map(n => n.id));
                  const others = d.news.filter(n => n.tournamentId !== scopedTournamentId && !scopedIds.has(n.id));
                  return { ...d, news: [...others, ...news] };
                })}
                savingId={savingNewsId}
                onSaveArticle={async (item) => {
                  setSavingNewsId(item.id);
                  try {
                    await upsertNews(item);
                    persistedNewsIds.current.add(item.id);
                    onDataChange?.(data);
                    showToast('Article saved!', 'success');
                  } catch (e) {
                    console.error('[Admin] Failed to save article:', e);
                    showToast(e instanceof Error ? `Failed to save article: ${e.message}` : 'Failed to save article', 'error');
                  } finally {
                    setSavingNewsId(null);
                  }
                }}
                onToggleVisible={async (item) => {
                  // Apply the flipped visibility locally, then persist just this
                  // article immediately so the change saves on click.
                  setData(d => {
                    const news = d.news.map(n => n.id === item.id ? item : n);
                    const next = { ...d, news };
                    onDataChange?.(next);
                    return next;
                  });
                  try {
                    await upsertNews(item);
                    persistedNewsIds.current.add(item.id);
                    showToast(item.visible ? 'Article shown' : 'Article hidden', 'success');
                  } catch (e) {
                    console.error('[Admin] Failed to update visibility:', e);
                    showToast('Failed to save visibility', 'error');
                  }
                }}
                onDeleteArticle={async (id) => {
                  // Remove locally and, if it was already persisted, delete in DB.
                  setData(d => ({ ...d, news: d.news.filter(n => n.id !== id) }));
                  if (persistedNewsIds.current.has(id)) {
                    try {
                      await deleteNews(id);
                      persistedNewsIds.current.delete(id);
                    } catch (e) {
                      console.error('[Admin] Failed to delete article:', e);
                      showToast('Failed to delete article', 'error');
                    }
                  }
                }}
              />
            </div>
          )}

          {/* ── SETTINGS TAB ── */}
          {tab === 'settings' && (
            <div className="max-w-3xl space-y-5">
              <div>
                <h2 className="text-white font-bold text-lg">Hero Section</h2>
                <p className="text-gray-500 text-sm">Configure the main hero banner on the homepage</p>
              </div>
              
              <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-2 font-medium">Watch Live Button Link</label>
                  <p className="text-xs text-gray-600 mb-3">Enter the URL to open when users click the "Watch Live" button</p>
                  <input
                    type="url"
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-4 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
                    value={data.heroLink || ''}
                    onChange={e => setData(d => ({ ...d, heroLink: e.target.value }))}
                    placeholder="https://example.com/watch"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2 font-medium">Hero Background Video</label>
                  <p className="text-xs text-gray-600 mb-3">Upload an .mp4 / .webm clip (max 100&nbsp;MB) for a seamless, control-free looping background — or paste a direct video URL below. When set, this replaces the static background image.</p>

                  {/* Upload button */}
                  <input
                    ref={videoFileRef}
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 100 * 1024 * 1024) {
                        showToast('Video too large — max 100 MB', 'error');
                        if (videoFileRef.current) videoFileRef.current.value = '';
                        return;
                      }
                      setUploadingVideo(true);
                      try {
                        const url = await uploadHeroVideo(file);
                        setData(d => ({ ...d, heroVideo: url }));
                        await setSiteConfig('hero_video', url);
                        showToast('Video uploaded!', 'success');
                      } catch (err) {
                        showToast(err instanceof Error ? `Upload failed: ${err.message}` : 'Upload failed', 'error');
                      } finally {
                        setUploadingVideo(false);
                        if (videoFileRef.current) videoFileRef.current.value = '';
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadingVideo}
                    onClick={() => videoFileRef.current?.click()}
                    className="flex items-center gap-2 bg-[#0d0f16] border border-[#2a2d3a] hover:border-[#ff4655] text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed mb-3"
                  >
                    {uploadingVideo
                      ? <><Loader className="w-4 h-4 animate-spin" /> Uploading…</>
                      : <><ImageIcon className="w-4 h-4" /> Upload Video File</>}
                  </button>

                  {/* Or paste URL */}
                  <input
                    type="url"
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-4 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
                    value={data.heroVideo || ''}
                    onChange={e => setData(d => ({ ...d, heroVideo: e.target.value }))}
                    placeholder="…or paste a direct URL / YouTube link"
                  />
                  {data.heroVideo && (
                    <div className="flex items-center gap-2 mt-2">
                      <p className="text-xs text-green-500 flex-1 truncate">✓ {data.heroVideo}</p>
                      <button
                        type="button"
                        onClick={async () => {
                          setData(d => ({ ...d, heroVideo: '' }));
                          try { await setSiteConfig('hero_video', ''); showToast('Video removed', 'success'); }
                          catch { showToast('Failed to remove video', 'error'); }
                        }}
                        className="text-xs text-gray-400 hover:text-[#ff4655] transition-colors whitespace-nowrap"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Spotlight Tournament — featured on homepage standings, tournaments page, and elsewhere */}
              <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-6 space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-2 font-medium">Spotlight Tournament</label>
                  <p className="text-xs text-gray-600 mb-3">Choose the featured tournament. It will display on the homepage standings, tournaments page spotlight, and other featured sections. Upload its cover image in the tournament editor.</p>
                  <select
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-4 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors"
                    value={data.spotlightTournamentId || ''}
                    onChange={e => setData(d => ({ ...d, spotlightTournamentId: e.target.value || undefined }))}
                  >
                    <option value="">Auto (first in-progress, then first)</option>
                    {data.tournaments.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={async () => {
                  try {
                    await setSiteConfig('hero_link', data.heroLink ?? '');
                    await setSiteConfig('hero_video', data.heroVideo ?? '');
                    await setSiteConfig('spotlight_tournament_id', data.spotlightTournamentId ?? '');
                    save(data);
                  } catch { showToast('Failed to save settings', 'error'); }
                }}
                className="flex items-center gap-2 bg-[#ff4655] hover:bg-[#ff3344] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                <Save className="w-4 h-4" /> Save Settings
              </button>
            </div>
          )}
        </main>
      </div>

      {toast && <Toast message={toast.msg} type={toast.type} />}
    </div>
  );
}

export type { AdminData };
