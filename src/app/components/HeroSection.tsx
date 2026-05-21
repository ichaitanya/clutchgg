import { ImageWithFallback } from './figma/ImageWithFallback';

export function HeroSection() {
  return (
    <div className="relative h-[400px] overflow-hidden rounded-lg">
      <ImageWithFallback
        src="https://t4.ftcdn.net/jpg/04/21/83/03/360_F_421830310_DsAMQEpOnIpPS5OXnx5HtYymT4kJpzjt.jpg"
        alt="VCT Masters"
        className="w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0d0f16] via-[#0d0f16]/70 to-transparent" />

      <div className="absolute bottom-0 left-0 right-0 p-8">
        <div className="max-w-3xl">
          <div className="inline-block bg-[#ff4655] text-white text-xs font-bold px-3 py-1 rounded mb-4">
            LIVE NOW
          </div>
          <h1 className="text-white text-4xl md:text-5xl font-bold mb-4">
            Next Level Community Cup 2026
          </h1>
          <p className="text-gray-300 text-lg mb-6">
            VALORANT teams compete for glory and a spot in Champions
          </p>
          <button className="bg-[#ff4655] hover:bg-[#ff3344] text-white px-6 py-3 rounded-lg font-semibold transition-colors">
            Watch Live
          </button>
        </div>
      </div>
    </div>
  );
}
