import { parseTailoredResume, tailoredResumeRequest, TASK_TAILORED_RESUME } from '@/lib/tailoredResume';

const RESUME = 'Jane Doe\njane@example.com\n\nEXPERIENCE\nStripe, Senior Engineer\n- Led the payments migration';

describe('tailoredResumeRequest', () => {
  it('names the task and keeps the résumé as written, contact details included', () => {
    const request = tailoredResumeRequest({ resumeText: `${RESUME}\u0007`, jobDescription: 'Staff Engineer at Acme. Payments.' });
    expect(request.system[0]).toContain(TASK_TAILORED_RESUME);
    expect(request.system[0]).toMatch(/never add employers/);
    const content = request.messages[0].content as string;
    expect(content).toContain('jane@example.com');
    expect(content).toContain('Staff Engineer at Acme');
    expect(content).not.toContain('\u0007');
  });
});

describe('parseTailoredResume', () => {
  it('reads the JSON, even wrapped in prose', () => {
    const reply = `Here you go:\n${JSON.stringify({
      target: 'Staff Engineer at Acme',
      summary: 'Leads with payments.',
      changes: ['Moved payments up', 3, ''],
      keywords: ['payments'],
      resume: `${RESUME}\n- Mentored four engineers`,
    })}`;
    expect(parseTailoredResume(reply)).toEqual({
      target: 'Staff Engineer at Acme',
      summary: 'Leads with payments.',
      changes: ['Moved payments up'],
      keywords: ['payments'],
      resume: `${RESUME}\n- Mentored four engineers`,
    });
  });

  it('refuses a reply without a résumé', () => {
    expect(parseTailoredResume('{"summary":"x","resume":"short"}')).toBeNull();
    expect(parseTailoredResume('not json')).toBeNull();
  });
});
