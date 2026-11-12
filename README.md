# Panel Propio

**English** · [Español](README.es.md)

Turn an old iPad (or any tablet or phone on your Wi‑Fi) into a **Stream Deck–style control panel for your Windows PC**. Tap a button on the tablet and your PC runs a keyboard shortcut, opens a website, launches an app or game, or controls Spotify.

- Runs **entirely on your local network**: no account, no cloud, no internet needed.
- Built so it still works on an **iPad 2 with Safari on iOS 9**, as well as any modern browser.
- Comes with a **visual editor** on the PC to design pages, folders, buttons, icons and themes.
- The server is plain Python (standard library only). Node.js is only needed for development.

> The UI is in Spanish. This README is in English; [a Spanish version is here](README.es.md).

---

## Contents

- [What it can do](#what-it-can-do)
- [Requirements and limitations](#requirements-and-limitations)
- [Install](#install)
- [Connect your iPad](#connect-your-ipad)
- [Windows Firewall](#windows-firewall)
- [Using the editor](#using-the-editor)
- [Button actions](#button-actions)
- [Spotify widget (optional)](#spotify-widget-optional)
- [Moving to another PC / backups](#moving-to-another-pc--backups)
- [Connection status on the iPad](#connection-status-on-the-ipad)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Development](#development)
- [Credits](#credits)

---

## What it can do

- **Pages** you swipe between, each with a 6‑column grid of "boxes" (or free positioning).
- **Buttons** in any size (1×1 up to 6×4 boxes), with a name, colour, photo, built‑in symbol or a real app logo.
- **Folders** that look like real folders and open as a pop‑up on the tablet.
- **App library** with ~50 brand logos (YouTube, Discord, Gmail, Twitch, Steam, League of Legends, …) in iOS‑icon style.
- **Actions:** keyboard shortcut, open a website, or open a desktop app/game installed on the PC.
- **Spotify widget** with cover art, song, artist, progress and play/pause/next/previous (optional).
- **Themes** for the whole panel: Clásico, Medianoche, Aurora, Carbono, Atardecer, Océano.
- **Toggle feedback:** a button can switch text/colour/icon each time it is pressed (e.g. mute/unmute).
- **Live connection indicator** on the tablet.
- **Backup / restore** of your whole panel as a ZIP file.

## Requirements and limitations

Please read this before downloading.

| | Requirement |
|---|---|
| **PC (server)** | **Windows 10 or 11 only.** Shortcuts, app launching and Spotify use Windows APIs. macOS and Linux are not supported. |
| **Python** | Python **3.9 or newer** (developed with 3.13), available as `python` in the terminal. |
| **Tablet (panel)** | Any device with a web browser on the **same local network**. Designed for an iPad in **landscape** (1024×768). Works on iOS 9 Safari (iPad 2) and newer iPads, iPhones (landscape) and Android tablets. |
| **Network** | PC and tablet on the **same Wi‑Fi / LAN**. Guest networks or routers with "AP/client isolation" block devices from seeing each other. |
| **Firewall** | Windows must allow incoming connections to **TCP port 8765** on your **private** network. See [Windows Firewall](#windows-firewall). |
| **Editor** | The editor only opens **on the PC itself** (`localhost`). It cannot be opened from the tablet or another computer. |
| **Spotify widget** | Optional. Needs the Spotify **desktop app** on the same PC, playing on that PC, plus extra Python packages (PyWinRT). |
| **Node.js** | **Not** needed to use it. Only for development (auto‑reload, browser tests). |

**Known limitations**

- **LAN only, plain HTTP.** There is no HTTPS and no remote access. Do not expose port 8765 to the internet.
- **One server at a time.** Only one copy of the server can run on port 8765. A second copy refuses to start.
- **Shortcuts are "fire and forget".** For toggles like Discord mute, the panel only *estimates* the state from its own taps (shown as `ESTIMADO`). If you mute with the mouse, the indicator can get out of sync.
- **Shortcuts don't reach apps running as administrator** unless the server also runs as administrator. This is a Windows security rule (UIPI).
- **Desktop apps come from a fixed list**: Discord, Spotify, Steam, Epic Games, Telegram, WhatsApp, Zoom, Notion, Figma, Claude, League of Legends, Counter‑Strike 2 and Fortnite. If the app or game isn't installed, the button opens its website instead. Arbitrary programs or links can't be launched; this is on purpose, for security.
- **Old hardware:** on an iPad 2, animations are simpler and some effects are reduced for speed. Heavy pages with many large images will be slower.
- Limits: 12 pages, 80 items per page, 200 images (max 2.5 MB each), backups up to 505 MB.
- The interface text is in Spanish.

## Install

1. **Install Python** from [python.org](https://www.python.org/downloads/windows/). In the installer, tick **"Add python.exe to PATH"**.
2. **Download this project.** Use the green **Code → Download ZIP** button on GitHub and extract it, or clone it:
   ```powershell
   git clone https://github.com/BautiMandrilli/panel-propio-ipad2.git
   cd panel-propio-ipad2
   ```
3. **Start the server** from that folder:
   ```powershell
   python server.py
   ```
   It prints three things:
   ```
   Editor en la PC: http://localhost:8765/editor
   iPad: http://192.168.x.x:8765
   Código para vincular el iPad: 123456
   ```
4. The first time, Windows Firewall will ask about Python. Choose **Private networks** and click **Allow** (details [below](#windows-firewall)).
5. Open **http://localhost:8765/editor** on the PC to design your panel.

Keep the terminal window open while you use the panel. Press `Ctrl+C` in it to stop the server.

## Connect your iPad

1. On the iPad, open **Safari** and go to the `iPad:` address the server printed (e.g. `http://192.168.1.20:8765`).
2. Type the **6‑digit code** from the server window. The iPad stays paired from then on; the code is only needed again if you clear Safari's data.
3. **Recommended: full screen.** Tap **Share → Add to Home Screen** and open the panel from that icon. It then runs without Safari's address bar and tabs. The Home Screen copy has its own storage, so you'll enter the code once more there.
4. **Optional:**
   - Settings → General (iOS 9) or Display & Brightness (newer iOS) → Auto‑Lock → **Never**, to keep the screen on.
   - Settings → General → Accessibility → **Guided Access**, to lock the iPad to the panel like a kiosk.

The pairing code **changes every time the server restarts**, but already‑paired devices keep working.

## Windows Firewall

The tablet must be able to reach your PC on **TCP port 8765**.

- **First run:** when Windows asks *"Allow Python to communicate on these networks?"*, tick **Private networks** and click **Allow**.
- **Your Wi‑Fi must be set to "Private".** Settings → Network & Internet → Wi‑Fi → *(your network)* → Network profile type → **Private**. On a **Public** profile Windows blocks the connection.
- **If you clicked "Cancel" or the tablet can't connect,** add the rule manually. Open PowerShell **as administrator** and run:
  ```powershell
  New-NetFirewallRule -DisplayName "Panel Propio" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow -Profile Private
  ```
  To remove it later:
  ```powershell
  Remove-NetFirewallRule -DisplayName "Panel Propio"
  ```
- Third‑party antivirus or firewall software may need the same exception.
- Never forward port 8765 on your router.

## Using the editor

Open **http://localhost:8765/editor** on the PC. Changes appear on the tablet a few seconds after you click **Guardar** (Save).

- **Left sidebar:**
  - Panel name and **Tema** (theme).
  - Pages: add, reorder, delete.
  - The selected page's layout (grid or free), background colour or image.
  - Export and import of backups.
- **Centre:** a live preview of the iPad screen.
  - Drag buttons to reorder them.
  - Drag a button's **corners** to make it span more boxes.
  - Double‑click a folder to open it.
- **Right‑edge bar:**
  - **Nuevo botón** (new button)
  - **Nueva carpeta** (new folder)
  - **Widget de Spotify**
- **Bottom bar:** Undo, Redo, Duplicate, Move left/right, Delete.
- **Right sidebar:** everything about the selected button.
  - Name, icon or app logo, action, colours, photo.
  - Location (which folder it is in) and advanced settings.
  - Sections can be collapsed.
- **Side bars:** drag their edges to resize them, or click an edge to hide that bar.
- **Shortcuts:**

  | Keys | Action |
  |---|---|
  | `Ctrl+S` | Save |
  | `Ctrl+Z` | Undo |
  | `Ctrl+Shift+Z` | Redo |
  | `Ctrl+D` | Duplicate |
  | `Delete` | Delete |
  | Arrow keys | Nudge (free layout) |
  | `Esc` | Deselect |
  | `Ctrl+Alt+[` / `Ctrl+Alt+]` | Hide or show the side bars |

## Button actions

| Action | What it does | Notes |
|---|---|---|
| **Atajo** (shortcut) | Sends a key combination to Windows, e.g. `ctrl+shift+m`. | Goes to whatever app is focused, or to apps with **global** shortcuts (Discord, OBS, games). Set the shortcut in that app first. |
| **Página web** (website) | Opens a URL in the PC's default browser. | |
| **App de la PC** (desktop app) | Opens an installed app or game and brings it to the front. | Falls back to the website if it isn't installed. The editor shows "instalada" / "no encontrada". |

Picking a logo from the **app library** fills in the action for you. It chooses the desktop app when it's installed, otherwise the website.

**Discord mute/deafen example:**
1. In Discord, open User Settings → Keybinds and create a keybind such as `Ctrl+Shift+1` for "Toggle Mute".
2. In the editor, set a button's action to **Atajo** with `ctrl+shift+1`.

## Spotify widget (optional)

Shows the current song, artist, cover art and progress, with previous / play‑pause / next controls. Audio keeps playing on the PC. It doesn't need a Spotify developer account or any login.

1. Stop the server (`Ctrl+C`).
2. Run:
   ```powershell
   python -m pip install -r requirements-spotify.txt
   python setup_spotify.py
   ```
   (or `npm run setup:spotify` if you have Node.js)
3. Start the server again.
4. Open the **Spotify desktop app**, play something, and make sure playback is on **this PC**.

The setup adds a widget to your first page and makes a backup first. You can add, move or delete widgets in the editor with **Widget de Spotify**.

If the widget says it needs the integration installed, run step 2 again with the **same Python** you use to start the server.

## Moving to another PC / backups

Your panel lives in the `data/` folder. It isn't part of the repository and is never uploaded.

- **Export:** Editor → *Llevar a otra PC* → **Exportar personalización**. This downloads a ZIP with your pages, buttons and images.
- **Import:** on the new PC, start the server, open the editor and choose **Importar respaldo ZIP**. Review the summary, then confirm.
  - This **replaces** the whole panel.
  - A safety copy of the old one is saved in `data/` first.
- Backups never include the pairing token, so pair the tablet again on the new PC.

## Connection status on the iPad

A pill at the top‑right shows the link to the PC. Tap it for an explanation; tapping also retries the connection right away.

| Status | Meaning |
|---|---|
| **Conectado** | Connected and working. |
| **Conectando…** | Starting up. |
| **Reconectando…** | The PC stopped answering for a moment. |
| **Conexión perdida** | The PC stopped answering. The panel keeps retrying every few seconds. |
| **Servidor apagado** | The server can't be found: it isn't running, the PC is off, or the devices are on different networks. |
| **Sin Wi‑Fi** | The tablet itself has no network. |
| **Error del servidor** | The server reported an error. Check its terminal window. |
| **Sin vincular** | Not paired. Enter the 6‑digit code. |

## Troubleshooting

- **The tablet can't open the page:**
  - Check that both devices are on the same Wi‑Fi.
  - Check that the Windows network profile is **Private** and that the firewall rule exists ([see above](#windows-firewall)).
  - Check that the server window is still open.
  - Try opening `http://localhost:8765` on the PC itself.
- **"Código incorrecto" with the right code:**
  - Make sure only one server is running; a second one now refuses to start.
  - Use the code from the window that is actually running.
  - After 5 wrong attempts, wait 5 minutes.
- **"El puerto 8765 ya está en uso" / the port is busy:** another copy is already running, possibly with no visible window. Find it and stop it:
  ```powershell
  Get-NetTCPConnection -LocalPort 8765 -State Listen | % { Get-Process -Id $_.OwningProcess }
  Stop-Process -Id <PID>
  ```
- **A shortcut works on the keyboard but not from the panel:**
  - Make sure the shortcut is set as **global** in the target app.
  - If the app runs **as administrator**, run the server as administrator too.
- **A desktop app opens its website instead:** the app or game isn't installed, or isn't on the supported list.
- **The page changed but the tablet didn't update:** wait about 10 seconds, or reload the page.
- **Slow on an old iPad:**
  - Use the **Clásico** theme.
  - Use fewer and smaller images.
  - Keep pages to about 3 rows, so they fit the screen without scrolling.

## Security

- The server listens on your local network only, over **HTTP** (not encrypted). Use it at home or on a network you trust.
- **Pairing:**
  - A device pairs with a 6‑digit code shown only in the PC's terminal.
  - Pairing gives it a token, stored in `data/token.txt`. **Don't share it**: anyone with the token on your network can press your buttons.
  - Too many wrong codes are rate‑limited.
- Editing, uploading, backups and restore only work **from the PC itself**, not from the network.
- Buttons can only run shortcuts, open http(s) links, or open apps from a fixed list. They never run arbitrary commands. Uploaded SVG images are sanitised.
- To unpair every device, stop the server, delete `data/token.txt`, start the server again, and pair your devices again.

## Development

Requires Node.js (22+ for the browser test) and npm.

```powershell
npm ci                         # dev tools (nodemon)
npm run dev                    # server with auto-restart and live reload
npm test                       # Python unit tests + layout tests
npm run test:dev               # auto-reload integration test
node tests/browser_smoke.mjs   # headless Chrome UI test (mocked actions, screenshots in .cache/)
```

- The code served to the tablet is **ES5** (no `fetch`, `let`/`const`, arrow functions or CSS Grid), so it runs on iOS 9.
- Tests never touch your `data/` folder, and never press real keys or open real apps.
- See [`CLAUDE.md`](CLAUDE.md) and [`HANDOVER.MD`](HANDOVER.MD) for architecture and design notes.

## Credits

- App logos come from **[Simple Icons](https://simpleicons.org/)** (CC0). Brand names and logos are trademarks of their respective owners. This project is not affiliated with or endorsed by any of them, including Elgato, Spotify, Discord, Riot Games, Valve or Epic Games.
- "Stream Deck" is a trademark of Elgato. Panel Propio is an independent project.
