import {
  JOB_CHAR_BUDGET,
  RESUME_CHAR_BUDGET,
  buildContextPack,
  jobKeyLines,
  readContextPack,
  renderContextPack,
  trimToBudget,
} from '@/lib/copilot/contextPack';

const NOW = new Date('2026-10-20T10:00:00Z');

describe('context pack', () => {
  it('returns null when there is nothing to pack', () => {
    expect(buildContextPack({ resumeText: '  ', jobDescription: '', now: NOW })).toBeNull();
  });

  it('keeps whole résumé lines within about 1.5k tokens', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `Line ${i}: shipped feature ${i} for the payments platform.`);
    const pack = buildContextPack({ resumeText: lines.join('\n'), resumeFilename: 'cv.pdf', now: NOW });

    expect(pack?.resume?.length).toBeLessThanOrEqual(RESUME_CHAR_BUDGET);
    expect(pack?.resume?.startsWith('Line 0: shipped')).toBe(true);
    expect(pack?.resume_filename).toBe('cv.pdf');
    expect(pack?.built_at).toBe(NOW.toISOString());
  });

  it('cuts a résumé stored as one long line at a word boundary', () => {
    const oneLine = 'word '.repeat(3_000).trim(); // parsed_text can arrive without newlines
    const resume = buildContextPack({ resumeText: oneLine, now: NOW })?.resume ?? '';
    expect(resume.length).toBeLessThanOrEqual(RESUME_CHAR_BUDGET);
    expect(resume.endsWith('word…')).toBe(true);
  });

  it('puts requirement lines of a job description first and drops boilerplate', () => {
    const jd = [
      'About us: we are a fast-growing fintech.',
      'Our office has great coffee.',
      'Requirements:',
      '- 5+ years of experience with TypeScript and Node',
      '- You will own the payments API',
      'Benefits: unlimited PTO and 401(k)',
      'We are an equal opportunity employer.',
    ].join('\n');

    expect(jobKeyLines(jd)).toEqual([
      'Requirements:',
      '- 5+ years of experience with TypeScript and Node',
      '- You will own the payments API',
      'About us: we are a fast-growing fintech.',
      'Our office has great coffee.',
    ]);
    const long = buildContextPack({ jobDescription: `${jd}\n${'Filler line about the team culture.\n'.repeat(500)}`, now: NOW });
    expect(long?.job?.length).toBeLessThanOrEqual(JOB_CHAR_BUDGET);
    expect(long?.job?.startsWith('Requirements:')).toBe(true);
  });

  it('trims budgets exactly on line boundaries', () => {
    expect(trimToBudget(['aaaa', 'bbbb', 'cccc'], 9)).toBe('aaaa\nbbbb');
  });

  it('renders the same text every time for the same pack, and a safe default without one', () => {
    const pack = buildContextPack({
      resumeText: 'Led the payments migration.',
      jobDescription: 'You will own the payments API.',
      company: '  Acme  ',
      role: 'Senior Engineer',
      now: NOW,
    });
    const stored = readContextPack({ context_pack: JSON.parse(JSON.stringify(pack)) });

    expect(renderContextPack(stored)).toBe(renderContextPack(pack));
    expect(renderContextPack(pack)).toBe(
      [
        'CANDIDATE CONTEXT',
        'Interviewing for: Senior Engineer at Acme',
        '\nRésumé:\nLed the payments migration.',
        '\nJob description (key points):\nYou will own the payments API.',
      ].join('\n'),
    );
    expect(renderContextPack(null)).toContain('never invent specifics');
    expect(readContextPack({ context_pack: 'nope' })).toBeNull();
  });
});
