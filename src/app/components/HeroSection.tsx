import { useNavigate } from 'react-router-dom';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface HeroSectionProps {
  heroLink?: string;
}

export function HeroSection({ heroLink }: HeroSectionProps) {
  const navigate = useNavigate();

  return (
    <section className="relative h-[560px] md:h-[630px] w-full overflow-hidden">
      <ImageWithFallback
        src="https://t4.ftcdn.net/jpg/04/21/83/03/360_F_421830310_DsAMQEpOnIpPS5OXnx5HtYymT4kJpzjt.jpg"
        alt="Next Level Community Cup 2026"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Darkening overlays to match the figma washed-out hero */}
      <div className="absolute inset-0 bg-[#585858]/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e0e] via-[#0e0e0e]/60 to-transparent" />

      <div className="relative h-full max-w-[1436px] mx-auto flex flex-col justify-end px-6 pb-16">
        <div className="max-w-2xl flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="bg-[#ff4655] text-white text-[10px] font-inter px-3 py-1">
              Live Now
            </span>
            <span className="text-[#e5e2e1] text-[11px] font-inter">
              Next Level Community Cup 2026
            </span>
          </div>

          <h1 className="font-chivo font-black text-white leading-none text-5xl md:text-[72px]">
            The Arena is Set. Battle for the{' '}
            <span className="text-[#ff4655]">Crown.</span>
          </h1>

          <p className="text-[#eae8e7] text-base md:text-lg font-inter max-w-2xl">
            VALORANT teams compete for glory and a spot in Champions. Follow the
            world's elite rosters as they battle for the seasonal championship.
          </p>

          <div className="flex flex-wrap gap-3 pt-4">
            <button
              onClick={() => {
                if (heroLink) {
                  window.open(heroLink, '_blank');
                }
              }}
              disabled={!heroLink}
              className={`font-inter text-xs text-white px-10 py-4 transition-colors ${
                heroLink
                  ? 'bg-[#ff4655] hover:bg-[#ff3344] cursor-pointer'
                  : 'bg-gray-600 cursor-not-allowed opacity-75'
              }`}
            >
              Watch Broadcast
            </button>
            <button
              onClick={() => navigate('/matches')}
              className="font-inter text-xs text-white px-10 py-4 border-2 border-white hover:bg-white/10 transition-colors"
            >
              View Bracket
            </button>
          </div>
        </div>
      </div>

      {/* Decorative slide indicators (top-right vertical bars) */}
      <div className="absolute top-1/2 right-6 -translate-y-1/2 hidden md:flex flex-col gap-3">
        <div className="w-1 h-8 bg-[#ff4655]" />
        <div className="w-1 h-8 bg-white/70" />
        <div className="w-1 h-8 bg-white/70" />
      </div>
    </section>
  );
}
