// ─────────────────────────────────────────────────────────────────────────────
// Shared social-platform definitions + icon rendering.
//
// One source of truth for the platforms a player can link (stored in the
// player_accounts.socials jsonb). Both the profile editor (PlayerProfilePage)
// and the public hero (SocialIconLinks, used by ClaimedProfileBlock) read this
// list so the supported set + icons never drift apart.
// ─────────────────────────────────────────────────────────────────────────────
import { Twitter, Twitch, Youtube, Instagram, type LucideIcon } from 'lucide-react';

// Lucide has no Discord glyph, so we ship a small inline SVG that matches the
// LucideIcon call signature (className/size via props) closely enough for our use.
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.432 3a13.6 13.6 0 0 0-.617 1.27 18.27 18.27 0 0 0-5.63 0A13.2 13.2 0 0 0 8.567 3 19.74 19.74 0 0 0 3.677 4.37C.533 9.05-.32 13.616.106 18.117a19.9 19.9 0 0 0 6.073 3.078c.488-.667.922-1.376 1.296-2.12a12.9 12.9 0 0 1-2.04-.983c.171-.126.338-.257.5-.39a14.2 14.2 0 0 0 12.13 0c.164.137.331.268.5.39-.652.387-1.336.716-2.044.985.374.743.808 1.452 1.296 2.119a19.8 19.8 0 0 0 6.076-3.078c.5-5.219-.838-9.745-3.51-13.752ZM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.956 2.42-2.157 2.42Zm7.974 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42Z" />
    </svg>
  );
}

export interface SocialField {
  key: string;
  label: string;
  placeholder: string;
  icon: LucideIcon | ((p: { className?: string }) => JSX.Element);
}

// Order here is the display order in both the editor and the hero icon row.
export const SOCIAL_FIELDS: SocialField[] = [
  { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/yourhandle', icon: Twitter },
  { key: 'twitch', label: 'Twitch', placeholder: 'https://twitch.tv/yourchannel', icon: Twitch },
  { key: 'discord', label: 'Discord', placeholder: 'https://discord.gg/yourinvite', icon: DiscordIcon },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@yourchannel', icon: Youtube },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourhandle', icon: Instagram },
];

const FIELD_BY_KEY = new Map(SOCIAL_FIELDS.map(f => [f.key, f]));

// Render a player's set socials as a compact row of icon links. Unknown keys
// (or empty values) are skipped; platforms render in SOCIAL_FIELDS order.
export function SocialIconLinks({
  socials,
  className = '',
}: {
  socials: Record<string, string> | null | undefined;
  className?: string;
}) {
  const entries = SOCIAL_FIELDS
    .map(f => ({ field: f, url: socials?.[f.key] }))
    .filter((e): e is { field: SocialField; url: string } => !!e.url && e.url.trim() !== '');

  if (entries.length === 0) return null;

  return (
    <div className={`arena-pp-socials ${className}`.trim()}>
      {entries.map(({ field, url }) => {
        const Icon = field.icon;
        return (
          <a
            key={field.key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="arena-pp-social"
            title={field.label}
            aria-label={field.label}
          >
            <Icon className="w-4 h-4" />
          </a>
        );
      })}
    </div>
  );
}

export { FIELD_BY_KEY };
