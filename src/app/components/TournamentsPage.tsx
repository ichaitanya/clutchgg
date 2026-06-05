import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Header } from './Header';
import { Footer } from './Footer';
import { ImageWithFallback } from './figma/ImageWithFallback';
import type { AdminData } from './AdminPanel';
import type { Tournament } from './TournamentCreation';
import { loadAdminData, loadWithRetry } from '../services/db';
import { deriveTournamentStatus } from '../utils/tournamentStatus';

// Total teams across a tournament (single-stage or grouped).
function teamCount(t: Tournament): number {
  return t.teams?.length ?? 0;
}

// Best-effort prize pool string for display.
function prizeText(t: Tournament): string {
  const pp = t.event?.prizePool;
  if (!pp) return '—';
  if (pp.total) return pp.total;
  if (pp.places?.length) return pp.places[0]?.prize || '—';
  return '—';
}

// Human label for tournament status.
function statusLabel(status: Tournament['status']): string {
  switch (status) {
    case 'in-progress': return 'In Progress';
    case 'registration': return 'Registration';
    case 'planning': return 'Upcoming';
    case 'completed': return 'Completed';
    default: return status;
  }
}

function formatDate(iso?: string): string {
  if (!iso) return 'TBD';
  try {
    return new Date(`${iso}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return 'TBD'; }
}

function shortDate(iso?: string): string {
  if (!iso) return 'TBD';
  try {
    return new Date(`${iso}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  } catch { return 'TBD'; }
}

export function TournamentsPage() {
  const navigate = useNavigate();
  const [adminData, setAdminData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  useEffect(() => loadWithRetry(loadAdminData, setAdminData), []);

  // Override each tournament's stored status with the live, data-derived status.
  const all = (adminData?.tournaments ?? []).map(t => ({
    ...t,
    status: deriveTournamentStatus(t),
  }));

  // Featured = selected spotlight tournament, or first in-progress, else first overall. Spotlight = next upcoming.
  const featured = (adminData?.spotlightTournamentId 
    ? all.find(t => t.id === adminData.spotlightTournamentId)
    : all.find(t => t.status === 'in-progress')) || all[0] || null;
  const spotlight =
    all.find(t => (t.status === 'registration' || t.status === 'planning') && t.id !== featured?.id) || null;

  // Schedule list split by tab.
  const scheduled = all.filter(t =>
    tab === 'past' ? t.status === 'completed' : t.status !== 'completed'
  );

  return (
    <div className="min-h-screen bg-[#0e0e0e]">
      <Header />

      {/* Centered hero */}
      <section className="arena-page-hero">
        <p className="arena-page-hero__eyebrow">Global Circuit {new Date().getFullYear()}</p>
        <h1 className="arena-page-hero__title">Master the Arena. Claim Your Glory.</h1>
        <p className="arena-page-hero__subtitle">
          The definitive hub for competitive gaming. Join elite brackets, track
          live statistics, and compete for the industry's most prestigious prize pools.
        </p>
      </section>

      <div className="arena-page">
        {/* Spotlight card */}
        {featured && (
          <section className="arena-spotlight">
            {/* Featured (left) */}
            <div
              className="arena-spotlight__feature"
              onClick={() => navigate(`/tournament/${featured.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <ImageWithFallback
                src={featured.coverImage || 'https://images.unsplash.com/photo-1542751371-adc38448a05e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&w=1200'}
                alt={featured.name}
              />
              {featured.status === 'in-progress' && (
                <span className="arena-spotlight__live">Live Now</span>
              )}
              <h2 className="arena-spotlight__feature-title">{featured.name}</h2>
              <p className="arena-spotlight__feature-desc">{featured.overview || 'Elite rosters battle for the championship crown.'}</p>
              <div className="arena-spotlight__stats">
                <div>
                  <p className="arena-spotlight__stat-label">Prize Pool</p>
                  <p className="arena-spotlight__stat-value">{prizeText(featured)}</p>
                </div>
                <div>
                  <p className="arena-spotlight__stat-label">Teams</p>
                  <p className="arena-spotlight__stat-value">{teamCount(featured)}</p>
                </div>
              </div>
            </div>

            {/* Side panel (right) — next upcoming, or featured details */}
            <div className="arena-spotlight__side">
              <p className="arena-spotlight__side-eyebrow">Upcoming Spotlight</p>
              <h3 className="arena-spotlight__side-title">{(spotlight || featured).name}</h3>
              <p className="arena-spotlight__side-desc">
                {(spotlight || featured).overview || 'Open registration for competing teams.'}
              </p>
              <div className="arena-spotlight__detail">
                <span className="arena-spotlight__detail-label">Date</span>
                <span className="arena-spotlight__detail-value">{formatDate((spotlight || featured).event?.startDate)}</span>
              </div>
              <div className="arena-spotlight__detail">
                <span className="arena-spotlight__detail-label">Teams</span>
                <span className="arena-spotlight__detail-value">
                  {teamCount(spotlight || featured)} / {(spotlight || featured).event?.maxTeams ?? '—'}
                </span>
              </div>
              <Link to={`/tournament/${(spotlight || featured).id}`} className="arena-spotlight__register">
                View Tournament
              </Link>
            </div>
          </section>
        )}

        {/* Event Schedule */}
        <section>
          <div className="arena-schedule__header">
            <div>
              <h2 className="arena-schedule__title">Event Schedule</h2>
              <p className="arena-schedule__subtitle">Browse active, upcoming and historic tournaments.</p>
            </div>
            <div className="arena-schedule__tabs">
              <button
                className={`arena-schedule__tab${tab === 'upcoming' ? ' arena-schedule__tab--active' : ''}`}
                onClick={() => setTab('upcoming')}
              >
                Upcoming
              </button>
              <button
                className={`arena-schedule__tab${tab === 'past' ? ' arena-schedule__tab--active' : ''}`}
                onClick={() => setTab('past')}
              >
                Past Results
              </button>
            </div>
          </div>

          {scheduled.length > 0 ? (
            <div>
              {scheduled.map(t => (
                <Link key={t.id} to={`/tournament/${t.id}`} className="arena-event-row">
                  <div>
                    <p className="arena-event-row__date">{shortDate(t.event?.startDate)}</p>
                    <p className={`arena-event-row__status${t.status === 'in-progress' ? ' arena-event-row__status--live' : ''}`}>
                      {statusLabel(t.status)}
                    </p>
                  </div>
                  <div>
                    <p className="arena-event-row__name">{t.name}</p>
                    <p className="arena-event-row__meta">
                      {t.event?.type ? t.event.type.toUpperCase() : 'GLOBAL'} • {teamCount(t)} TEAMS
                    </p>
                  </div>
                  <div>
                    <p className="arena-event-row__prize-label">Prize Pool</p>
                    <p className="arena-event-row__prize-value">{prizeText(t)}</p>
                  </div>
                  <div className="arena-event-row__action">
                    {t.status === 'in-progress' ? 'Watch' : 'Full Details'}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 text-sm border-t border-[#2b2b2b]">
              No {tab === 'past' ? 'past' : 'upcoming'} tournaments
            </div>
          )}
        </section>

        {/* Newsletter CTA */}
        <section className="arena-newsletter">
          <h2 className="arena-newsletter__title">Never Miss a Bracket</h2>
          <p className="arena-newsletter__subtitle">
            Join 50,000+ competitors who receive early access to registration, meta
            reports, and live notifications.
          </p>
          <form className="arena-newsletter__form" onSubmit={e => e.preventDefault()}>
            <input className="arena-newsletter__input" type="email" placeholder="Email address" />
            <button className="arena-newsletter__btn" type="submit">Subscribe</button>
          </form>
        </section>
      </div>

      <Footer />
    </div>
  );
}
