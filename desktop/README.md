# Apex Round for Windows

The Apex Round web app in a desktop window, plus what a browser tab can't do on its own:

- **Meeting audio from desktop apps.** **Start listening** captures everything the PC plays (Windows system-audio loopback) and your main screen, with no share picker. That covers the Zoom and Teams desktop apps as well as meetings in a browser.
- **Global shortcuts** that work while the meeting app has focus:
  - **Ctrl+Shift+A**: answer now
  - **Ctrl+Shift+S**: solve what's on screen
  - **Ctrl+Shift+H**: pop the answer window out, or bring it back
- **An always-on-top answer window:** the web app's own floating window (Document Picture-in-Picture), which Electron supports the same way Chrome does.

It loads the web app from a URL; it doesn't bundle it. Everything (sign-in, sessions, transcription, answers, billing) runs on the server as in the browser.

## Run it (development)

Start the web app first (`npm run dev` in the repository root, on http://localhost:3000), then:

```bash
cd desktop
npm install
npm start
```

To point it at another server, set `APEX_APP_URL` (for example `APEX_APP_URL=https://app.example.com npm start`) or set `appUrl` in `app.config.json`. In development only `https` URLs are accepted, plus plain `http` on localhost.

## Build the Windows installer

```bash
cd desktop
npm run dist
```

First set `appUrl` in `app.config.json` to your deployed server. It must be `https` on a real host, and `npm run dist` refuses to build without one. The app gives that origin silent screen, system-audio and microphone capture, so a packaged build never falls back to localhost (where any local program could be listening) and ignores `APEX_APP_URL`.

The build writes `release/Apex Round Setup <version>.exe` (an NSIS installer for x64) and `release/win-unpacked/` (the app, runnable without installing).

The installer is **not code-signed**, so Windows SmartScreen will warn on first run. Signing needs a code-signing certificate, configured through electron-builder's `win.signtoolOptions` or Azure Trusted Signing.

There's no app icon yet. Add a 512×512 `build/icon.png` and electron-builder uses it; until then the installer shows Electron's default icon.

## Security

- **Pages are isolated:** context isolation and the renderer sandbox are on, and pages get no Node. The preload only exposes `window.apexDesktop = { isDesktop, platform }`.
- **Only the app runs in the window.** Navigation to other origins is blocked, and http(s) links open in the default browser instead. Pop-ups are denied, except the floating answer window, and `<webview>` is blocked.
- **Permissions:** only the app's origin gets the microphone (audio only), screen capture and clipboard writes. The camera and every other permission are denied.
- **Hardened binary:** Electron fuses in the packaged app turn off `RunAsNode`, `NODE_OPTIONS` and `--inspect`, turn on cookie encryption, and make it load only its own integrity-checked `app.asar`.
- **Auto-update** (`electron-updater`) checks this repository's GitHub Releases, in packaged builds only. Nothing is published unless you run `electron-builder --publish always` with a `GH_TOKEN`.

## Tests

```bash
npm test
```

These unit tests cover the rules in `src/policy.ts`: app URL, origins, external links, permissions, the floating window and shortcuts. The full app was also run end to end with Playwright's Electron driver against the local fakes in `e2e/fakes`:

- Start listening captured the screen and system audio without a picker.
- Solve screen sent a frame of the real screen.
- An external link went to the default browser while the window stayed on the app.

## Limits

- **Windows first.** On macOS, system-audio loopback isn't available this way, so Start listening captures the screen without the meeting's audio. macOS needs ScreenCaptureKit work and a Mac to build and sign on.
- **The main screen only.** Solve screen and capture read the primary display.
- **No hiding:** the floating window is visible in screen shares of the entire screen; hiding it from capture is a separate product decision.
