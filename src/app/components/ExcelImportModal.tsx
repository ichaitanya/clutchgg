import { useState } from 'react';
import { Upload, X, Download, AlertCircle, CheckCircle2, AlertTriangle, Loader } from 'lucide-react';
import {
  parseExcelFile,
  generateExcelTemplate,
  convertExcelTeamsToTournamentTeams,
  type ExcelImportResult,
} from '../utils/excelImportUtils';
import { TeamInTournament } from './TournamentCreation';

interface ExcelImportModalProps {
  onImport: (teams: TeamInTournament[]) => void;
  onCancel: () => void;
  existingTeamNames?: string[];
  remainingSlots?: number;
}

export function ExcelImportModal({ onImport, onCancel, existingTeamNames = [], remainingSlots }: ExcelImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ExcelImportResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'preview'>('upload');
  const [duplicateTeams, setDuplicateTeams] = useState<string[]>([]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validate file type
    if (
      !selectedFile.name.endsWith('.xlsx') &&
      !selectedFile.name.endsWith('.xls') &&
      !selectedFile.type.includes('spreadsheet')
    ) {
      setError('Please upload a valid Excel file (.xlsx or .xls)');
      return;
    }

    setError(null);
    setFile(selectedFile);
    setIsLoading(true);

    try {
      const result = await parseExcelFile(selectedFile);
      setImportResult(result);

      // Check for duplicates against existing tournament teams
      const dupes = result.teams
        .map(t => t.teamName)
        .filter(name => existingTeamNames.some(e => e.toLowerCase() === name.toLowerCase()));
      setDuplicateTeams(dupes);

      if (result.errors.length === 0 && result.teams.length > 0) {
        setStep('preview');
      } else if (result.errors.length > 0) {
        setError(result.errors.join('\n'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse Excel file');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = () => {
    if (!importResult || importResult.teams.length === 0) return;

    let uniqueTeams = importResult.teams.filter(
      t => !existingTeamNames.some(e => e.toLowerCase() === t.teamName.toLowerCase())
    );
    if (uniqueTeams.length === 0) return;
    if (remainingSlots !== undefined && uniqueTeams.length > remainingSlots) {
      uniqueTeams = uniqueTeams.slice(0, remainingSlots);
    }
    const teams = convertExcelTeamsToTournamentTeams(uniqueTeams);
    onImport(teams);
  };

  const downloadTemplate = () => {
    generateExcelTemplate();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#151821] flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div>
            <h3 className="text-white font-bold text-lg">Import Teams & Players</h3>
            <p className="text-gray-500 text-sm mt-1">
              {step === 'upload' ? 'Upload an Excel file to bulk import teams' : 'Review and confirm import'}
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {step === 'upload' ? (
            // Upload Step
            <>
              {/* File Upload Area */}
              <div>
                <label className="block cursor-pointer">
                  <div className="border-2 border-dashed border-[#2a2d3a] rounded-lg p-8 hover:border-[#ff4655]/50 transition-all bg-[#0d0f16]">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Upload className="w-8 h-8 text-gray-500" />
                      <div className="text-center">
                        <p className="text-white font-semibold">Click to upload or drag and drop</p>
                        <p className="text-gray-500 text-sm mt-1">Excel files (.xlsx, .xls)</p>
                      </div>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleFileSelect}
                      className="hidden"
                      disabled={isLoading}
                    />
                  </div>
                </label>
              </div>

              {/* Loading State */}
              {isLoading && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader className="w-5 h-5 text-[#ff4655] animate-spin" />
                  <span className="text-gray-400">Parsing Excel file...</span>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-red-400 whitespace-pre-line">{error}</div>
                  </div>
                </div>
              )}

              {/* Template Download */}
              <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-semibold text-sm">Need a template?</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Download our example template and fill in your teams and players
                    </p>
                  </div>
                  <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-2 bg-[#ff4655]/20 hover:bg-[#ff4655]/30 text-[#ff4655] px-4 py-2 rounded-lg transition-all text-sm font-semibold"
                  >
                    <Download className="w-4 h-4" />
                    Download Template
                  </button>
                </div>
              </div>

              {/* File Info */}
              {file && (
                <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-semibold text-sm">{file.name}</p>
                      <p className="text-gray-500 text-xs mt-1">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                    {!isLoading && importResult && (
                      <div className="text-right">
                        <p className="text-[#00d084] font-semibold text-sm">
                          {importResult.teams.length} teams
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Instructions */}
              <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4 space-y-3">
                <p className="text-white font-semibold text-sm">Excel Format Requirements:</p>
                <ul className="text-sm text-gray-400 space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-[#ff4655] font-bold">•</span>
                    <span><strong>Team Name</strong> - Required. Name of the team</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#ff4655] font-bold">•</span>
                    <span><strong>Player Name 1-7</strong> - Slots 1-5 are the main roster (at least 1 required); slots 6-7 are optional substitutes.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#ff4655] font-bold">•</span>
                    <span><strong>Riot ID 1-7</strong> - Optional. Full Riot ID as name#tag (e.g. jinggg#NA1). Used for API match lookups; not shown publicly.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#ff4655] font-bold">•</span>
                    <span><strong>Role 1-7</strong> - Optional. Use: igl, duelist, controller, sentinel, initiator</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#ff4655] font-bold">•</span>
                    <span><strong>Photos</strong> - Not set here. Add player photos in the tournament edit section (upload or paste a URL). Existing photos from other tournaments are filled in automatically.</span>
                  </li>
                </ul>
              </div>
            </>
          ) : (
            // Preview Step
            <>
              {importResult && (
                <>
                  {/* Summary */}
                  <div className="bg-[#0d0f16] border border-[#2a2d3a] rounded-lg p-4">
                    <div className="space-y-2">
                      <p className="text-white font-semibold">Import Summary</p>
                      <div className="grid grid-cols-2 gap-4 mt-3">
                        <div>
                          <p className="text-gray-500 text-xs">Teams to Import</p>
                          <p className="text-[#00d084] font-bold text-lg">{importResult.teams.length}</p>
                        </div>
                        <div>
                          <p className="text-gray-500 text-xs">Total Players</p>
                          <p className="text-[#00d084] font-bold text-lg">
                            {importResult.teams.reduce((sum, t) => sum + t.players.length, 0)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Warnings */}
                  {importResult.warnings.length > 0 && (
                    <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-yellow-400 font-semibold text-sm mb-2">Warnings:</p>
                          <ul className="text-sm text-yellow-400 space-y-1">
                            {importResult.warnings.map((warning, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span>•</span>
                                <span>{warning}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Slot limit warning banner */}
                  {(() => {
                    const uniqueCount = importResult.teams.length - duplicateTeams.length;
                    const overLimit = remainingSlots !== undefined && uniqueCount > remainingSlots;
                    if (!overLimit) return null;
                    const skipped = uniqueCount - remainingSlots!;
                    return (
                      <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                          <p className="text-yellow-400 text-sm font-semibold">
                            Only {remainingSlots} slot{remainingSlots !== 1 ? 's' : ''} remaining. {skipped} team{skipped !== 1 ? 's' : ''} will be skipped to stay within the tournament limit.
                          </p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Duplicate warning banner */}
                  {duplicateTeams.length > 0 && (
                    <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-red-400 font-semibold text-sm mb-1">
                            {duplicateTeams.length} team{duplicateTeams.length > 1 ? 's' : ''} already exist in the tournament and will be skipped:
                          </p>
                          <ul className="text-red-400 text-xs space-y-0.5">
                            {duplicateTeams.map((name, i) => (
                              <li key={i}>• {name}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Teams Preview */}
                  <div className="space-y-3">
                    <p className="text-white font-semibold">Teams Preview</p>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {importResult.teams.map((team, teamIndex) => {
                        const isDupe = duplicateTeams.some(d => d.toLowerCase() === team.teamName.toLowerCase());
                        return (
                          <div
                            key={teamIndex}
                            className={`border rounded-lg p-3 ${isDupe ? 'bg-red-500/5 border-red-500/40 opacity-60' : 'bg-[#0d0f16] border-[#2a2d3a]'}`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-white font-semibold text-sm">{team.teamName}</p>
                              {isDupe && (
                                <span className="text-xs text-red-400 font-semibold px-2 py-0.5 bg-red-500/10 rounded">Already exists — will be skipped</span>
                              )}
                            </div>
                            <div className="mt-2 space-y-1">
                              {team.players.map((player, playerIndex) => (
                                <div key={playerIndex} className="text-xs text-gray-400 flex items-center justify-between gap-2">
                                  <span className="truncate">
                                    {playerIndex + 1}. {player.name}
                                    {playerIndex >= 5 && <span className="text-gray-600 ml-1">(sub)</span>}
                                    {player.riotId && (
                                      <span className="text-gray-600 ml-2">({player.riotId})</span>
                                    )}
                                  </span>
                                  {player.role && (
                                    <span className="text-[#ff4655] uppercase tracking-wider font-semibold flex-shrink-0">
                                      {player.role}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Success / partial-import message */}
                  {importResult.teams.length > duplicateTeams.length ? (
                    <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                        <p className="text-green-400 text-sm font-semibold">
                          {(() => {
                            const uniqueCount = importResult.teams.length - duplicateTeams.length;
                            const importCount = remainingSlots !== undefined ? Math.min(uniqueCount, remainingSlots) : uniqueCount;
                            const totalSkipped = importResult.teams.length - importCount;
                            return `${importCount} team${importCount !== 1 ? 's' : ''} ready to import.${totalSkipped > 0 ? ` (${totalSkipped} skipped)` : ''}`;
                          })()}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-500" />
                        <p className="text-red-400 text-sm font-semibold">
                          All teams in this file already exist in the tournament. Nothing to import.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-[#151821] flex gap-3 px-6 py-4 border-t border-[#2a2d3a]">
          {step === 'upload' ? (
            <>
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setStep('upload');
                  setFile(null);
                  setImportResult(null);
                  setError(null);
                }}
                className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={!importResult || importResult.teams.length === 0 || importResult.teams.length === duplicateTeams.length || (remainingSlots !== undefined && remainingSlots <= 0)}
                className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {(() => {
                  if (!importResult) return 'Import Teams';
                  const uniqueCount = importResult.teams.length - duplicateTeams.length;
                  const importCount = remainingSlots !== undefined ? Math.min(uniqueCount, remainingSlots) : uniqueCount;
                  return importCount > 0
                    ? `Import ${importCount} Team${importCount !== 1 ? 's' : ''}`
                    : 'Import Teams';
                })()}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
