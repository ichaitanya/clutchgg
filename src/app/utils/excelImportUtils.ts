import * as XLSX from 'xlsx';
import { TeamInTournament, TournamentPlayer, PlayerRole } from '../components/TournamentCreation';

export interface ExcelTeamData {
  teamName: string;
  players: Array<{
    name: string;
    role?: PlayerRole;
    photo?: string; // Not expected from Excel, but can be added manually later
  }>;
}

export interface ExcelImportResult {
  teams: ExcelTeamData[];
  errors: string[];
  warnings: string[];
}

const VALID_ROLES: PlayerRole[] = ['igl', 'duelist', 'controller', 'sentinel', 'initiator'];

/**
 * Parse Excel file and extract teams and players
 * Expected columns: Team Name, Player Name 1-5 (mandatory), Photo (optional), Role 1-5 (optional)
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
  let playerNameCols: string[] = [];
  let roleCols: { [key: number]: string } = {};
  let photoCol = '';

  // Find team name column
  teamNameCol = headers.find(h => h.toLowerCase().includes('team')) || '';
  if (!teamNameCol) {
    errors.push('Could not find "Team Name" column');
    return { teams, errors, warnings };
  }

  // Find player name columns (Player Name 1, Player Name 2, etc.)
  playerNameCols = headers
    .filter(h => h.toLowerCase().includes('player') && h.toLowerCase().includes('name'))
    .sort();

  if (playerNameCols.length === 0) {
    errors.push('Could not find any "Player Name" columns');
    return { teams, errors, warnings };
  }

  // Find photo column
  photoCol = headers.find(h => h.toLowerCase().includes('photo')) || '';

  // Find role columns
  headers.forEach((h) => {
    const match = h.toLowerCase().match(/role\s*(\d+)/);
    if (match) {
      const playerIndex = parseInt(match[1]) - 1;
      roleCols[playerIndex] = h;
    }
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

    // Extract players (first 5 are mandatory)
    playerNameCols.forEach((col, index) => {
      const playerName = row[col]?.toString().trim();

      if (playerName) {
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

        players.push({ name: playerName, role });
        if (index < 5) mandatoryPlayerCount++;
      }
    });

    // Check mandatory player count (1-5)
    if (mandatoryPlayerCount === 0) {
      warnings.push(`Row ${lineNumber}: Team "${teamName}" has no players. Skipped.`);
      return;
    }

    if (mandatoryPlayerCount < 1) {
      errors.push(
        `Row ${lineNumber}: Team "${teamName}" has ${mandatoryPlayerCount} mandatory players. Need at least 1.`
      );
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
  const templateData = [
    {
      'Team Name': 'Example Team 1',
      'Player Name 1': 'jinggg',
      'Player Name 2': 'sscary',
      'Player Name 3': 'ForSaken',
      'Player Name 4': 'papabrainchip',
      'Player Name 5': 'Ghost',
      'Role 1': 'igl',
      'Role 2': 'duelist',
      'Role 3': 'controller',
      'Role 4': 'sentinel',
      'Role 5': 'initiator',
      'Photo': '', // Optional photo upload
    },
    {
      'Team Name': 'Example Team 2',
      'Player Name 1': 'FNS',
      'Player Name 2': 'Marved',
      'Player Name 3': 'Crashies',
      'Player Name 4': 'Sick',
      'Player Name 5': 'Derke',
      'Role 1': 'igl',
      'Role 2': 'controller',
      'Role 3': 'duelist',
      'Role 4': 'sentinel',
      'Role 5': 'initiator',
      'Photo': '',
    },
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateData);

  // Set column widths
  worksheet['!cols'] = [
    { wch: 20 }, // Team Name
    { wch: 20 }, // Player Name 1
    { wch: 20 }, // Player Name 2
    { wch: 20 }, // Player Name 3
    { wch: 20 }, // Player Name 4
    { wch: 20 }, // Player Name 5
    { wch: 15 }, // Role 1
    { wch: 15 }, // Role 2
    { wch: 15 }, // Role 3
    { wch: 15 }, // Role 4
    { wch: 15 }, // Role 5
    { wch: 20 }, // Photo
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Teams');

  // Add instructions sheet
  const instructions = [
    ['Tournament Teams & Players Import Template'],
    [],
    ['Instructions:'],
    ['1. Team Name (Required): Enter the name of the team'],
    ['2. Player Name 1-5 (Mandatory): Enter player names for first 5 slots (minimum 1 required)'],
    ['3. Role (Optional): Use one of these roles: igl, duelist, controller, sentinel, initiator'],
    ['4. Photo (Optional): Photo upload is not supported via Excel. Photos must be added manually.'],
    [],
    ['Example Row Structure:'],
    ['Team Name | Player Name 1 | Player Name 2 | Player Name 3 | Player Name 4 | Player Name 5 | Role 1 | Role 2 | Role 3 | Role 4 | Role 5 | Photo'],
    ['Paper Rex | jinggg | sscary | ForSaken | papabrainchip | GHost | igl | duelist | controller | sentinel | initiator | '],
  ];

  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
  instructionsSheet['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];

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
      role: player.role,
      photo: player.photo,
    })),
  }));
}
