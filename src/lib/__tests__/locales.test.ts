import { stripLocalePrefix } from '@/i18n/locales';

describe('stripLocalePrefix', () => {
  it('drops a supported language prefix, keeping the query and hash', () => {
    expect(stripLocalePrefix('/es/copilot/live')).toBe('/copilot/live');
    expect(stripLocalePrefix('/en/teams/join?token=abc')).toBe('/teams/join?token=abc');
    expect(stripLocalePrefix('/fr')).toBe('/');
    expect(stripLocalePrefix('/de?tab=goals')).toBe('/?tab=goals');
    expect(stripLocalePrefix('/pt#top')).toBe('/#top');
  });

  it('leaves paths without a language prefix alone', () => {
    expect(stripLocalePrefix('/dashboard')).toBe('/dashboard');
    expect(stripLocalePrefix('/it/dashboard')).toBe('/it/dashboard'); // not a supported language
    expect(stripLocalePrefix('/esports')).toBe('/esports');
    expect(stripLocalePrefix('/')).toBe('/');
  });
});
