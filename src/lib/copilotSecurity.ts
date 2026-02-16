const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const REDACTION_RULES: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[REDACTED_EMAIL]' },
  {
    name: 'phone',
    pattern: /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b/g,
    replacement: '[REDACTED_PHONE]',
  },
  { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { name: 'credit_card', pattern: /\b(?:\d[ -]*?){13,16}\b/g, replacement: '[REDACTED_CARD]' },
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
