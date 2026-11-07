// @ts-check
/**
 * electron-builder configuration, for `npm run dist` (Windows), `npm run
 * dist:mac` and .github/workflows/desktop-release.yml.
 *
 * JavaScript rather than YAML so code signing can follow the environment:
 * a build signs when a certificate is configured and stays unsigned otherwise.
 * - Windows, certificate file: CSC_LINK (or WIN_CSC_LINK) and CSC_KEY_PASSWORD,
 *   read by electron-builder itself.
 * - Windows, Azure Trusted Signing: the four AZURE_TRUSTED_SIGNING_* values
 *   below, plus AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET for
 *   the sign-in. Takes precedence over a certificate file.
 * - macOS: CSC_LINK and CSC_KEY_PASSWORD (a Developer ID Application
 *   certificate) sign; APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID
 *   notarize.
 * See README.md, "Code signing".
 */

const env = process.env;

/** @type {import('app-builder-lib').WindowsConfiguration['azureSignOptions']} */
const azureSignOptions =
  env.AZURE_TRUSTED_SIGNING_ENDPOINT &&
  env.AZURE_TRUSTED_SIGNING_ACCOUNT &&
  env.AZURE_TRUSTED_SIGNING_PROFILE &&
  env.AZURE_TRUSTED_SIGNING_PUBLISHER
    ? {
        endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT,
        codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT,
        certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE,
        // Exactly the subject name of the certificate; auto-update checks it on Windows.
        publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER,
      }
    : null;

/** @type {import('app-builder-lib').Configuration} */
const config = {
  appId: 'com.apexround.desktop',
  productName: 'Apex Round',
  copyright: 'Copyright © 2026 Apex Round',

  directories: {
    output: 'release',
    buildResources: 'build',
  },

  files: [
    'dist/**/*.js',
    '!dist/**/*.test.js',
    '!dist/checkConfig.js',
    'app.config.json',
    'package.json',
    // The tray icon. The build folder isn't packaged unless a file is named here.
    'build/icon.png',
  ],

  asar: true,

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    // No spaces: GitHub renames assets with spaces, which breaks auto-update's file names.
    artifactName: 'Apex-Round-Setup-${version}.${ext}',
    azureSignOptions,
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: 'Apex Round',
  },

  mac: {
    // Both are needed: the zip is what auto-update downloads on a Mac.
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    artifactName: 'Apex-Round-${version}-${arch}.${ext}',
    // The tile on Apple's icon grid (build/icon.png fills the canvas, as Windows expects).
    icon: 'build/icon-mac.png',
    category: 'public.app-category.productivity',
    darkModeSupport: true,
    hardenedRuntime: true,
    // JIT for V8 and the microphone, for the app and its helper processes.
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Apex Round listens through your microphone during a live session to transcribe what is said and suggest answers.',
      NSScreenCaptureUsageDescription:
        'Apex Round reads the screen you choose when you start listening and when you use Solve screen.',
    },
  },

  // Hardening (https://www.electronjs.org/docs/latest/tutorial/fuses): the
  // packaged app can't be run as plain Node, ignores NODE_OPTIONS and
  // --inspect, and only loads its own integrity-checked asar.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },

  // Auto-update reads this repository's GitHub Releases. `--publish always`
  // (the release workflow) uploads into the draft release desktop-v<version>;
  // installed apps update once that draft is published.
  publish: {
    provider: 'github',
    owner: 'samhanoun',
    repo: 'finalround-clone',
    tagNamePrefix: 'desktop-v',
    releaseType: 'draft',
  },
};

module.exports = config;
