# Tab Shepherd

Automatically route tabs to named windows based on URL patterns.

## Features

- **Window Groups**: Define named groups with regex URL patterns
- **Auto-routing**: Tabs automatically move to matching windows
- **Auto-focus**: Target window gains focus when tab moves
- **Priority ordering**: Drag to reorder; first match wins
- **Catch-all window**: Optional default for unmatched URLs
- **Sort all tabs**: Re-organize existing tabs with one click
- **Import/Export**: Backup and share configurations

## Installation

### 1. Generate Icons

1. Open `generate-icons.html` in Chrome
2. Click "Download All Icons"
3. Move the 4 PNG files to the `icons/` folder

### 2. Load Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `tab-shepherd` folder

## Usage

### Configure Groups (Options Page)

1. Click the extension icon → "Options" (or right-click → Options)
2. Click "+ Add Group"
3. Enter a name (e.g., "work", "github")
4. Enter URL patterns (one per line, regex supported):
   ```
   localhost:3004
   \?window=artemis
   github\.com/myorg
   ```
5. Drag groups to set priority order

### Assign Windows

1. Open a window you want to assign
2. Click the Tab Shepherd extension icon
3. Select a group from the dropdown

### Pattern Examples

| Pattern | Matches |
|---------|---------|
| `localhost:3004` | http://localhost:3004/* |
| `localhost:300[4-6]` | Ports 3004, 3005, 3006 |
| `github\.com` | Any GitHub URL |
| `\?project=myapp` | URLs with ?project=myapp |
| `docs\.(google\|notion)` | Google Docs or Notion |

### macOS Desktop Switching

For the target window to switch macOS desktops when focused:

1. Open **System Preferences** → **Mission Control**
2. Enable: "When switching to an application, switch to a Space with open windows for the application"

## How It Works

1. **On tab create/navigate**: Extension checks URL against patterns
2. **Pattern match**: Finds highest-priority matching group
3. **Window lookup**: Finds window assigned to that group
4. **Move & focus**: Moves tab to target window and focuses it
5. **Auto-create**: If no window exists for group, creates one

### Window Binding Persistence

Window IDs change when Chrome restarts. On startup, Tab Shepherd:
1. Scans all windows for tabs matching each group's patterns
2. Auto-binds windows that contain matching tabs
3. Groups without matching windows will get a new window on first matching tab

## Configuration File Format

```json
{
  "enabled": true,
  "groups": [
    {
      "name": "artemis-dev",
      "patterns": ["localhost:300[4-6]", "\\?window=artemis"],
      "priority": 0
    },
    {
      "name": "github",
      "patterns": ["github\\.com/anthropics"],
      "priority": 1
    }
  ],
  "catchAllGroupName": null
}
```

## Troubleshooting

**Tabs not moving?**
- Check that Tab Shepherd is enabled (toggle in popup/options)
- Verify the window is assigned to the correct group
- Check pattern syntax in Options → edit group

**Window not focusing?**
- Check macOS Mission Control settings (see above)
- Try clicking "Sort All Tabs" to force re-organization

**Groups lost after restart?**
- Groups are preserved, but window bindings need re-discovery
- Click "Re-scan Windows" in Options, or just open a matching tab

## License

MIT
