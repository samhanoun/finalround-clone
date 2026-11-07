/**
 * Syntax highlighting for code in answers: a small tokenizer for the
 * languages interviews use (no highlighting library to download). It only
 * colours keywords, strings, comments, numbers, types and calls; the text is
 * never changed, so copying the code gives exactly what the model wrote.
 */

export type TokenType = 'keyword' | 'string' | 'comment' | 'number' | 'type' | 'function' | 'plain';
export type Token = { type: TokenType; text: string };

type LanguageRules = {
  keywords: Set<string>;
  lineComment: string[];
  blockComment: [string, string] | null;
  /** Python and Ruby: # comments; SQL: -- comments. */
  caseInsensitive?: boolean;
};

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));

const C_LIKE = 'if else for while do switch case break continue return default new delete try catch finally throw class struct enum public private protected static const void true false null this super import package';
const RULES: Record<string, LanguageRules> = {
  python: {
    keywords: words('def class return if elif else for while in not and or is None True False import from as with try except finally raise lambda yield pass break continue global nonlocal assert async await self del'),
    lineComment: ['#'],
    blockComment: null,
  },
  javascript: {
    keywords: words(`${C_LIKE} function let var const async await yield typeof instanceof of in export from undefined extends implements interface type readonly`),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  java: {
    keywords: words(`${C_LIKE} int long double float boolean char byte short final abstract interface extends implements instanceof synchronized var record`),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  cpp: {
    keywords: words(`${C_LIKE} int long double float bool char auto unsigned signed template typename namespace using std vector string map unordered_map nullptr virtual override inline constexpr`),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  csharp: {
    keywords: words(`${C_LIKE} int long double float bool char string var using namespace readonly override virtual async await foreach in out ref is as`),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  go: {
    keywords: words('func package import var const type struct interface map chan go defer select range return if else for switch case default break continue fallthrough nil true false make len append'),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  rust: {
    keywords: words('fn let mut pub struct enum impl trait use mod crate self Self match if else for while loop in return break continue as ref move where unsafe async await dyn Some None Ok Err true false'),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  kotlin: {
    keywords: words('fun val var class object interface data sealed when if else for while in is as return break continue null true false import package private public override open suspend'),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  swift: {
    keywords: words('func let var class struct enum protocol extension if else guard for while in return break continue switch case default nil true false import self init throws try catch'),
    lineComment: ['//'],
    blockComment: ['/*', '*/'],
  },
  ruby: {
    keywords: words('def end class module if elsif else unless while until for in do return yield nil true false self require attr_accessor each map'),
    lineComment: ['#'],
    blockComment: null,
  },
  sql: {
    keywords: words('select from where join left right inner outer on group by order having limit offset insert into values update set delete create table index as and or not null is in exists distinct count sum avg min max case when then else end with union all'),
    lineComment: ['--'],
    blockComment: ['/*', '*/'],
    caseInsensitive: true,
  },
};

const ALIASES: Record<string, string> = {
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  typescript: 'javascript',
  'c++': 'cpp',
  c: 'cpp',
  cc: 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  rs: 'rust',
  kt: 'kotlin',
  rb: 'ruby',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
};

export function languageRules(lang: string | undefined): LanguageRules {
  const key = (lang ?? '').toLowerCase();
  return RULES[ALIASES[key] ?? key] ?? RULES.javascript;
}

export function tokenizeCode(code: string, lang?: string): Token[] {
  const rules = languageRules(lang);
  const tokens: Token[] = [];
  const push = (type: TokenType, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.type === type && type === 'plain') last.text += text;
    else tokens.push({ type, text });
  };
  let i = 0;
  while (i < code.length) {
    const rest = code.slice(i);
    const lineComment = rules.lineComment.find((marker) => rest.startsWith(marker));
    if (lineComment) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? code.length : end;
      push('comment', code.slice(i, stop));
      i = stop;
      continue;
    }
    if (rules.blockComment && rest.startsWith(rules.blockComment[0])) {
      const end = code.indexOf(rules.blockComment[1], i + rules.blockComment[0].length);
      const stop = end === -1 ? code.length : end + rules.blockComment[1].length;
      push('comment', code.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const triple = (ch === '"' || ch === "'") && rest.startsWith(ch.repeat(3)) ? ch.repeat(3) : ch;
      let j = i + triple.length;
      while (j < code.length && !code.startsWith(triple, j)) {
        if (code[j] === '\\') j += 1;
        else if (code[j] === '\n' && triple === ch && ch !== '`') break;
        j += 1;
      }
      const stop = Math.min(code.length, j + (code.startsWith(triple, j) ? triple.length : 0));
      push('string', code.slice(i, stop));
      i = stop;
      continue;
    }
    if (/[0-9]/.test(ch) && !/[A-Za-z_]/.test(code[i - 1] ?? '')) {
      const match = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/.exec(rest);
      if (match) {
        push('number', match[0]);
        i += match[0].length;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(rest)?.[0] ?? ch;
      const lookup = rules.caseInsensitive ? word.toLowerCase() : word;
      if (rules.keywords.has(lookup)) push('keyword', word);
      else if (/^\s*\(/.test(code.slice(i + word.length))) push('function', word);
      else if (/^[A-Z][a-z0-9]/.test(word)) push('type', word);
      else push('plain', word);
      i += word.length;
      continue;
    }
    push('plain', ch);
    i += 1;
  }
  return tokens;
}
