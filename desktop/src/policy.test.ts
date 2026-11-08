import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  allowPermission,
  answerWindowShim,
  answerWindowShortcuts,
  commandScript,
  isAnswerWindowRequest,
  isAppOrigin,
  isDesktopCommand,
  isExternalWebLink,
  isLivePath,
  isPictureInPictureRequest,
  isTrustedSender,
  meetingScript,
  reservedAccelerators,
  resolveAppUrl,
  SHORTCUTS,
} from './policy';

test('resolveAppUrl: env over config over default; https or localhost only', () => {
  assert.equal(resolveAppUrl(undefined, undefined).href, 'http://localhost:3000/');
  assert.equal(resolveAppUrl(undefined, 'https://app.example.com').origin, 'https://app.example.com');
  assert.equal(resolveAppUrl('http://127.0.0.1:3100', 'https://app.example.com').origin, 'http://127.0.0.1:3100');
  assert.throws(() => resolveAppUrl('http://app.example.com', undefined), /https/);
  assert.throws(() => resolveAppUrl('file:///C:/app/index.html', undefined), /https/);
});

test('resolveAppUrl in a packaged build: config only, https on a real host', () => {
  const packaged = { packaged: true };
  assert.equal(resolveAppUrl(undefined, 'https://app.example.com', packaged).origin, 'https://app.example.com');
  // The environment can't redirect a packaged build.
  assert.equal(resolveAppUrl('https://evil.test', 'https://app.example.com', packaged).origin, 'https://app.example.com');
  assert.throws(() => resolveAppUrl(undefined, '', packaged), /app\.config\.json/);
  assert.throws(() => resolveAppUrl(undefined, undefined, packaged), /app\.config\.json/);
  assert.throws(() => resolveAppUrl(undefined, 'http://localhost:3000', packaged), /real host/);
  assert.throws(() => resolveAppUrl(undefined, 'https://localhost:3000', packaged), /real host/);
  assert.throws(() => resolveAppUrl(undefined, 'https://127.0.0.1', packaged), /real host/);
  assert.throws(() => resolveAppUrl(undefined, 'http://app.example.com', packaged), /real host/);
});

test('isAppOrigin compares origins, not prefixes', () => {
  const app = new URL('https://app.example.com');
  assert.equal(isAppOrigin('https://app.example.com/en/copilot/live', app), true);
  assert.equal(isAppOrigin('https://app.example.com.evil.test/', app), false);
  assert.equal(isAppOrigin('http://app.example.com/', app), false);
  assert.equal(isAppOrigin('not a url', app), false);
});

test('isExternalWebLink only lets http(s) out to the default browser', () => {
  assert.equal(isExternalWebLink('https://checkout.stripe.com/c/pay'), true);
  assert.equal(isExternalWebLink('file:///C:/Windows/system32/calc.exe'), false);
  assert.equal(isExternalWebLink('ms-settings:privacy'), false);
  assert.equal(isExternalWebLink('javascript:alert(1)'), false);
});

test('isPictureInPictureRequest recognises Chromium’s Document PiP request and nothing else', () => {
  assert.equal(isPictureInPictureRequest({ url: 'about:blank', disposition: 'other' }), true);
  assert.equal(isPictureInPictureRequest({ url: 'about:blank', disposition: 'new-window' }), false);
  assert.equal(isPictureInPictureRequest({ url: 'https://evil.test/', disposition: 'other' }), false);
  assert.equal(isPictureInPictureRequest({ url: 'about:blank', disposition: 'foreground-tab' }), false);
});

test('isAnswerWindowRequest lets the stand-in’s pop-up through and nothing else', () => {
  const popup = { url: 'about:blank', frameName: 'apex-answer-window-3', disposition: 'new-window' };
  assert.equal(isAnswerWindowRequest(popup), true);
  assert.equal(isAnswerWindowRequest({ ...popup, url: 'https://evil.test/' }), false);
  assert.equal(isAnswerWindowRequest({ ...popup, url: 'https://app.example.com/en' }), false);
  assert.equal(isAnswerWindowRequest({ ...popup, frameName: '' }), false);
  assert.equal(isAnswerWindowRequest({ ...popup, frameName: 'apex-answer-window-3x' }), false);
  assert.equal(isAnswerWindowRequest({ ...popup, frameName: 'other-window' }), false);
  assert.equal(isAnswerWindowRequest({ ...popup, disposition: 'other' }), false);
  assert.equal(isAnswerWindowRequest({ ...popup, disposition: 'foreground-tab' }), false);
});

/** Runs the stand-in in a sandbox whose window.open records its calls. */
function installShim(open: (url: string, name: string, features: string) => unknown) {
  const calls: string[][] = [];
  const fakeWindow: Record<string | symbol, unknown> = {
    documentPictureInPicture: { native: true },
    open: (url: string, name: string, features: string) => {
      calls.push([url, name, features]);
      return open(url, name, features);
    },
  };
  vm.runInNewContext(answerWindowShim(), { window: fakeWindow, EventTarget, Event, DOMException, queueMicrotask, Promise, Number, Math, Symbol, Object });
  return { api: fakeWindow.documentPictureInPicture as { requestWindow(o?: unknown): Promise<unknown>; window: unknown; addEventListener(t: string, f: (e: Event & { window?: unknown }) => void): void }, calls, fakeWindow };
}

function fakePopup() {
  const listeners: Record<string, () => void> = {};
  const popup = {
    closed: false,
    close() {
      popup.closed = true;
      listeners.pagehide?.();
    },
    addEventListener(type: string, listener: () => void) {
      listeners[type] = listener;
    },
  };
  return popup;
}

test('the answer-window stand-in opens a sized same-origin pop-up and replaces the previous one', async () => {
  const popups = [fakePopup(), fakePopup()];
  const { api, calls } = installShim(() => popups[calls.length - 1]);
  const entered: unknown[] = [];
  api.addEventListener('enter', (event) => entered.push(event.window));

  assert.equal(await api.requestWindow({ width: 420, height: 620 }), popups[0]);
  assert.equal(api.window, popups[0]);
  assert.equal(await api.requestWindow({ width: 9e9, height: 'x' }), popups[1]);
  assert.deepEqual(calls, [
    ['', 'apex-answer-window-1', 'popup,width=420,height=620'],
    ['', 'apex-answer-window-2', 'popup,width=420,height=620'],
  ]);
  assert.equal(popups[0].closed, true, 'one answer window at a time');
  assert.equal(api.window, popups[1]);
  await Promise.resolve();
  assert.deepEqual(entered, [popups[0], popups[1]]);
  popups[1].close();
  assert.equal(api.window, null);
});

test('the stand-in reports a blocked pop-up and installs itself once', async () => {
  const { api, fakeWindow } = installShim(() => null);
  await assert.rejects(api.requestWindow(), { name: 'NotAllowedError' });
  // Running it again on the same page keeps the first install.
  vm.runInNewContext(answerWindowShim(), { window: fakeWindow, EventTarget, Event, DOMException, queueMicrotask, Promise, Number, Math, Symbol, Object });
  assert.equal(fakeWindow.documentPictureInPicture, api);
});

test('allowPermission: the app gets the mic and screen capture, never the camera; other sites get nothing', () => {
  const app = new URL('http://localhost:3000');
  assert.equal(allowPermission('media', 'http://localhost:3000/en/copilot/live', app, { mediaTypes: ['audio'] }), true);
  assert.equal(allowPermission('media', 'http://localhost:3000/en/copilot/live', app, { mediaTypes: ['video'] }), false);
  assert.equal(allowPermission('media', 'http://localhost:3000/', app, { mediaTypes: ['audio', 'video'] }), false);
  assert.equal(allowPermission('display-capture', 'http://localhost:3000/', app), true);
  assert.equal(allowPermission('geolocation', 'http://localhost:3000/', app), false);
  assert.equal(allowPermission('media', 'https://evil.test/', app, { mediaTypes: ['audio'] }), false);
});

test('shortcuts dispatch a DOM event with a JSON-encoded command', () => {
  assert.deepEqual(Object.values(SHORTCUTS).sort(), ['answer-now', 'solve-screen', 'toggle-answers']);
  assert.equal(
    commandScript('solve-screen'),
    `window.dispatchEvent(new CustomEvent('apex-desktop:command', { detail: "solve-screen" }));`,
  );
  assert.equal(isDesktopCommand('answer-now'), true);
  assert.equal(isDesktopCommand('rm -rf'), false);
  assert.equal(isDesktopCommand(undefined), false);
});

test('meeting events reach the page as JSON, with the app name capped', () => {
  assert.equal(
    meetingScript({ state: 'started', app: 'Zoom' }),
    `window.dispatchEvent(new CustomEvent('apex-desktop:meeting', { detail: {"state":"started","app":"Zoom"} }));`,
  );
  // A name can't break out of the string.
  const script = meetingScript({ state: 'ended', app: `"});alert(1);//${'x'.repeat(60)}` });
  assert.match(script, /detail: \{"state":"ended","app":"\\"\}\);alert\(1\);\/\/x+"\} \}\)\);$/);
  assert.equal(JSON.parse(/detail: (\{.*\}) \}/.exec(script)?.[1] ?? '{}').app.length, 40);
});

test('the answer window has fixed move, resize and reset shortcuts that avoid AltGr characters', () => {
  const win = answerWindowShortcuts('win32');
  assert.deepEqual(win.move, { left: 'Control+Alt+Left', right: 'Control+Alt+Right', up: 'Control+Alt+Up', down: 'Control+Alt+Down' });
  assert.equal(win.resize.right, 'Control+Alt+Shift+Right');
  assert.equal(win.reset, 'Control+Alt+Home');
  assert.equal(answerWindowShortcuts('darwin').move.left, 'Control+Command+Left');
  assert.equal(reservedAccelerators('win32').length, 9);
  assert.equal(new Set(reservedAccelerators('win32')).size, 9);
});

test('IPC only trusts the main window’s top frame on the app origin', () => {
  const app = new URL('https://app.example.com');
  const page = { webContentsId: 3, isTopFrame: true, url: 'https://app.example.com/en/settings' };
  assert.equal(isTrustedSender(page, 3, app), true);
  assert.equal(isTrustedSender({ ...page, webContentsId: 4 }, 3, app), false);
  assert.equal(isTrustedSender({ ...page, isTopFrame: false }, 3, app), false);
  assert.equal(isTrustedSender({ ...page, url: 'data:text/html,offline' }, 3, app), false);
  assert.equal(isTrustedSender({ ...page, url: 'https://evil.test/' }, 3, app), false);
  assert.equal(isTrustedSender(page, null, app), false);
});

test('isLivePath recognises the live page in any language', () => {
  assert.equal(isLivePath('/en/copilot/live'), true);
  assert.equal(isLivePath('/pt/copilot/live/'), true);
  assert.equal(isLivePath('/en/copilot/live/history'), false);
  assert.equal(isLivePath('/en/settings'), false);
});
