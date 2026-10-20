/**
 * Context pack: what the answer model knows about the candidate and the job.
 *
 * Built once when a copilot session starts and stored in
 * `copilot_sessions.metadata.context_pack`. The answer route renders it into
 * the system prompt the same way every time, so the prompt prefix stays
 * identical across questions and providers can cache it.
 */

export type ContextPack = {
  version: 1;
  built_at: string;
  company?: string;
  role?: string;
  resume_filename?: string;
  /** Résumé text, trimmed to about 1.5k tokens. */
  resume?: string;
  /** The job description's most relevant lines, trimmed to about 750 tokens. */
  job?: string;
};

export type ContextPackInput = {
  resumeText?: string | null;
  resumeFilename?: string | null;
  jobDescription?: string | null;
  company?: string | null;
  role?: string | null;
  now?: Date;
};

/** ~4 characters per token. */
export const RESUME_CHAR_BUDGET = 6_000;
export const JOB_CHAR_BUDGET = 3_000;

/** Lines that say what the job needs, kept first when the description is long. */
const JOB_SIGNAL =
  /\b(require|requirement|responsib|qualif|experience|years|skills?|you will|you'll|you have|must|nice to have|bonus|preferred|stack|technolog|proficien|knowledge of|familiar|own|lead|build|design|ship)/i;
/** Boilerplate that rarely helps an answer. */
const JOB_NOISE =
  /\b(equal opportunity|eeo|benefits|perks|401\(?k\)?|pto|paid time off|salary range|compensation|visa sponsorship|accommodation|privacy|apply now|how to apply)\b/i;

function cleanLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean);
}

/** Keeps whole lines up to the budget; cuts the last one at a word boundary if needed. */
export function trimToBudget(lines: string[], budget: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = line.length + (kept.length > 0 ? 1 : 0);
    if (used + cost <= budget) {
      kept.push(line);
      used += cost;
      continue;
    }
    const room = budget - used - (kept.length > 0 ? 1 : 0) - 1;
    if (room > 40) {
      const cut = line.slice(0, room);
      kept.push(`${cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))}…`);
    }
    break;
  }
  return kept.join('\n');
}

/** Requirement-like lines first (in their original order), then the rest, minus boilerplate. */
export function jobKeyLines(jobDescription: string): string[] {
  const lines = cleanLines(jobDescription).filter((line) => !JOB_NOISE.test(line));
  const signal = lines.filter((line) => JOB_SIGNAL.test(line));
  const rest = lines.filter((line) => !JOB_SIGNAL.test(line));
  return [...signal, ...rest];
}

function clip(value: string | null | undefined, max: number): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function buildContextPack(input: ContextPackInput): ContextPack | null {
  const resume = input.resumeText ? trimToBudget(cleanLines(input.resumeText), RESUME_CHAR_BUDGET) : '';
  const job = input.jobDescription ? trimToBudget(jobKeyLines(input.jobDescription), JOB_CHAR_BUDGET) : '';
  const company = clip(input.company, 120);
  const role = clip(input.role, 120);
  if (!resume && !job && !company && !role) return null;

  return {
    version: 1,
    built_at: (input.now ?? new Date()).toISOString(),
    ...(company ? { company } : {}),
    ...(role ? { role } : {}),
    ...(resume ? { resume, resume_filename: clip(input.resumeFilename, 200) } : {}),
    ...(job ? { job } : {}),
  };
}

/** Reads a stored pack defensively (metadata is plain JSON). */
export function readContextPack(metadata: Record<string, unknown> | null | undefined): ContextPack | null {
  const raw = metadata?.context_pack;
  if (!raw || typeof raw !== 'object') return null;
  const pack = raw as Record<string, unknown>;
  const text = (key: string) => (typeof pack[key] === 'string' ? (pack[key] as string) : undefined);
  return {
    version: 1,
    built_at: text('built_at') ?? '',
    company: text('company'),
    role: text('role'),
    resume_filename: text('resume_filename'),
    resume: text('resume'),
    job: text('job'),
  };
}

/** The candidate context block of the system prompt. Deterministic for a given pack. */
export function renderContextPack(pack: ContextPack | null): string {
  if (!pack || (!pack.resume && !pack.job && !pack.company && !pack.role)) {
    return [
      'CANDIDATE CONTEXT',
      'No résumé or job description was provided for this session.',
      'Keep examples general and never invent specifics; where a real example would help, say so briefly.',
    ].join('\n');
  }
  const target = [pack.role, pack.company && `at ${pack.company}`].filter(Boolean).join(' ');
  return [
    'CANDIDATE CONTEXT',
    target ? `Interviewing for: ${target}` : null,
    pack.resume ? `\nRésumé:\n${pack.resume}` : '\nRésumé: not provided.',
    pack.job ? `\nJob description (key points):\n${pack.job}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join('\n');
}
