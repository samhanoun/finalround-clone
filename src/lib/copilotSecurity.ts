const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const REDACTION_RULES: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[REDACTED_EMAIL]' },
  { name: 'credit_card', pattern: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[REDACTED_CARD]' },
  {
    name: 'phone',
    pattern: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b/g,
    replacement: '[REDACTED_PHONE]',
  },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { name: 'api_key', pattern: /\b(?:sk|pk)_[A-Za-z0-9]{16,}\b/g, replacement: '[REDACTED_API_KEY]' },
  { name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
];

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?/i,
  /reveal\s+(?:the\s+)?(?:system|developer)\s+prompt/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+/i,
  /jailbreak|do\s+anything\s+now|\bdan\b/i,
  /bypass\s+(?:guardrails|safety|policy)/i,
  /tool\s+call|function\s+call/i,
];

/**
 * Unambiguous attempts to give the model instructions. Narrower than
 * PROMPT_INJECTION_PATTERNS, which would drop real résumé lines such as
 * "Act as liaison…", "reduced function call overhead" or the name "Dan".
 */
const INSTRUCTION_INJECTION_PATTERNS: RegExp[] = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|rules|prompts?)/i,
  /\b(?:reveal|print|show|repeat)\s+(?:the\s+|your\s+)?(?:system|developer|hidden)\s+(?:prompt|instructions?|message)/i,
  /\byou\s+are\s+now\s+(?:a|an|in|the)\b/i,
  /\b(?:new|updated|override)\s+(?:system\s+)?instructions?\s*:/i,
  /\b(?:jailbreak|do\s+anything\s+now)\b/i,
  /\bbypass\s+(?:the\s+)?(?:guardrails|safety|policy|filters)\b/i,
  /<\/?\s*(?:system|instructions?)\s*>/i,
];

export type ScreenedReferenceText = { text: string; droppedLines: number; redactions: string[] };

/**
 * Screens text the user pastes as reference (résumé, job description) before
 * it goes into a prompt: removes control characters, redacts contact and
 * secret patterns line by line, and drops lines that try to instruct the model.
 */
export function screenReferenceText(input: string): ScreenedReferenceText {
  const redactions = new Set<string>();
  let droppedLines = 0;
  const kept: string[] = [];

  for (const rawLine of input.replace(/\r\n?/g, '\n').split('\n')) {
    let line = rawLine.replace(CONTROL_CHARS, '');
    if (INSTRUCTION_INJECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      droppedLines += 1;
      continue;
    }
    for (const rule of REDACTION_RULES) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(line)) redactions.add(rule.name);
      rule.pattern.lastIndex = 0;
      line = line.replace(rule.pattern, rule.replacement);
    }
    kept.push(line);
  }

  return { text: kept.join('\n'), droppedLines, redactions: Array.from(redactions) };
}

export interface SanitizedCopilotText {
  sanitized: string;
  redactions: string[];
  hasPromptInjection: boolean;
}

export function sanitizeCopilotText(input: string): SanitizedCopilotText {
  let sanitized = input.replace(CONTROL_CHARS, '').trim();
  const redactions = new Set<string>();

  for (const rule of REDACTION_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(sanitized)) {
      redactions.add(rule.name);
    }
    rule.pattern.lastIndex = 0;
    sanitized = sanitized.replace(rule.pattern, rule.replacement);
  }

  const hasPromptInjection = PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(sanitized));

  if (sanitized.length > 4000) {
    sanitized = `${sanitized.slice(0, 4000)}…`;
  }

  return {
    sanitized,
    redactions: Array.from(redactions),
    hasPromptInjection,
  };
}
