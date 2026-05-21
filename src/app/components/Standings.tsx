interface Team {
  rank: number;
  name: string;
  wins: number;
  losses: number;
  winRate: string;
}

export function Standings() {
  const teams: Team[] = [
    
  ];

  return (
    <div className="bg-[#1e2130] border border-[#2a2d3a] rounded-lg overflow-hidden">
      <div className="bg-[#151821] px-4 py-3 border-b border-[#2a2d3a]">
        <h3 className="text-white font-semibold">Group Standings</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-[#151821]">
            <tr className="text-gray-400 text-xs uppercase">
              <th className="px-4 py-3 text-left">Rank</th>
              <th className="px-4 py-3 text-left">Team</th>
              <th className="px-4 py-3 text-center">W</th>
              <th className="px-4 py-3 text-center">L</th>
              <th className="px-4 py-3 text-center">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((team, index) => (
              <tr
                key={team.rank}
                className="border-t border-[#2a2d3a] hover:bg-[#151821] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3">
                  <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                    team.rank <= 3 ? 'bg-[#ff4655] text-white' : 'bg-[#2a2d3a] text-gray-400'
                  }`}>
                    {team.rank}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded bg-gradient-to-br ${
                      index % 3 === 0 ? 'from-blue-500 to-blue-700' :
                      index % 3 === 1 ? 'from-red-500 to-red-700' :
                      'from-purple-500 to-purple-700'
                    } flex items-center justify-center text-white text-xs font-bold`}>
                      {team.name.substring(0, 2)}
                    </div>
                    <span className="text-white text-sm">{team.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-green-400 text-sm font-semibold">{team.wins}</td>
                <td className="px-4 py-3 text-center text-red-400 text-sm font-semibold">{team.losses}</td>
                <td className="px-4 py-3 text-center text-gray-300 text-sm">{team.winRate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
