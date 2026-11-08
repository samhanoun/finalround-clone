import { localeOfPath, savedLocaleToRestore, withLocale } from './savedLocale';

describe('savedLocaleToRestore', () => {
  it('switches to the language saved to the account when the page is in another one', () => {
    expect(savedLocaleToRestore('es', 'en', null)).toBe('es');
    expect(savedLocaleToRestore('de', 'fr', '/teams/join?token=abc')).toBe('de');
  });

  it('stays when they already match, or nothing usable is saved', () => {
    expect(savedLocaleToRestore('es', 'es', null)).toBeNull();
    expect(savedLocaleToRestore(null, 'en', null)).toBeNull();
    expect(savedLocaleToRestore('it', 'en', null)).toBeNull();
    expect(savedLocaleToRestore(42, 'en', null)).toBeNull();
  });

  it('stays when `next` names a language itself', () => {
    expect(savedLocaleToRestore('es', 'en', '/fr/goals')).toBeNull();
    expect(savedLocaleToRestore('es', 'en', '/de')).toBeNull();
  });

  it('does not switch to English: the saved value defaults to it, so it shows no choice', () => {
    expect(savedLocaleToRestore('en', 'es', null)).toBeNull();
  });
});

describe('localeOfPath and withLocale', () => {
  it('reads a language prefix, and only a supported one', () => {
    expect(localeOfPath('/es/goals')).toBe('es');
    expect(localeOfPath('/pt?x=1')).toBe('pt');
    expect(localeOfPath('/goals')).toBeNull();
    expect(localeOfPath('/it/goals')).toBeNull();
    expect(localeOfPath('/esp/goals')).toBeNull();
    expect(localeOfPath(null)).toBeNull();
  });

  it('puts a path in another language, keeping the rest', () => {
    expect(withLocale('/es/dashboard', 'fr')).toBe('/fr/dashboard');
    expect(withLocale('/es', 'fr')).toBe('/fr');
    expect(withLocale('/es?next=1', 'de')).toBe('/de?next=1');
    expect(withLocale('/teams/join?token=abc', 'pt')).toBe('/pt/teams/join?token=abc');
  });
});
