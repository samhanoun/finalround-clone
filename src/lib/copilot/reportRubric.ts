/**
 * The live session report's rubric: the six areas the summarize prompt asks
 * for, the normalizer keeps (src/lib/mockInterviewReport.ts) and Past sessions
 * shows, from this one list. No dependencies, so the browser imports it too.
 */
export const LIVE_RUBRIC_KEYS = ['communication', 'technical_accuracy', 'problem_solving', 'structure', 'ownership', 'role_fit'] as const;
export type LiveRubricKey = (typeof LIVE_RUBRIC_KEYS)[number];

export const HIRING_SIGNALS = ['strong_no_hire', 'no_hire', 'lean_no_hire', 'lean_hire', 'hire', 'strong_hire'] as const;
export type HiringSignal = (typeof HIRING_SIGNALS)[number];
