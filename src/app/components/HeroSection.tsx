import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageWithFallback } from './figma/ImageWithFallback';

interface HeroSectionProps {
  heroLink?: string;
  heroVideo?: string;
}

// Extract YouTube video ID from any youtube.com / youtu.be URL.
function getYouTubeId(url: string): string | null {
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// Convert any Google Drive share/view URL to a direct streamable URL.
function toGDriveDirectUrl(url: string): string {
  const m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url;
}

// Load the YouTube IFrame API once and resolve when ready.
let ytApiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    const w = window as unknown as { YT?: { Player: unknown }; onYouTubeIframeAPIReady?: () => void };
    if (w.YT && w.YT.Player) { resolve(); return; }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

function YouTubeBackground({ videoId }: { videoId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const loopTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !containerRef.current) return;
      const YT = (window as any).YT;
      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          showinfo: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          playsinline: 1,
        },
        events: {
          onReady: (e: any) => {
            e.target.mute();
            e.target.setPlaybackQuality('hd1080');
            e.target.playVideo();
          },
          onStateChange: (e: any) => {
            const player = e.target;
            if (e.data === YT.PlayerState.PLAYING) {
              player.setPlaybackQuality('hd1080');
              // Loop well before the end (1.5s) and seek WITHOUT allowSeekAhead
              // (false) so playback jumps to already-buffered frames — no
              // re-buffer spinner, and YouTube never reaches the end-screen
              // state that flashes the control overlay.
              if (loopTimerRef.current) window.clearInterval(loopTimerRef.current);
              loopTimerRef.current = window.setInterval(() => {
                try {
                  const dur = player.getDuration?.() ?? 0;
                  const cur = player.getCurrentTime?.() ?? 0;
                  if (dur > 0 && cur >= dur - 1.5) {
                    player.seekTo(0, false);
                  }
                } catch { /* noop */ }
              }, 200);
            }
            // If buffering/paused for any reason, force it back to playing
            // so the pause overlay can't linger.
            if (e.data === YT.PlayerState.PAUSED) {
              player.playVideo();
            }
            if (e.data === YT.PlayerState.ENDED) {
              player.seekTo(0, false);
              player.playVideo();
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      if (loopTimerRef.current) window.clearInterval(loopTimerRef.current);
      try { playerRef.current?.destroy?.(); } catch { /* noop */ }
    };
  }, [videoId]);

  return (
    <div className="arena-hero__yt">
      {/* YT API replaces this div with the player iframe */}
      <div ref={containerRef} className="arena-hero__yt-player" />
      {/* Transparent shield blocks all clicks/hover from reaching the player */}
      <div className="arena-hero__yt-shield" />
    </div>
  );
}

export function HeroSection({ heroLink, heroVideo }: HeroSectionProps) {
  const navigate = useNavigate();

  const ytId = heroVideo ? getYouTubeId(heroVideo) : null;
  const isYouTube = !!ytId;
  const isGDrive = !isYouTube && !!heroVideo && heroVideo.includes('drive.google.com');
  // Any non-YouTube URL is treated as a direct video file (uploaded clip,
  // CDN link, or a Google Drive link converted to its direct-stream form).
  const videoSrc = isYouTube
    ? null
    : isGDrive && heroVideo
      ? toGDriveDirectUrl(heroVideo)
      : heroVideo || null;

  return (
    <section className={`arena-hero${isYouTube || videoSrc ? ' arena-hero--video' : ''}`}>
      {isYouTube && ytId ? (
        <YouTubeBackground videoId={ytId} />
      ) : videoSrc ? (
        <video
          key={videoSrc}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src={videoSrc} type="video/mp4" />
          <source src={videoSrc} type="video/webm" />
        </video>
      ) : (
        <ImageWithFallback
          src="https://t4.ftcdn.net/jpg/04/21/83/03/360_F_421830310_DsAMQEpOnIpPS5OXnx5HtYymT4kJpzjt.jpg"
          alt="Clutch.gg Invitational 2025"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'grayscale(100%) brightness(0.55)' }}
        />
      )}
      <div className="arena-hero__overlay-wash" />
      <div className="arena-hero__overlay-fade" />

      <div className="arena-hero__content">
        <div style={{ maxWidth: '620px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h1 className="arena-display">
            THE ARENA IS SET.<br />
            BATTLE FOR THE<br />
            <span className="accent">CROWN.</span>
          </h1>

          <p className="arena-body" style={{ maxWidth: '420px', fontSize: '0.9375rem' }}>
            Experience the pinnacle of competitive excellence. Follow the world's elite
            rosters as they battle for the seasonal championship.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => { if (heroLink) window.open(heroLink, '_blank'); }}
              disabled={!heroLink}
              className={`arena-btn arena-btn--primary${!heroLink ? ' opacity-60 cursor-not-allowed' : ''}`}
              style={{ minWidth: '180px' }}
            >
              Watch Broadcast
            </button>
            <button
              onClick={() => navigate('/matches')}
              className="arena-btn arena-btn--outline"
              style={{ minWidth: '160px' }}
            >
              View Bracket
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
