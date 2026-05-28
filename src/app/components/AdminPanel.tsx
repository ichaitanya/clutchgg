import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, Plus, Trash2, Edit3, Save, X, ChevronDown, ChevronRight,
  Tv, Calendar, Clock, Users, Trophy, AlertCircle,
  CheckCircle, Eye, EyeOff, Swords, BarChart2, Globe,
  Lock, LogOut, KeyRound, User, TrendingUp, Zap, Settings
} from 'lucide-react';
import { CreateTournamentScreen, type Tournament } from './TournamentCreation';
import { TournamentManager } from './TournamentManager';

// ─── Auth ─────────────────────────────────────────────────────────────────────

const AUTH_KEY = 'vct_admin_auth';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'vct2026';   // ← change this to your preferred password

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  const attempt = () => {
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      sessionStorage.setItem(AUTH_KEY, '1');
      onSuccess();
    } else {
      setError('Invalid username or password');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPassword('');
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
                <label className="block text-xs text-gray-400 font-medium mb-1.5">Username</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                  <input
                    autoFocus
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-xl pl-10 pr-4 py-3 text-white text-sm focus:border-[#ff4655] focus:outline-none transition-colors placeholder:text-gray-600"
                    placeholder="Enter username"
                    value={username}
                    onChange={e => { setUsername(e.target.value); setError(''); }}
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
                disabled={!username || !password}
                className="w-full bg-[#ff4655] hover:bg-[#ff3344] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm mt-2 flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" /> Sign In
              </button>
            </div>

            <p className="text-center text-gray-600 text-xs mt-6">
              Default: <span className="font-mono text-gray-500">admin</span> / <span className="font-mono text-gray-500">vct2026</span>
            </p>
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

export interface NewsItem {
  id: string;
  title: string;
  category: string;
  timeAgo: string;
  imageUrl: string;
  link: string;
  visible: boolean;
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

const uid = () => Math.random().toString(36).slice(2, 9);

const STORAGE_KEY = 'vct_admin_data';

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

// ─── News Editor ──────────────────────────────────────────────────────────────

function NewsEditor({ items, onChange }: { items: NewsItem[]; onChange: (n: NewsItem[]) => void }) {
  const update = (id: string, key: keyof NewsItem, val: any) => {
    onChange(items.map(n => n.id === id ? { ...n, [key]: val } : n));
  };
  const addItem = () => {
    onChange([...items, { id: uid(), title: '', category: 'NEWS', timeAgo: 'Just now', imageUrl: '', link: '', visible: true }]);
  };
  const remove = (id: string) => onChange(items.filter(n => n.id !== id));

  return (
    <div className="space-y-4">
      {items.map(item => (
        <div key={item.id} className="bg-[#151821] border border-[#2a2d3a] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 font-medium">News item</span>
            <div className="flex items-center gap-3">
              <button onClick={() => update(item.id, 'visible', !item.visible)} className={`flex items-center gap-1 text-xs transition-colors ${item.visible ? 'text-[#ff4655]' : 'text-gray-600 hover:text-gray-400'}`}>
                {item.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                {item.visible ? 'Visible' : 'Hidden'}
              </button>
              <button onClick={() => remove(item.id)} className="text-gray-600 hover:text-[#ff4655] transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <input
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
            value={item.title} onChange={e => update(item.id, 'title', e.target.value)} placeholder="Article title..."
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={item.category} onChange={e => update(item.id, 'category', e.target.value)} placeholder="CATEGORY"
            />
            <input
              className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
              value={item.timeAgo} onChange={e => update(item.id, 'timeAgo', e.target.value)} placeholder="2 hours ago"
            />
          </div>
          <input
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
            value={item.imageUrl} onChange={e => update(item.id, 'imageUrl', e.target.value)} placeholder="Image URL (https://...)"
          />
          <input
            className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded-lg px-3 py-2 text-white text-sm focus:border-[#ff4655] focus:outline-none"
            value={item.link} onChange={e => update(item.id, 'link', e.target.value)} placeholder="Article link (https://...)"
          />
        </div>
      ))}
      <button onClick={addItem} className="flex items-center gap-2 text-sm text-[#ff4655] hover:text-[#ff6670] transition-colors px-1">
        <Plus className="w-4 h-4" /> Add news item
      </button>
    </div>
  );
}


// ─── Players Editor ───────────────────────────────────────────────────────────

function PlayersEditor({ players, onChange }: { players: TopPlayer[]; onChange: (p: TopPlayer[]) => void }) {
  const update = (id: string, key: keyof TopPlayer, val: any) => {
    onChange(players.map(p => p.id === id ? { ...p, [key]: val } : p));
  };
  const addPlayer = () => {
    const newPlayer: TopPlayer = { id: uid(), rank: players.length + 1, name: '', team: '', rating: 1.00, kills: 0, deaths: 0 };
    onChange([...players, newPlayer]);
  };
  const remove = (id: string) => onChange(players.filter(p => p.id !== id));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-[#2a2d3a]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#151821] text-gray-400 text-xs uppercase">
              <th className="px-4 py-3 text-left w-16">Rank</th>
              <th className="px-4 py-3 text-left">Player Name</th>
              <th className="px-4 py-3 text-left w-24">Team</th>
              <th className="px-4 py-3 text-center w-24">Rating</th>
              <th className="px-4 py-3 text-center w-20">Kills</th>
              <th className="px-4 py-3 text-center w-20">Deaths</th>
              <th className="px-4 py-3 text-center w-20">K/D</th>
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody>
            {players.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-600 text-sm">
                  No players yet. Add one below.
                </td>
              </tr>
            )}
            {players.map((player) => (
              <tr key={player.id} className="border-t border-[#2a2d3a] hover:bg-[#151821] transition-colors">
                <td className="px-4 py-2">
                  <input type="number" min={1}
                    className="w-12 bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                    value={player.rank} onChange={e => update(player.id, 'rank', Number(e.target.value))}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                    value={player.name} onChange={e => update(player.id, 'name', e.target.value)}
                    placeholder="Player name"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-white text-sm focus:border-[#ff4655] focus:outline-none"
                    value={player.team} onChange={e => update(player.id, 'team', e.target.value)}
                    placeholder="PRX"
                  />
                </td>
                <td className="px-4 py-2">
                  <input type="number" min={0} max={5} step={0.01}
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-[#ff4655] text-sm text-center focus:border-[#ff4655] focus:outline-none"
                    value={player.rating} onChange={e => update(player.id, 'rating', parseFloat(e.target.value) || 0)}
                  />
                </td>
                <td className="px-4 py-2">
                  <input type="number" min={0}
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-green-400 text-sm text-center focus:border-[#ff4655] focus:outline-none"
                    value={player.kills} onChange={e => update(player.id, 'kills', Number(e.target.value))}
                  />
                </td>
                <td className="px-4 py-2">
                  <input type="number" min={0}
                    className="w-full bg-[#0d0f16] border border-[#2a2d3a] rounded px-2 py-1 text-red-400 text-sm text-center focus:border-[#ff4655] focus:outline-none"
                    value={player.deaths} onChange={e => update(player.id, 'deaths', Number(e.target.value))}
                  />
                </td>
                <td className="px-4 py-2 text-center text-gray-400 text-xs">
                  {player.kills}/{player.deaths}
                </td>
                <td className="px-4 py-2">
                  <button onClick={() => remove(player.id)} className="text-gray-600 hover:text-[#ff4655] transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addPlayer} className="flex items-center gap-2 text-sm text-[#ff4655] hover:text-[#ff6670] transition-colors px-1">
        <Plus className="w-4 h-4" /> Add player
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

type Tab = 'matches' | 'standings' | 'news' | 'players' | 'tournaments' | 'settings';

export function AdminPanel({ onClose, onDataChange }: {
  onClose: () => void;
  onDataChange?: (data: AdminData) => void;
}) {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(AUTH_KEY) === '1');
  if (!authed) {
    return <AdminLogin onSuccess={() => setAuthed(true)} />;
  }
  return <AdminPanelInner onClose={onClose} onDataChange={onDataChange} onLogout={() => {
    sessionStorage.removeItem(AUTH_KEY);
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
  const [tab, setTab] = useState<Tab>('matches');
  const [data, setData] = useState<AdminData>(defaultData);
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [addingMatch, setAddingMatch] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Migrate old data that lacks players key
        if (!parsed.players) parsed.players = defaultData.players;
        // Migrate old data that lacks tournaments key
        if (!parsed.tournaments) parsed.tournaments = [];
        setData(parsed);
      }
    } catch {}
  }, []);

  const save = (newData: AdminData) => {
    setData(newData);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
    } catch {}
    onDataChange?.(newData);
    showToast('Changes saved!', 'success');
  };

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  };

  // Matches
  const saveMatch = (m: Match) => {
    const exists = data.matches.find(x => x.id === m.id);
    const matches = exists ? data.matches.map(x => x.id === m.id ? m : x) : [...data.matches, m];
    save({ ...data, matches });
    setEditingMatch(null);
    setAddingMatch(false);
  };
  const deleteMatch = (id: string) => {
    save({ ...data, matches: data.matches.filter(m => m.id !== id) });
  };
  const toggleMatchVisible = (id: string) => {
    save({ ...data, matches: data.matches.map(m => m.id === id ? { ...m, visible: !m.visible } : m) });
  };

  const liveCount = data.matches.filter(m => m.status === 'live').length;
  const upcomingCount = data.matches.filter(m => m.status === 'upcoming').length;

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
          <SideTab icon={Swords} label="Matches" active={tab === 'matches'} count={data.matches.length} onClick={() => setTab('matches')} />
          <SideTab icon={Trophy} label="Tournaments" active={tab === 'tournaments'} count={data.tournaments.length} onClick={() => setTab('tournaments')} />
          <SideTab icon={BarChart2} label="Standings" active={tab === 'standings'} count={data.standings.length} onClick={() => setTab('standings')} />
          <SideTab icon={Trophy} label="News" active={tab === 'news'} count={data.news.length} onClick={() => setTab('news')} />
          <SideTab icon={TrendingUp} label="Top Players" active={tab === 'players'} count={(data.players || []).length} onClick={() => setTab('players')} />

          <div className="my-3 border-t border-[#1e2130]" />
          <p className="text-gray-600 text-xs font-semibold uppercase px-4 py-2">Site Settings</p>
          <SideTab icon={Settings} label="Hero Section" active={tab === 'settings'} onClick={() => setTab('settings')} />

          <div className="mt-auto pt-4 border-t border-[#1e2130] space-y-2">
            <div className="bg-[#1e2130] rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Live now</span>
                <span className="text-xs font-bold text-[#ff4655]">{liveCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Upcoming</span>
                <span className="text-xs font-bold text-[#60a5fa]">{upcomingCount}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">

          {/* ── MATCHES TAB ── */}
          {tab === 'matches' && (
            <div className="max-w-3xl space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-bold text-lg">Matches</h2>
                  <p className="text-gray-500 text-sm">Manage live, upcoming, and completed matches</p>
                </div>
                {!addingMatch && !editingMatch && (
                  <button
                    onClick={() => setAddingMatch(true)}
                    className="flex items-center gap-2 bg-[#ff4655] hover:bg-[#ff3344] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-all"
                  >
                    <Plus className="w-4 h-4" /> Add Match
                  </button>
                )}
              </div>

              {addingMatch && (
                <MatchForm
                  match={emptyMatch()}
                  onSave={saveMatch}
                  onCancel={() => setAddingMatch(false)}
                  teamNames={Array.from(new Set(data.tournaments.flatMap(t => t.teams.map(tm => tm.name))))}
                />
              )}

              {editingMatch && (
                <MatchForm
                  match={editingMatch}
                  onSave={saveMatch}
                  onCancel={() => setEditingMatch(null)}
                  teamNames={Array.from(new Set(data.tournaments.flatMap(t => t.teams.map(tm => tm.name))))}
                />
              )}

              {/* Match list */}
              <div className="space-y-3">
                {data.matches.length === 0 && (
                  <div className="text-center py-16 text-gray-600">
                    <Swords className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No matches yet. Add one above.</p>
                  </div>
                )}
                {data.matches.map(match => (
                  <div
                    key={match.id}
                    className={`bg-[#151821] border rounded-xl p-4 transition-all ${
                      match.visible ? 'border-[#2a2d3a] hover:border-[#3a3d4a]' : 'border-[#1e2130] opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <StatusBadge status={match.status} />
                          <span className="text-white font-bold text-sm">
                            {match.team1 || '—'} <span className="text-gray-500 font-normal">vs</span> {match.team2 || '—'}
                          </span>
                          {(match.status === 'live' || match.status === 'completed') && (
                            <span className="text-[#ff4655] font-bold text-sm">{match.score1} – {match.score2}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1"><Trophy className="w-3 h-3" />{match.tournament}</span>
                          {match.status === 'upcoming' && match.date && (
                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{match.date}</span>
                          )}
                          {match.status === 'upcoming' && match.time && (
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{match.time}</span>
                          )}
                          {match.status === 'live' && match.map && (
                            <span className="flex items-center gap-1"><Tv className="w-3 h-3" />{match.map}</span>
                          )}
                          {match.status === 'live' && match.viewers && (
                            <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{match.viewers}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => toggleMatchVisible(match.id)}
                          title={match.visible ? 'Hide from site' : 'Show on site'}
                          className={`p-2 rounded-lg transition-all hover:bg-[#1e2130] ${match.visible ? 'text-gray-400 hover:text-white' : 'text-gray-700 hover:text-gray-400'}`}
                        >
                          {match.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => { setEditingMatch(match); setAddingMatch(false); }}
                          className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#1e2130] transition-all"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteMatch(match.id)}
                          className="p-2 rounded-lg text-gray-600 hover:text-[#ff4655] hover:bg-[#1e2130] transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── TOURNAMENTS TAB ── */}
          {tab === 'tournaments' && (
            <div className="max-w-6xl">
              <TournamentManager
                tournaments={data.tournaments}
                onTournamentsChange={(tournaments) => {
                  save({ ...data, tournaments });
                }}
              />
            </div>
          )}

          {tab === 'standings' && (
            <div className="max-w-3xl space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-bold text-lg">Group Standings</h2>
                  <p className="text-gray-500 text-sm">Edit team rankings, wins, and losses</p>
                </div>
                <button
                  onClick={() => save({ ...data, standings: [...data.standings].sort((a, b) => b.wins - a.wins).map((t, i) => ({ ...t, rank: i + 1 })) })}
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-[#1e2130] border border-[#2a2d3a] px-3 py-2 rounded-xl transition-all"
                >
                  <BarChart2 className="w-3.5 h-3.5" /> Auto-rank by wins
                </button>
              </div>
              <StandingsEditor
                teams={data.standings}
                onChange={standings => setData(d => ({ ...d, standings }))}
              />
              <button
                onClick={() => save(data)}
                className="flex items-center gap-2 bg-[#ff4655] hover:bg-[#ff3344] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                <Save className="w-4 h-4" /> Save Standings
              </button>
            </div>
          )}

          {/* ── NEWS TAB ── */}
          {tab === 'news' && (
            <div className="max-w-3xl space-y-5">
              <div>
                <h2 className="text-white font-bold text-lg">Latest News</h2>
                <p className="text-gray-500 text-sm">Manage news cards shown on the homepage</p>
              </div>
              <NewsEditor
                items={data.news}
                onChange={news => setData(d => ({ ...d, news }))}
              />
              <button
                onClick={() => save(data)}
                className="flex items-center gap-2 bg-[#ff4655] hover:bg-[#ff3344] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                <Save className="w-4 h-4" /> Save News
              </button>
            </div>
          )}

          {/* ── PLAYERS TAB ── */}
          {tab === 'players' && (
            <div className="max-w-4xl space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-white font-bold text-lg">Top Players</h2>
                  <p className="text-gray-500 text-sm">Manage the top players leaderboard shown on the homepage</p>
                </div>
                <button
                  onClick={() => save({ ...data, players: [...(data.players || [])].sort((a, b) => b.rating - a.rating).map((p, i) => ({ ...p, rank: i + 1 })) })}
                  className="flex items-center gap-2 text-sm text-gray-400 hover:text-white bg-[#1e2130] border border-[#2a2d3a] px-3 py-2 rounded-xl transition-all"
                >
                  <TrendingUp className="w-3.5 h-3.5" /> Auto-rank by rating
                </button>
              </div>
              <PlayersEditor
                players={data.players || []}
                onChange={players => setData(d => ({ ...d, players }))}
              />
              <button
                onClick={() => save(data)}
                className="flex items-center gap-2 bg-[#ff4655] hover:bg-[#ff3344] text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-all"
              >
                <Save className="w-4 h-4" /> Save Players
              </button>
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
                onClick={() => save(data)}
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
