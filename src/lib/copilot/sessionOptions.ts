/** Per-session choices in the live copilot's setup (safe to import in the browser). */

export { SPOKEN_LANGUAGES, isSpokenLanguage, type SpokenLanguage } from '@/lib/stt/sessionStt';

export const CODING_LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'java',
  'cpp',
  'csharp',
  'go',
  'rust',
  'kotlin',
  'swift',
  'ruby',
  'sql',
] as const;
export type CodingLanguage = (typeof CODING_LANGUAGES)[number];

/** The name the model and the code panel use. */
export const CODING_LANGUAGE_NAME: Record<CodingLanguage, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  java: 'Java',
  cpp: 'C++',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ruby: 'Ruby',
  sql: 'SQL',
};

export function isCodingLanguage(value: unknown): value is CodingLanguage {
  return typeof value === 'string' && (CODING_LANGUAGES as readonly string[]).includes(value);
}
