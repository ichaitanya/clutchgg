import { useState, useRef } from 'react';
import { Header } from './Header';
import { Footer } from './Footer';
import { createTournamentRequest } from '../services/db';

// Replace these with your actual EmailJS credentials when ready
const EMAILJS_SERVICE_ID = 'service_7kaukdv';
const EMAILJS_TEMPLATE_ID = 'template_3842w9f';
const EMAILJS_PUBLIC_KEY = 'p_AaPkV8j41bh5dtO';

interface FormState {
  organizer_name: string;
  email: string;
  phone: string;
  tournament_name: string;
  tournament_details: string;
}

type SubmitStatus = 'idle' | 'sending' | 'success' | 'error';

export function ContactPage() {
  const [form, setForm] = useState<FormState>({
    organizer_name: '',
    email: '',
    phone: '',
    tournament_name: '',
    tournament_details: '',
  });
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [toast, setToast] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');

    try {
      // 1. Persist the request so it shows up in the superadmin "Requests" panel
      //    for approve/deny. This is the source of truth — even if the email fails.
      await createTournamentRequest({
        organizerName: form.organizer_name,
        email: form.email,
        phone: form.phone,
        tournamentName: form.tournament_name,
        tournamentDetails: form.tournament_details,
      });

      // 2. Fire a notification email to the ClutchGG inbox (best-effort).
      //    A failed email must NOT block a successfully-saved request.
      try {
        const emailjs = await import('@emailjs/browser');
        await emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_ID,
          {
            organizer_name: form.organizer_name,
            email: form.email,
            phone: form.phone || 'Not provided',
            tournament_name: form.tournament_name,
            tournament_details: form.tournament_details,
          },
          EMAILJS_PUBLIC_KEY,
        );
      } catch (mailErr) {
        console.warn('[Contact] request saved but notification email failed:', mailErr);
      }

      setStatus('success');
      setToast(true);
      setForm({ organizer_name: '', email: '', phone: '', tournament_name: '', tournament_details: '' });
      setTimeout(() => setToast(false), 5000);
    } catch {
      setStatus('error');
    }
  };

  const isSending = status === 'sending';

  return (
    <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center py-20 px-4">
        <div className="arena-contact__card">
          <div className="arena-contact__header">
            <h1 className="arena-contact__title">Register Your Tournament</h1>
            <p className="arena-contact__sub">
              We'll create your tournament within 24 hours of approval.
            </p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="arena-contact__form">
            <div className="arena-contact__row">
              <div className="arena-contact__field">
                <input
                  type="text"
                  name="organizer_name"
                  placeholder="Organizer Name *"
                  required
                  value={form.organizer_name}
                  onChange={handleChange}
                  className="arena-contact__input"
                />
              </div>
              <div className="arena-contact__field">
                <input
                  type="email"
                  name="email"
                  placeholder="Email Address *"
                  required
                  value={form.email}
                  onChange={handleChange}
                  className="arena-contact__input"
                />
              </div>
            </div>

            <div className="arena-contact__field">
              <input
                type="tel"
                name="phone"
                placeholder="Phone Number (optional)"
                value={form.phone}
                onChange={handleChange}
                className="arena-contact__input"
              />
            </div>

            <div className="arena-contact__field">
              <input
                type="text"
                name="tournament_name"
                placeholder="Tournament Name *"
                required
                value={form.tournament_name}
                onChange={handleChange}
                className="arena-contact__input"
              />
            </div>

            <div className="arena-contact__field">
              <textarea
                name="tournament_details"
                placeholder="Tell us about your tournament format, team count, schedule, sponsors, prize pool, custom branding, etc."
                rows={5}
                value={form.tournament_details}
                onChange={handleChange}
                className="arena-contact__input arena-contact__textarea"
              />
            </div>

            {status === 'error' && (
              <p className="arena-contact__error">
                Something went wrong. Please try again or email us directly.
              </p>
            )}

            <button
              type="submit"
              disabled={isSending}
              className="arena-btn arena-btn--primary arena-contact__submit"
            >
              {isSending ? 'Initializing Tournament...' : 'Ready For Glory 🚀'}
            </button>
          </form>
        </div>
      </main>

      {toast && (
        <div className="arena-toast">
          <span className="arena-toast__icon">🎮</span>
          <div>
            <p className="arena-toast__title">Tournament Locked In</p>
            <p className="arena-toast__body">You'll receive an email once your tournament setup is ready.</p>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
