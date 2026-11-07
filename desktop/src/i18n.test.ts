import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, localeFromPath, localeFromUrl, MESSAGE_KEYS, pickLocale, translate } from './i18n';

test('the language comes from the first segment of the page path', () => {
  assert.equal(localeFromPath('/es/copilot/live'), 'es');
  assert.equal(localeFromPath('/de'), 'de');
  assert.equal(localeFromPath('/pt?x=1'), 'pt');
  assert.equal(localeFromPath('/copilot/live'), null);
  assert.equal(localeFromPath('/xx/settings'), null);
  assert.equal(localeFromPath('/english/settings'), null);
  assert.equal(localeFromUrl('https://app.example.com/fr/settings#desktop'), 'fr');
  assert.equal(localeFromUrl('data:text/html,hello'), null);
  assert.equal(localeFromUrl('not a url'), null);
});

test('pickLocale takes the first system language the app speaks', () => {
  assert.equal(pickLocale(['pt-BR', 'en-US']), 'pt');
  assert.equal(pickLocale(['ja-JP', 'de-DE']), 'de');
  assert.equal(pickLocale(['ja-JP']), 'en');
  assert.equal(pickLocale([]), 'en');
});

test('translate fills placeholders in each language', () => {
  assert.equal(translate('en', 'meetingTitle', { app: 'Zoom' }), 'Zoom is using your microphone');
  assert.equal(translate('es', 'meetingTitle', { app: 'Zoom' }), 'Zoom está usando tu micrófono');
  assert.equal(translate('fr', 'meetingTitle', { app: 'Zoom' }), 'Zoom utilise votre micro');
  assert.equal(translate('de', 'meetingTitle', { app: 'Zoom' }), 'Zoom verwendet dein Mikrofon');
  assert.equal(translate('pt', 'meetingTitle', { app: 'Zoom' }), 'Zoom está usando seu microfone');
  assert.equal(translate('de', 'displayItem', { name: 'Bildschirm 2', width: 2560, height: 1440 }), 'Bildschirm 2, 2560 × 1440');
  // A missing value leaves the placeholder visible rather than printing "undefined".
  assert.equal(translate('en', 'meetingTitle'), '{app} is using your microphone');
});

test('every language has every message, with the same placeholders', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
  // Only the number formats are the same everywhere.
  const sameEverywhere = new Set(['displayItem']);
  for (const locale of LOCALES) {
    for (const key of MESSAGE_KEYS) {
      const text = translate(locale, key);
      assert.ok(text.length > 0, `${locale}.${key}`);
      assert.equal(placeholders(text), placeholders(translate('en', key)), `${locale}.${key}`);
      if (locale !== 'en' && !sameEverywhere.has(key)) {
        assert.notEqual(text, translate('en', key), `${locale}.${key} is still English`);
      }
    }
  }
});
