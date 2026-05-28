# Excel Import Guide for Tournament Teams & Players

## Overview
The Excel Import feature allows tournament organizers to bulk import multiple teams and players in a single operation using an Excel spreadsheet. This streamlines the process of setting up tournaments with many teams.

## How to Use

### Step 1: Download the Template
1. Navigate to the "Create Tournament" section
2. After entering tournament details, you'll see the teams list
3. Click the **"Import from Excel"** button (orange button with upload icon)
4. In the modal dialog, click **"Download Template"** to get the example Excel file

### Step 2: Fill in Your Data
Edit the downloaded Excel file with your teams and players:

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| Team Name | Yes | Name of the team | Paper Rex |
| Player Name 1 | Yes | First mandatory player | jinggg |
| Player Name 2 | Yes | Second mandatory player | sscary |
| Player Name 3 | Yes | Third mandatory player | ForSaken |
| Player Name 4 | Yes | Fourth mandatory player | papabrainchip |
| Player Name 5 | Yes | Fifth mandatory player | GHost |
| Role 1 | No | Role for Player 1 | igl |
| Role 2 | No | Role for Player 2 | duelist |
| Role 3 | No | Role for Player 3 | controller |
| Role 4 | No | Role for Player 4 | sentinel |
| Role 5 | No | Role for Player 5 | initiator |
| Photo | No | Player photos (add manually after import) | - |

### Step 3: Upload & Preview
1. Select your filled Excel file using the upload area
2. The system will parse and validate the file
3. Review the preview to ensure all data is correct
4. Click **"Import Teams"** to add all teams and players to your tournament

## Valid Player Roles
When filling in the Role columns, use only these values:
- `igl` - In-Game Leader
- `duelist` - Duelist
- `controller` - Controller
- `sentinel` - Sentinel
- `initiator` - Initiator

## Requirements & Validation

### Team Name
- **Required** - Must be filled for each team
- Teams with empty names will be skipped

### Player Names (1-5)
- **Required** - At least 1 player must be provided per team
- Maximum of 5 mandatory players per team
- Teams with no players will be skipped

### Roles (1-5)
- **Optional** - Can be left empty
- Must be one of the valid roles listed above
- Invalid roles will generate a warning but won't block import

### Photos
- **Not supported** via Excel import
- Photos must be added manually after import through the player editing interface
- Column can be left empty

## Error Handling

### Errors (Blocks Import)
These issues will prevent import and must be fixed:
- Empty Excel file
- No "Team Name" column found
- No "Player Name" columns found

### Warnings (Shows but Doesn't Block)
These issues will be flagged but won't prevent import:
- Teams with no players (team will be skipped)
- Invalid player roles (role will be ignored)
- Empty team names (row will be skipped)

## Example Data

### Example Row
```
Team Name: Paper Rex
Player Name 1: jinggg
Player Name 2: sscary
Player Name 3: ForSaken
Player Name 4: papabrainchip
Player Name 5: GHost
Role 1: igl
Role 2: duelist
Role 3: controller
Role 4: sentinel
Role 5: initiator
```

## Tips & Best Practices

1. **Use the template** - Always start with the downloaded template to ensure correct column structure
2. **One team per row** - Enter each team on a separate row
3. **Player count** - You can have 1-5 players per team
4. **Roles are optional** - If you don't know roles yet, leave them blank and add later
5. **Review preview** - Always review the import preview before confirming
6. **Add photos manually** - Use the player editing UI after import to add photos
7. **Backup** - Keep a copy of your Excel file as backup

## Troubleshooting

### File won't upload
- Ensure file is .xlsx or .xls format
- File size should be reasonable (not corrupted)
- Try opening in Excel and re-saving

### Data looks wrong in preview
- Check column headers match exactly
- Verify team and player names
- Look for extra spaces or special characters

### Teams are missing after import
- Review the warnings in the import dialog
- Teams with no players are skipped
- Check if any rows had empty team names

### Roles not showing up
- Verify role names are exactly: igl, duelist, controller, sentinel, initiator
- Check for extra spaces before/after role names
- Roles are case-insensitive (igl, IGL, Igl all work)

## File Format Details

### Required Columns
- Team Name
- Player Name 1, Player Name 2, Player Name 3, Player Name 4, Player Name 5

### Optional Columns
- Role 1, Role 2, Role 3, Role 4, Role 5
- Photo

### Sheet Requirements
- Only the first sheet in the workbook will be processed
- Column headers must be in the first row
- Data starts from row 2

## After Import

Once teams are imported:
1. Review all teams in the tournament list
2. Click "Edit" on any team to modify details
3. Click team name to view/edit players
4. Add player photos through the edit player dialog
5. Continue with bracket creation when ready

---

**Note:** Photos cannot be imported from Excel. If you need to add photos, you can:
1. Edit each player individually after import
2. Upload photo files from your computer
3. Photos will be stored as base64 in the tournament data

For any issues or feature requests, please report them in the application.
