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
import { supabase, signIn, signOut } from '../services/supabase';
import { loadAdminData, upsertTournament, deleteTournament, upsertNews, deleteNews, replaceStandings, setSiteConfig, migrateFromLocalStorage } from '../services/db';

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
    } catch {
      setError('Invalid email or password');
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

// Read an uploaded image file as a base64 data URL.
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
    const url = await readImageAsDataUrl(file);
    updateBlock(id, { url } as Partial<NewsBlock>);
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

function NewsEditor({ items, onChange, onSaveArticle, onDeleteArticle, savingId, tournaments }: {
  items: NewsItem[];
  onChange: (n: NewsItem[]) => void;
  onSaveArticle: (item: NewsItem) => void;
  onDeleteArticle: (id: string) => void;
  savingId: string | null;
  tournaments: Tournament[];
}) {
  const mentionIndex = useMemo(() => buildMentionIndex(tournaments), [tournaments]);
  // Which article is currently expanded for editing (only one at a time).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const update = (id: string, patch: Partial<NewsItem>) => {
    onChange(items.map(n => n.id === id ? { ...n, ...patch } : n));
  };
  const addItem = () => {
    const id = uid();
    onChange([...items, { id, title: '', category: 'NEWS', timeAgo: 'Just now', imageUrl: '', link: '', visible: true, author: '', body: [] }]);
    setExpandedId(id); // open the new article for editing
  };

  const handleCover = async (id: string, file: File) => {
    const url = await readImageAsDataUrl(file);
    update(id, { imageUrl: url });
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
                onClick={() => update(item.id, { visible: !item.visible })}
                className={`flex items-center gap-1 text-xs transition-colors ${item.visible ? 'text-[#ff4655]' : 'text-gray-600 hover:text-gray-400'}`}
                title={item.visible ? 'Visible' : 'Hidden'}
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
              <button onClick={() => update(item.id, { visible: !item.visible })} className={`flex items-center gap-1 text-xs transition-colors ${item.visible ? 'text-[#ff4655]' : 'text-gray-600 hover:text-gray-400'}`}>
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
            <label className="block text-xs text-gray-400 mb-1.5 font-medium">Tournament <span className="text-gray-600">(optional)</span></label>
            <select
              className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={item.tournamentId ?? ''}
              onChange={e => update(item.id, { tournamentId: e.target.value || undefined })}
            >
              <option value="">No tournament</option>
              {tournaments.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
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

type Tab = 'news' | 'tournaments' | 'settings';

export function AdminPanel({ onClose, onDataChange }: {
  onClose: () => void;
  onDataChange?: (data: AdminData) => void;
}) {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthed(!!data.session);
      setChecking(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session);
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
    return <AdminLogin onSuccess={() => setAuthed(true)} />;
  }

  return <AdminPanelInner onClose={onClose} onDataChange={onDataChange} onLogout={async () => {
    await signOut();
    setAuthed(false);
    navigate('/');
  }} />;
}

function AdminPanelInner({ onClose, onDataChange, onLogout }: {
  onClose: () => void;
  onDataChange?: (data: AdminData) => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('tournaments');
  const [data, setData] = useState<AdminData>(defaultData);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [dbLoading, setDbLoading] = useState(true);
  const [savingNewsId, setSavingNewsId] = useState<string | null>(null);
  // IDs of news items currently persisted in the DB. Used on save to delete any
  // items the admin removed from the editor (the upsert pass alone can't remove).
  const persistedNewsIds = useRef<Set<string>>(new Set());

  // Load from Supabase on mount
  useEffect(() => {
    loadAdminData()
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
            <span className="text-xs text-gray-400 font-medium">admin</span>
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
          <SideTab icon={Trophy} label="Tournaments" active={tab === 'tournaments'} count={data.tournaments.length} onClick={() => setTab('tournaments')} />
          <SideTab icon={Trophy} label="News" active={tab === 'news'} count={data.news.length} onClick={() => setTab('news')} />

          <div className="my-3 border-t border-[#1e2130]" />
          <p className="text-gray-600 text-xs font-semibold uppercase px-4 py-2">Site Settings</p>
          <SideTab icon={Settings} label="Hero Section" active={tab === 'settings'} onClick={() => setTab('settings')} />

        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* ── TOURNAMENTS TAB ── */}
          {tab === 'tournaments' && (
            <div className="max-w-6xl">
              <TournamentManager
                tournaments={data.tournaments}
                onTournamentsChange={async (tournaments) => {
                  // Upsert new/changed tournaments to Supabase
                  const prev = new Set(data.tournaments.map(t => t.id));
                  const curr = new Set(tournaments.map(t => t.id));
                  // Deleted ones
                  const deleted = data.tournaments.filter(t => !curr.has(t.id));
                  const upserted = tournaments; // upsert all current (new + updated)
                  try {
                    await Promise.all([
                      ...upserted.map(upsertTournament),
                      ...deleted.map(t => deleteTournament(t.id)),
                    ]);
                  } catch { showToast('DB sync failed, saved locally', 'error'); }
                  save({ ...data, tournaments });
                }}
              />
            </div>
          )}

          {/* ── NEWS TAB ── */}
          {tab === 'news' && (
            <div className="max-w-3xl space-y-5">
              <div>
                <h2 className="text-white font-bold text-lg">Latest News</h2>
                <p className="text-gray-500 text-sm">Manage news articles shown on the homepage. Each article saves on its own.</p>
              </div>
              <NewsEditor
                items={data.news}
                tournaments={data.tournaments}
                onChange={news => setData(d => ({ ...d, news }))}
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
              </div>

              <button
                onClick={async () => {
                  try {
                    await setSiteConfig('hero_link', data.heroLink ?? '');
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
