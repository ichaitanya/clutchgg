import { Trophy, Tv, Calendar, Users, BarChart3, Menu } from 'lucide-react';

export function Header() {
  return (
    <header className="bg-[#1a1d29] border-b border-[#2a2d3a] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">

            <div className="flex items-center gap-2">
               
              <Trophy className="w-8 h-8 text-[#ff4655]" />
              <a href="/" className="text-white text-xl font-bold">Clutch.gg</a>
            </div>

            <nav className="hidden md:flex items-center gap-6">
              <a href="/matches" className="flex items-center gap-2 text-gray-400 hover:text-white px-3 py-2 rounded-md hover:bg-white/5 transition-colors">
                <Calendar className="w-4 h-4" />
                <span className="text-sm">Matches</span>
              </a>
              <a href="#" className="flex items-center gap-2 text-gray-400 hover:text-white px-3 py-2 rounded-md hover:bg-white/5 transition-colors">
                <Users className="w-4 h-4" />
                <span className="text-sm">Teams</span>
              </a>
              <a href="#" className="flex items-center gap-2 text-gray-400 hover:text-white px-3 py-2 rounded-md hover:bg-white/5 transition-colors">
                <BarChart3 className="w-4 h-4" />
                <span className="text-sm">Stats</span>
              </a>
            </nav>
          </div>

          <button className="md:hidden text-gray-400 hover:text-white">
            <Menu className="w-6 h-6" />
          </button>
        </div>
      </div>
    </header>
  );
}
