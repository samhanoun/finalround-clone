import { contextBridge } from 'electron';

/**
 * Tells the web app it runs inside the desktop app (sandboxed preload, no
 * Node access for the page). Shortcuts arrive as `apex-desktop:command` DOM
 * events dispatched by the main process, so nothing else is exposed here.
 */
contextBridge.exposeInMainWorld('apexDesktop', {
  isDesktop: true,
  platform: process.platform,
});
