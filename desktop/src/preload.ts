import { contextBridge, ipcRenderer } from 'electron';

/**
 * The web app's bridge to the desktop app (window.apexDesktop, typed in
 * src/lib/desktop.ts). The page gets no Node and no ipcRenderer: only these
 * functions, each one IPC call that the main process checks (the sender must
 * be the main window showing the app) and validates.
 *
 * A sandboxed preload can't require local files, so the channel names are
 * repeated here; they must match IPC_CHANNELS in policy.ts (preload.test.ts
 * checks).
 *
 * Shortcuts and meeting detection arrive the other way, as
 * `apex-desktop:command` and `apex-desktop:meeting` DOM events.
 */

const VERSION_ARG = '--apex-version=';
const versionArg = process.argv.find((arg) => arg.startsWith(VERSION_ARG));
const version = versionArg && /^[\w.+-]{1,32}$/.test(versionArg.slice(VERSION_ARG.length)) ? versionArg.slice(VERSION_ARG.length) : undefined;

contextBridge.exposeInMainWorld('apexDesktop', {
  isDesktop: true,
  platform: process.platform,
  version,
  hideForCapture: (): Promise<void> => ipcRenderer.invoke('apex:hide-for-capture'),
  showAfterCapture: (): Promise<void> => ipcRenderer.invoke('apex:show-after-capture'),
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('apex:get-settings'),
  setSettings: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('apex:set-settings', patch),
  listDisplays: (): Promise<unknown> => ipcRenderer.invoke('apex:list-displays'),
  pauseShortcuts: (paused: unknown): Promise<void> => ipcRenderer.invoke('apex:pause-shortcuts', paused === true),
});
