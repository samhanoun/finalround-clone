import { splitCodeFences } from '@/lib/copilot/answerText';

describe('splitCodeFences', () => {
  it('returns plain answers as one text segment', () => {
    expect(splitCodeFences('I led the migration.\n- Cut latency 40%')).toEqual([
      { kind: 'text', text: 'I led the migration.\n- Cut latency 40%' },
    ]);
  });

  it('splits prose and a closed code block', () => {
    const text = 'Use two pointers.\n```Python\ndef two_sum(nums, target):\n    return []\n```\nComplexity: O(n) time.';
    expect(splitCodeFences(text)).toEqual([
      { kind: 'text', text: 'Use two pointers.' },
      { kind: 'code', lang: 'python', code: 'def two_sum(nums, target):\n    return []', open: false },
      { kind: 'text', text: 'Complexity: O(n) time.' },
    ]);
  });

  it('treats an unclosed fence as code still streaming', () => {
    expect(splitCodeFences('Approach:\n```go\nfunc main() {')).toEqual([
      { kind: 'text', text: 'Approach:' },
      { kind: 'code', lang: 'go', code: 'func main() {', open: true },
    ]);
  });

  it('keeps fence-looking text inside code, and needs a bare fence to close', () => {
    const text = '```\nconst s = "```js";\n```';
    expect(splitCodeFences(text)).toEqual([{ kind: 'code', lang: '', code: 'const s = "```js";', open: false }]);
  });

  it('returns nothing for empty text', () => {
    expect(splitCodeFences('')).toEqual([]);
  });
});
