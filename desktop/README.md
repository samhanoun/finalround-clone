# Apex Round desktop app

The Apex Round web app in a desktop window (Windows first, macOS too), plus what a browser tab can't do on its own:

- **Meeting audio from desktop apps.** **Start listening** captures the display you choose and, on Windows, everything the PC plays (system-audio loopback), with no share picker. That covers the Zoom and Teams desktop apps as well as meetings in a browser.
- **Global shortcuts** that work while the meeting app has focus. You can change them.
- **An answer window that stays put.** The web app's floating answer window becomes an always-on-top overlay that remembers where you left it and moves from the keyboard.
- **A tray icon** with the main actions, and the option to keep running there when the window is closed.
- **Meeting detection** on Windows: when Zoom, Teams, Webex or Slack starts using the microphone, the app offers to start a live session.

It loads the web app from a URL; it doesn't bundle it. Everything else (sign-in, sessions, transcription, answers, billing) runs on the server, as in the browser.

## Using it

### Screen to capture

**Settings → Desktop app → Screen to capture**, or the tray menu's **Screen to capture** submenu, picks the display that Start listening and Solve screen read. The default is the main display, and the app falls back to it when the chosen display is unplugged. A change applies the next time you start listening.

### Shortcuts

| Shortcut (Windows) | Mac | What it does | Change it |
| --- | --- | --- | --- |
| Ctrl+Shift+A | ⌘⇧A | Answer now | Yes |
| Ctrl+Shift+S | ⌘⇧S | Solve screen | Yes |
| Ctrl+Shift+H | ⌘⇧H | Pop the answer window out, or bring it back | Yes |
| Ctrl+Alt+Arrow | ⌃⌘+Arrow | Move the answer window 24 px | No |
| Ctrl+Alt+Shift+Arrow | ⌃⌘⇧+Arrow | Resize it 24 px (right and down grow it) | No |
| Ctrl+Alt+Home | ⌃⌘+Home | Put it back in the top-right corner at its default size | No |

- **Changing a shortcut:** in **Settings → Desktop app**, click a shortcut and press the new keys. Esc cancels, Backspace removes the shortcut, and the arrow button resets it. The app's own shortcuts are paused while you record, so you can reuse their keys.
- **What's refused:**
  - a combination another app already holds (*taken*);
  - one used by another command or by the answer window;
  - one without Ctrl, Alt, Cmd or the Windows key (*invalid*), except function and media keys.
  The previous shortcut stays in place.
- **The answer-window shortcuts are fixed.** They're registered only while the answer window is open, so Ctrl+Alt+Arrows stay with your editor the rest of the time. They avoid digits and letters because Ctrl+Alt is AltGr on many European keyboards. On a Mac they use Ctrl+Cmd, because Ctrl+Option belongs to VoiceOver.

### The answer window

- **How it opens.** In a browser it's a Document Picture-in-Picture window. Electron 44 can't host those: `documentPictureInPicture.requestWindow()` resolves, but the window has no size and is gone a moment later.
  - So on each of the app's pages, the main process installs a small stand-in for `documentPictureInPicture` (`answerWindowShim` in `src/policy.ts`). Its `requestWindow()` opens a same-origin `about:blank` pop-up named `apex-answer-window-<n>`.
  - The window-open handler lets that pop-up through, only from the app's page in the main window, and the main process makes it the overlay.
  - The web app needs no change: it renders into the window it gets back, as before.
- It's always on top, at the level that also covers full-screen meeting apps.
- It has no taskbar button; the tray menu's **Show or hide answer window** and the shortcut bring it back.
- It reopens where you left it. A position on a monitor that's gone is pulled back onto a screen that exists.
- **Solve screen hides it first:** the page calls `hideForCapture()`, the window hides, and about two frames later (120 ms) the capture runs. It comes back without taking the focus from the meeting app.
- It is **not** hidden from screen sharing. That was a product decision: if you share your whole screen, people see it.

### Tray

The menu, in the app's language:
- **Open Apex Round**;
- **Answer now**, **Solve screen** and **Show or hide answer window**, enabled on the live page;
- **Screen to capture**, a submenu of displays;
- **Detect meetings** (Windows);
- **Shortcuts…**, which opens Settings → Desktop app and asks first if that would leave the live page;
- **Quit**.

On Windows, a click on the icon opens the app.

**Keep running in the tray when closed** (on by default) makes the close button hide the window instead of quitting. A running live session keeps going, and the first time a notice says where the app went. **Quit** in the tray menu really quits: it ends a running session as closing the browser tab would.

### Meeting detection (Windows)

- **How it works:** every 4 seconds the app reads which apps are using the microphone from Windows' privacy records. It runs `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone /s`, with System32's `reg.exe` and no shell. An app is in a meeting while its `LastUsedTimeStop` is 0.
- **Apps it knows:**
  - Zoom (`Zoom.exe`, `CptHost.exe`);
  - Microsoft Teams (`Teams.exe`, `ms-teams.exe`, the `MSTeams` package);
  - Webex;
  - Slack (huddles and calls).
  Browsers are ignored (the web app handles meetings in a tab), and so is Apex Round itself.
- **When a meeting starts:**
  - a notification says, for example, "Zoom is using your microphone". Clicking it opens the live page. It isn't shown while the Apex Round window has the focus;
  - the page gets `apex-desktop:meeting` with `{ state: 'started', app: 'Zoom' }`.
- **When it ends:** the app has been off the microphone for two polls in a row (about 8 s), so switching headsets doesn't count. The page gets `{ state: 'ended', app }` and decides what to do; the desktop app ends nothing itself.
- **Turning it off:** Settings → Desktop app, or the tray.

### Settings files

The app keeps two files in its user-data folder (`%APPDATA%\Apex Round` when installed, `%APPDATA%\apex-round-desktop` in development, `~/Library/Application Support/Apex Round` on a Mac):

- **`settings.json`**: `captureDisplayId`, `shortcuts`, `meetingDetection` and `closeToTray`.
- **`window-state.json`**: where the answer window was, the last page language and whether the tray notice was shown.

Both are validated when read: a missing or broken value falls back to its default. They're written atomically: a temporary file, flushed, then renamed over the old one.

### Language

The tray menu, notifications, dialogs and the offline page follow the app's language: the first part of the page's path (`/es/…`) in English, Spanish, French, German or Portuguese (`src/i18n.ts`). The app also opens on the live page in the last language used, or the system language the first time.

## Run it (development)

Start the web app first (`npm run dev` in the repository root, on http://localhost:3000), then:

```bash
cd desktop
npm install
npm start
```

- **Another server:** set `APEX_APP_URL` (for example `APEX_APP_URL=https://app.example.com npm start`), or set `appUrl` in `app.config.json`. In development only `https` URLs are accepted, plus plain `http` on localhost.
- **A separate profile:** `APEX_USER_DATA_DIR=<folder>` keeps settings, sign-in and the single-instance lock in that folder, for tests.
- **Packaged builds ignore both variables.**
- **When the server doesn't answer**, the window shows an offline page with Retry and checks again every 5 seconds on its own.

## Build

```bash
cd desktop
npm run dist       # Windows: release/Apex-Round-Setup-<version>.exe (NSIS, x64) and release/win-unpacked/
npm run dist:mac   # macOS, on a Mac: release/Apex-Round-<version>-{x64,arm64}.{dmg,zip}
```

- **Set the server first.** Put the deployed server in `app.config.json` as `appUrl`. It must be `https` on a real host, and both scripts refuse to build without one. The app gives that origin silent screen, system-audio and microphone capture, so a packaged build never falls back to localhost (where any local program could be listening) and ignores `APEX_APP_URL`.
- **The config is `electron-builder.js`.** It's JavaScript, not YAML, so signing can follow environment variables.
- **Icons:**
  - `build/icon.png` (1024 px, the graphite Apex mark) is the Windows icon and, resized to 16 and 32 px, the tray icon. It ships inside `app.asar` for the tray.
  - `build/icon-mac.png` is the same mark on Apple's icon grid.
- **macOS build settings:**
  - targets: `dmg` and `zip`, for `x64` and `arm64`. The zip is what auto-update downloads;
  - hardened runtime, with `build/entitlements.mac.plist` (JIT and microphone);
  - `NSMicrophoneUsageDescription` and a screen-recording usage string;
  - category: productivity.

## Code signing

Builds sign when credentials are present in the environment and stay unsigned otherwise. Nothing secret goes in the repository.

### Windows: a certificate file

- **`CSC_LINK`:** the `.pfx` file, as a path, an https URL or its base64 content. Use `WIN_CSC_LINK` to keep it apart from a Mac certificate.
- **`CSC_KEY_PASSWORD`** (or `WIN_CSC_KEY_PASSWORD`): its password.

### Windows: Azure Trusted Signing

It takes precedence over a certificate file. Set all four configuration values:

| Variable | Value |
| --- | --- |
| `AZURE_TRUSTED_SIGNING_ENDPOINT` | The account's endpoint, for example `https://eus.codesigning.azure.net` |
| `AZURE_TRUSTED_SIGNING_ACCOUNT` | The Trusted Signing account name |
| `AZURE_TRUSTED_SIGNING_PROFILE` | The certificate profile name |
| `AZURE_TRUSTED_SIGNING_PUBLISHER` | The certificate's subject name, exactly. Auto-update checks updates against it |

Also set the service principal that signs in: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`. electron-builder 26 installs the `TrustedSigning` PowerShell module on first use.

Without either method, the installer is unsigned and SmartScreen warns on first run.

### macOS: signing and notarization

| Variable | Value |
| --- | --- |
| `CSC_LINK` | The **Developer ID Application** certificate, `.p12`: a path or its base64 content |
| `CSC_KEY_PASSWORD` | Its password |
| `APPLE_ID` | The Apple ID that notarizes |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID (appleid.apple.com) |
| `APPLE_TEAM_ID` | The 10-character team ID |

- **With the certificate,** electron-builder signs with the hardened runtime.
- **With all three `APPLE_*` values,** it also notarizes.
- **Without the certificate,** the app is unsigned. That's fine for testing on the build Mac, but macOS won't open it from a download and it can't auto-update.

## Releases

`.github/workflows/desktop-release.yml` builds Windows and macOS on GitHub's runners and publishes to this repository's GitHub Releases, where installed apps look for updates.

### What it needs

- **The repository variable `APEX_APP_URL`** (Settings → Secrets and variables → Actions → Variables): the deployed web app, `https`. The workflow writes it into `app.config.json` and stops with a clear error if it's missing or not https.
- **Optional repository secrets** for signing:
  - Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`;
  - macOS: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`;
  - Azure Trusted Signing: the secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, plus the variables `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE`, `AZURE_TRUSTED_SIGNING_PUBLISHER`.

  Missing ones mean an unsigned build and a warning in the run.

### Shipping a version

1. Set `"version"` in `desktop/package.json` and merge it.
2. Push the tag `desktop-v<version>`, for example `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`. The workflow checks that the tag matches the version.
3. The workflow creates the draft release `desktop-v<version>` and the Windows and macOS jobs upload into it. The upload includes the `latest.yml` and `latest-mac.yml` files that auto-update reads.
4. Check the draft, then **publish** it. Installed apps update from the **latest published** release:
   - they check at start-up and every 6 hours;
   - they download in the background;
   - they install when you quit, with a notification in the app's language.

**Run workflow** (manual) builds both platforms and keeps the installers as workflow artifacts. Tick **publish** to upload them to the draft release as well.

**Note:** auto-update reads the repository's *latest* release. A newer non-desktop release in this repository would hide the desktop one, and a private repository needs a token in the app.

## Security

- **Pages are isolated:** context isolation and the renderer sandbox are on, and pages get no Node.
- **The bridge is narrow.** The preload exposes only `window.apexDesktop`:
  - `isDesktop`, `platform` and `version`;
  - `getSettings`, `setSettings`, `listDisplays`, `hideForCapture`, `showAfterCapture` and `pauseShortcuts`.

  Each function is one `ipcRenderer.invoke` call; the page never gets `ipcRenderer`.
- **The main process checks every IPC call.** The sender must be the main window's top frame, showing the app's origin: not the offline page, an iframe or the answer window. Every input is validated: unknown keys are ignored, and wrong types are refused.
- **One script is added to the app's pages:** the `documentPictureInPicture` stand-in, built only on `window.open`. It gives the page nothing it couldn't already do, and the answer window it opens gets no bridge.
- **Only the app runs in the window.**
  - Navigation to other origins is blocked, and http(s) links open in the default browser instead.
  - Pop-ups are denied, except the answer window's `about:blank` pop-up opened by the app's own page in the main window.
  - `<webview>` is blocked.
- **Permissions:** only the app's origin gets the microphone (audio only), screen capture and clipboard writes. The camera and every other permission are denied.
- **Hardened binary:** Electron fuses in the packaged app turn off `RunAsNode`, `NODE_OPTIONS` and `--inspect`. They also turn on cookie encryption and make the app load only its own integrity-checked `app.asar`.
- **Meeting detection only reads.** It reads one registry key, with `reg.exe` from System32 and no shell. It sends nothing anywhere: only the app's name reaches the page.
- **Auto-update** (`electron-updater`) checks this repository's GitHub Releases, in packaged builds only.

## Tests

```bash
npm test
```

Unit tests (`node:test`) cover the parts kept free of Electron:
- `policy.ts`: app URL, origins, links, permissions, the answer window request and its `documentPictureInPicture` stand-in, IPC senders and the page scripts;
- `accelerator.ts` and `shortcuts.ts`: accelerator parsing, and changing shortcuts with taken, invalid and conflicting keys;
- `settings.ts`: validation and atomic writes;
- `bounds.ts`: placing, clamping, moving and resizing the answer window;
- `meetings.ts` and `meetingWatcher.ts`: `reg query` parsing from sample output, app matching, start and end;
- `capture.ts`: choosing the display;
- `trayMenu.ts`: the menu;
- `i18n.ts`: the translations;
- `preload.ts`: the channels the preload uses.

The web side of the bridge is tested with Jest in the repository root: `src/lib/__tests__/desktop.test.ts` and `src/components/desktop/__tests__`.

The app itself was run with Playwright's Electron driver against the local fakes (`APEX_USER_DATA_DIR` set to a throwaway folder). That run checked:
- settings over IPC, with taken, invalid and badly typed changes refused;
- shortcuts registered, swapped and paused;
- the answer window: the stand-in opens it always on top, in its default corner, and Solve screen hides it for about 120 ms and brings it back without moving the focus;
- its position saved on close and restored;
- close to tray, the one-time notice and Quit;
- the offline page in the saved language, coming back by itself once the server answered.

## Limits

- **macOS audio:** Electron's system-audio loopback is Windows-only (`audio: 'loopback'` in the display-media handler, per Electron 44's own types). On a Mac, Start listening captures the screen alone. The meeting's audio must come from the microphone, with the meeting on the speakers, or from a meeting in a browser tab shared with its audio.
- **macOS permissions:** macOS asks once for Screen Recording (System Settings → Privacy & Security → Screen & System Audio Recording) and for the microphone.
- **macOS builds** need a Mac (or the release workflow's runner). Meeting detection is Windows-only.
- **Answer window:** the move and resize shortcuts can't be changed. It stays visible in screen shares of the entire screen, on purpose.
