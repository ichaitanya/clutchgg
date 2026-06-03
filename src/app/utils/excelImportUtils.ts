import * as XLSX from 'xlsx';
import { TeamInTournament, TournamentPlayer, PlayerRole } from '../components/TournamentCreation';

export interface ExcelTeamData {
  teamName: string;
  players: Array<{
    name: string;
    riotId?: string; // "name#tag" — optional, used for API match lookups
    role?: PlayerRole;
    // Photos are NOT imported via Excel — they're added in the tournament edit
    // section (upload or paste URL), and auto-prefilled from other tournaments.
  }>;
}

export interface ExcelImportResult {
  teams: ExcelTeamData[];
  errors: string[];
  warnings: string[];
}

const VALID_ROLES: PlayerRole[] = ['igl', 'duelist', 'controller', 'sentinel', 'initiator'];

/**
 * Convert common Google Drive share links into a direct-image URL so the photo
 * actually renders in an <img>. Other URLs (storage links, direct image URLs)
 * are returned unchanged.
 *   https://drive.google.com/file/d/FILEID/view?... → direct view URL
 *   https://drive.google.com/open?id=FILEID         → direct view URL
 */
export function normalizePhotoUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  const driveFile = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveFile) return `https://drive.google.com/uc?export=view&id=${driveFile[1]}`;
  const driveOpen = url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (driveOpen) return `https://drive.google.com/uc?export=view&id=${driveOpen[1]}`;
  return url;
}

/**
 * Parse Excel file and extract teams and players
 * Expected columns: Team Name, Player Name 1-7 (1-5 mandatory, 6-7 optional),
 * Riot ID 1-7 (optional), Role 1-7 (optional), Photo 1-7 (optional URL).
 */
export function parseExcelFile(file: File): Promise<ExcelImportResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        const result = extractTeamsFromData(jsonData);
        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : String(error)}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract teams and players from parsed JSON data
 */
function extractTeamsFromData(jsonData: any[]): ExcelImportResult {
  const teams: ExcelTeamData[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!jsonData || jsonData.length === 0) {
    errors.push('Excel file is empty or has no data');
    return { teams, errors, warnings };
  }

  // Get actual column headers from first row
  const firstRow = jsonData[0];
  const headers = Object.keys(firstRow).map(h => h.trim());

  // Normalize headers and identify columns
  let teamNameCol = '';
  let roleCols: { [key: number]: string } = {};
  let riotIdCols: { [key: number]: string } = {};

  // Find team name column
  teamNameCol = headers.find(h => h.toLowerCase().includes('team')) || '';
  if (!teamNameCol) {
    errors.push('Could not find "Team Name" column');
    return { teams, errors, warnings };
  }

  // Find player name columns keyed by index (Player Name 1, Player Name 2, …).
  const playerNameCols: { [key: number]: string } = {};
  headers.forEach((h) => {
    const match = h.toLowerCase().match(/player\s*name\s*(\d+)/);
    if (match) playerNameCols[parseInt(match[1]) - 1] = h;
  });

  if (Object.keys(playerNameCols).length === 0) {
    errors.push('Could not find any "Player Name" columns');
    return { teams, errors, warnings };
  }
  // Highest player index present, so we iterate every slot (5 mandatory + extras).
  const maxPlayerIndex = Math.max(...Object.keys(playerNameCols).map(Number));

  // Find role columns
  headers.forEach((h) => {
    const match = h.toLowerCase().match(/role\s*(\d+)/);
    if (match) roleCols[parseInt(match[1]) - 1] = h;
  });

  // Find Riot ID columns (Riot ID 1, Riot ID 2, ...)
  headers.forEach((h) => {
    const match = h.toLowerCase().match(/riot\s*id\s*(\d+)/);
    if (match) riotIdCols[parseInt(match[1]) - 1] = h;
  });

  // Process each row
  jsonData.forEach((row, rowIndex) => {
    const lineNumber = rowIndex + 2; // +1 for header, +1 for 1-based indexing
    const teamName = row[teamNameCol]?.toString().trim();

    if (!teamName) {
      warnings.push(`Row ${lineNumber}: Skipped empty team name`);
      return;
    }

    const players: ExcelTeamData['players'] = [];
    let mandatoryPlayerCount = 0;

    // Extract players across every slot (slots 1-5 are the mandatory roster,
    // 6-7 are optional substitutes).
    for (let index = 0; index <= maxPlayerIndex; index++) {
      const col = playerNameCols[index];
      if (!col) continue;
      const playerName = row[col]?.toString().trim();
      if (!playerName) continue;

      const roleCol = roleCols[index];
      let role = undefined as PlayerRole | undefined;

      if (roleCol && row[roleCol]) {
        const roleValue = row[roleCol]?.toString().toLowerCase().trim();
        if (VALID_ROLES.includes(roleValue as PlayerRole)) {
          role = roleValue as PlayerRole;
        } else if (roleValue) {
          warnings.push(
            `Row ${lineNumber}: Invalid role "${roleValue}" for "${playerName}". Valid roles: ${VALID_ROLES.join(', ')}`
          );
        }
      }

      const riotIdCol = riotIdCols[index];
      const riotId = riotIdCol ? row[riotIdCol]?.toString().trim() || undefined : undefined;

      players.push({ name: playerName, role, riotId });
      if (index < 5) mandatoryPlayerCount++;
    }

    // Need at least one of the mandatory (1-5) players filled in.
    if (mandatoryPlayerCount === 0) {
      warnings.push(`Row ${lineNumber}: Team "${teamName}" has no players. Skipped.`);
      return;
    }

    teams.push({
      teamName,
      players,
    });
  });

  return { teams, errors, warnings };
}

/**
 * Generate Excel template for download
 */
export function generateExcelTemplate(): void {
  // Build a row with 7 player slots: 1-5 mandatory roster, 6-7 optional subs.
  // Each player has Name, Riot ID, Role and a Photo URL column.
  const PLAYER_COUNT = 7;
  const exampleA = [
    { name: 'jinggg', riot: 'jinggg#NA1', role: 'igl' },
    { name: 'sscary', riot: 'sscary#EU1', role: 'duelist' },
    { name: 'ForSaken', riot: 'ForSaken#AP1', role: 'controller' },
    { name: 'papabrainchip', riot: 'papabrainchip#KR1', role: 'sentinel' },
    { name: 'Ghost', riot: 'Ghost#NA2', role: 'initiator' },
    { name: 'SubOne', riot: '', role: '' },   // optional
    { name: '', riot: '', role: '' },          // optional
  ];
  const exampleB = [
    { name: 'FNS', riot: '', role: 'igl' },
    { name: 'Marved', riot: '', role: 'controller' },
    { name: 'Crashies', riot: '', role: 'duelist' },
    { name: 'Sick', riot: '', role: 'sentinel' },
    { name: 'Derke', riot: '', role: 'initiator' },
    { name: '', riot: '', role: '' },
    { name: '', riot: '', role: '' },
  ];

  const buildRow = (teamName: string, players: typeof exampleA) => {
    const row: Record<string, string> = { 'Team Name': teamName };
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const p = players[i] ?? { name: '', riot: '', role: '' };
      const n = i + 1;
      row[`Player Name ${n}`] = p.name;
      row[`Riot ID ${n}`] = p.riot;
      row[`Role ${n}`] = p.role;
    }
    return row;
  };

  const templateData = [
    buildRow('Example Team 1', exampleA),
    buildRow('Example Team 2', exampleB),
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateData);

  // Set column widths: Team Name, then Name/Riot/Role per player.
  const cols = [{ wch: 20 }];
  for (let i = 0; i < PLAYER_COUNT; i++) {
    cols.push({ wch: 18 }, { wch: 20 }, { wch: 14 });
  }
  worksheet['!cols'] = cols;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Teams');

  // Add instructions sheet
  const instructions = [
    ['Tournament Teams & Players Import Template'],
    [],
    ['Instructions:'],
    ['1. Team Name (Required): Enter the name of the team'],
    ['2. Player Name 1-7: Slots 1-5 are the main roster (at least 1 required).'],
    ['   Slots 6 and 7 are OPTIONAL substitutes — leave blank if not needed.'],
    ['3. Riot ID 1-7 (Optional): Enter the player\'s full Riot ID as name#tag (e.g. jinggg#NA1).'],
    ['   Used to pull match history from the API. Can be filled later if a player changes their name.'],
    ['4. Role 1-7 (Optional): Use one of these roles: igl, duelist, controller, sentinel, initiator'],
    [],
    ['Player photos are NOT set here. Add them in the tournament edit section'],
    ['(upload a file or paste an image URL). If the player already has a photo from'],
    ['another tournament, it is shown automatically and you can keep or replace it.'],
    [],
    ['Note: Only the Player Name is shown on the team page and scoreboard. The Riot ID is stored'],
    ['for API lookups only and is not displayed publicly.'],
    [],
    ['Column order per player: Player Name N | Riot ID N | Role N  (N = 1..7)'],
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
  instructionsSheet['!cols'] = [{ wch: 72 }, { wch: 20 }];

  XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

  XLSX.writeFile(workbook, 'tournament_template.xlsx');
}

/**
 * Convert parsed Excel data to TeamInTournament objects
 */
export function convertExcelTeamsToTournamentTeams(excelTeams: ExcelTeamData[]): TeamInTournament[] {
  return excelTeams.map((team) => ({
    id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: team.teamName,
    logo: undefined,
    players: team.players.map((player) => ({
      id: `player-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: player.name,
      riotId: player.riotId,
      role: player.role,
    })),
  }));
}
