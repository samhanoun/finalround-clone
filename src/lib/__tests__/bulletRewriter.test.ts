import { analyzeBullet, analyzeBullets } from '@/lib/bulletRewriter';

describe('analyzeBullet', () => {
  it('gives each issue as a code next to its English wording', () => {
    const result = analyzeBullet('Worked on the checkout service');
    expect(result.issueCodes).toEqual([{ code: 'weak_word', word: 'worked on' }, { code: 'no_metrics' }, { code: 'weak_verb' }]);
    expect(result.issues).toHaveLength(result.issueCodes.length);
  });

  it('has nothing to say about a strong, measured bullet', () => {
    const result = analyzeBullet('Led the payments migration that cut checkout time by 40% for 2 million customers');
    expect(result.issueCodes).toEqual([]);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('flags length and passive voice', () => {
    expect(analyzeBullets(['Fixed bugs'])[0].issueCodes).toContainEqual({ code: 'too_short' });
    expect(analyzeBullet('The release process was rewritten and now takes less time each week').issueCodes).toContainEqual({ code: 'passive' });
  });
});
