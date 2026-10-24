import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowPermission,
  commandScript,
  isAppOrigin,
  isExternalWebLink,
  isPictureInPictureRequest,
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

test('isPictureInPictureRequest allows the floating window and nothing else', () => {
  assert.equal(isPictureInPictureRequest({ url: 'about:blank', disposition: 'other' }), true);
  assert.equal(isPictureInPictureRequest({ url: 'about:blank', disposition: 'new-window' }), false);
  assert.equal(isPictureInPictureRequest({ url: 'https://evil.test/', disposition: 'other' }), false);
  assert.equal(isPictureInPictureRequest({ url: 'about:blank', disposition: 'foreground-tab' }), false);
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
});
