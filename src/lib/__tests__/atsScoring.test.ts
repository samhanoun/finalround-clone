import { calculateATSScore, extractJobKeywords, suggestKeywords } from '@/lib/atsScoring';

const JOB =
  'We are hiring a senior engineer for our platform team. Requirements: TypeScript, React, Kubernetes, GraphQL ' +
  'and leadership. Experience with PostgreSQL is a plus. You will maintain and train our C++ services.';

const RESUME = [
  'Jane Doe · jane.doe@example.test',
  'Senior engineer with 8 years of experience in TypeScript, React and PostgreSQL.',
  'Built C++ services. Education: BSc Computer Science, University of Leeds.',
].join('\n');

describe('extractJobKeywords', () => {
  const keywords = extractJobKeywords(JOB);

  it('keeps capitalised terms whole instead of splitting them at inner capitals', () => {
    expect(keywords).toEqual(expect.arrayContaining(['typescript', 'react', 'kubernetes', 'graphql', 'postgresql']));
    for (const fragment of ['type', 'script', 'graph', 'postgre', 'ql']) expect(keywords).not.toContain(fragment);
  });

  it('matches whole words only, so "sql" and "ai" are not found inside other words', () => {
    // "PostgreSQL" is not "SQL", and "maintain"/"train" don't mention AI.
    expect(keywords).not.toContain('sql');
    expect(keywords).not.toContain('ai');
    expect(extractJobKeywords('Strong SQL and some AI work')).toEqual(expect.arrayContaining(['sql', 'ai']));
  });

  it('leaves out headings and sentence words', () => {
    for (const word of ['we', 'requirements', 'you', 'experience with']) expect(keywords).not.toContain(word);
  });

  it('finds keywords with symbols', () => {
    expect(keywords).toContain('c++');
  });
});

describe('calculateATSScore', () => {
  it('splits the job keywords into what the résumé covers and what it misses', () => {
    const result = calculateATSScore(RESUME, JOB);
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['typescript', 'react', 'postgresql', 'senior', 'experience', 'c++']));
    expect(result.missingKeywords).toEqual(expect.arrayContaining(['kubernetes', 'graphql', 'leadership']));
    expect(result.matchedKeywords.filter((k) => result.missingKeywords.includes(k))).toEqual([]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('suggests only keywords the résumé lacks', () => {
    expect(suggestKeywords(RESUME, JOB)).toEqual(expect.arrayContaining(['kubernetes', 'graphql']));
    expect(suggestKeywords(RESUME, JOB)).not.toContain('typescript');
  });
});

describe('tips', () => {
  it('gives each suggestion as a code with its keywords, so the page can word it in any language', () => {
    const result = calculateATSScore(RESUME, JOB);
    expect(result.tips).toEqual([
      { code: 'add_keywords', keywords: result.missingKeywords.slice(0, 5) },
      { code: 'expand' },
    ]);
    expect(result.suggestions).toHaveLength(result.tips.length);
  });

  it('asks for contact details when there are none', () => {
    expect(calculateATSScore('Engineer with React experience', JOB).tips).toContainEqual({ code: 'add_contact' });
  });

  it('finds an email address, and checks a long run of text without one quickly', () => {
    expect(calculateATSScore('Reach me at jane.doe@mail.example.com. React experience', JOB).tips).not.toContainEqual({ code: 'add_contact' });
    // The server runs this on uploaded résumés: 200,000 characters with no address once took minutes.
    const started = Date.now();
    expect(calculateATSScore(`x@${'a'.repeat(200_000)} React experience`, JOB).tips).toContainEqual({ code: 'add_contact' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
