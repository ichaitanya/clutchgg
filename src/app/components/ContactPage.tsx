import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

// Field length limits, shared by the input maxLength and the validation pass.
const LIMITS = { organizer_name: 20, tournament_name: 35, tournament_details: 1000, phone: 15 };

// Common country dialing codes for the phone prefix dropdown.
const COUNTRY_CODES = [
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+61', label: '🇦🇺 +61' },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+65', label: '🇸🇬 +65' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+81', label: '🇯🇵 +81' },
  { code: '+880', label: '🇧🇩 +880' },
  { code: '+92', label: '🇵🇰 +92' },
  { code: '+977', label: '🇳🇵 +977' },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ContactPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>({
    organizer_name: '',
    email: '',
    phone: '',
    tournament_name: '',
    tournament_details: '',
  });
  const [countryCode, setCountryCode] = useState('+91');
  const [status, setStatus] = useState<SubmitStatus>('idle');
  const [toast, setToast] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    let next = value;
    // Phone accepts digits only, capped at 15 (E.164 max).
    if (name === 'phone') next = value.replace(/\D/g, '').slice(0, LIMITS.phone);
    else if (name in LIMITS) next = value.slice(0, LIMITS[name as keyof typeof LIMITS]);
    setForm(prev => ({ ...prev, [name]: next }));
    // Clear a field's error as the user corrects it.
    if (errors[name as keyof FormState]) {
      setErrors(prev => ({ ...prev, [name]: undefined }));
    }
  };

  // Validate a single field against the current form values. Returns an error
  // message or undefined. Used both on blur (per-field) and on submit (all).
  const validateField = (field: keyof FormState, f: FormState = form): string | undefined => {
    switch (field) {
      case 'organizer_name':
        if (!f.organizer_name.trim()) return 'Organizer name is required.';
        if (f.organizer_name.length > LIMITS.organizer_name) return `Max ${LIMITS.organizer_name} characters.`;
        return undefined;
      case 'email':
        if (!f.email.trim()) return 'Email is required.';
        if (!EMAIL_RE.test(f.email.trim())) return 'Enter a valid email address.';
        return undefined;
      case 'phone':
        // Optional, but if provided must be a sensible length.
        if (f.phone && (f.phone.length < 6 || f.phone.length > LIMITS.phone)) return 'Enter a valid phone number.';
        return undefined;
      case 'tournament_name':
        if (!f.tournament_name.trim()) return 'Tournament name is required.';
        if (f.tournament_name.length > LIMITS.tournament_name) return `Max ${LIMITS.tournament_name} characters.`;
        return undefined;
      case 'tournament_details':
        if (f.tournament_details.length > LIMITS.tournament_details) return `Max ${LIMITS.tournament_details} characters.`;
        return undefined;
    }
  };

  // Validate every field; empty map means valid.
  const validate = (): Partial<Record<keyof FormState, string>> => {
    const e: Partial<Record<keyof FormState, string>> = {};
    (Object.keys(form) as (keyof FormState)[]).forEach(field => {
      const msg = validateField(field);
      if (msg) e[field] = msg;
    });
    return e;
  };

  // Validate a field as the user leaves it, so errors surface immediately on blur.
  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const field = e.target.name as keyof FormState;
    setErrors(prev => ({ ...prev, [field]: validateField(field) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate before doing anything; show inline errors and stop on failure.
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setStatus('sending');
    // Full phone with dialing code, only when a number was entered.
    const fullPhone = form.phone ? `${countryCode} ${form.phone}` : '';

    try {
      // 1. Persist the request so it shows up in the superadmin "Requests" panel
      //    for approve/deny. This is the source of truth — even if the email fails.
      await createTournamentRequest({
        organizerName: form.organizer_name,
        email: form.email,
        phone: fullPhone,
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
            phone: fullPhone || 'Not provided',
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
      // Show the centered confirmation, then send the user home after 5s.
      setTimeout(() => navigate('/'), 5000);
    } catch {
      setStatus('error');
    }
  };

  const isSending = status === 'sending';

  return (
    <div className="min-h-screen bg-[#0e0e0e] flex flex-col">
      <Header />

      {/* Top-align (items-start) rather than center: on a short viewport a
          vertically-centered card taller than the viewport gets clipped at the
          top with no way to scroll to it. Top-aligning keeps the heading
          reachable and the page scrolls normally. */}
      <main className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="arena-contact__card">
          <div className="arena-contact__header">
            <h1 className="arena-contact__title">Register Your Tournament</h1>
            <p className="arena-contact__sub">
              We'll create your tournament within 24 hours of approval.
            </p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} noValidate className="arena-contact__form">
            <div className="arena-contact__row">
              <div className="arena-contact__field">
                <input
                  type="text"
                  name="organizer_name"
                  placeholder="Organizer Name *"
                  maxLength={LIMITS.organizer_name}
                  value={form.organizer_name}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`arena-contact__input${errors.organizer_name ? ' arena-contact__input--error' : ''}`}
                />
                {errors.organizer_name
                  ? <p className="arena-contact__field-error">{errors.organizer_name}</p>
                  : <p className="arena-contact__hint">{form.organizer_name.length}/{LIMITS.organizer_name}</p>}
              </div>
              <div className="arena-contact__field">
                <input
                  type="email"
                  name="email"
                  placeholder="Email Address *"
                  value={form.email}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`arena-contact__input${errors.email ? ' arena-contact__input--error' : ''}`}
                />
                {errors.email && <p className="arena-contact__field-error">{errors.email}</p>}
              </div>
            </div>

            <div className="arena-contact__field">
              <div className="arena-contact__phone">
                <select
                  value={countryCode}
                  onChange={e => setCountryCode(e.target.value)}
                  className="arena-contact__input arena-contact__phone-code"
                  aria-label="Country code"
                >
                  {COUNTRY_CODES.map(c => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
                <input
                  type="tel"
                  inputMode="numeric"
                  name="phone"
                  placeholder="Phone Number (optional)"
                  maxLength={LIMITS.phone}
                  value={form.phone}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  className={`arena-contact__input arena-contact__phone-num${errors.phone ? ' arena-contact__input--error' : ''}`}
                />
              </div>
              {errors.phone && <p className="arena-contact__field-error">{errors.phone}</p>}
            </div>

            <div className="arena-contact__field">
              <input
                type="text"
                name="tournament_name"
                placeholder="Tournament Name *"
                maxLength={LIMITS.tournament_name}
                value={form.tournament_name}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`arena-contact__input${errors.tournament_name ? ' arena-contact__input--error' : ''}`}
              />
              {errors.tournament_name
                ? <p className="arena-contact__field-error">{errors.tournament_name}</p>
                : <p className="arena-contact__hint">{form.tournament_name.length}/{LIMITS.tournament_name}</p>}
            </div>

            <div className="arena-contact__field">
              <textarea
                name="tournament_details"
                placeholder="Tell us about your tournament format, team count, schedule, sponsors, prize pool, custom branding, etc."
                rows={5}
                maxLength={LIMITS.tournament_details}
                value={form.tournament_details}
                onChange={handleChange}
                onBlur={handleBlur}
                className={`arena-contact__input arena-contact__textarea${errors.tournament_details ? ' arena-contact__input--error' : ''}`}
              />
              {errors.tournament_details
                ? <p className="arena-contact__field-error">{errors.tournament_details}</p>
                : <p className="arena-contact__hint">{form.tournament_details.length}/{LIMITS.tournament_details}</p>}
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
        <div className="arena-success-overlay" role="dialog" aria-modal="true">
          <div className="arena-success-modal">
            <span className="arena-success-modal__icon">🎮</span>
            <p className="arena-success-modal__title">Tournament Locked In</p>
            <p className="arena-success-modal__body">
              Your request was submitted. You'll receive an email once your tournament setup is ready.
            </p>
            <p className="arena-success-modal__redirect">Redirecting you home…</p>
            <button onClick={() => navigate('/')} className="arena-success-modal__btn">
              Go to Homepage now
            </button>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
