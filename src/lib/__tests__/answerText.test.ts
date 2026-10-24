import { splitBullets, splitCodeFences } from '@/lib/copilot/answerText';

describe('splitBullets', () => {
  it('groups consecutive bullet lines and keeps other lines apart', () => {
    expect(splitBullets('I led the migration.\n- Situation: slow checkout\n* Action: staged cut-over\n• Result: 40% faster\nHappy to go deeper.')).toEqual([
      { kind: 'line', text: 'I led the migration.' },
      { kind: 'points', items: ['Situation: slow checkout', 'Action: staged cut-over', 'Result: 40% faster'] },
      { kind: 'line', text: 'Happy to go deeper.' },
    ]);
  });

  it('drops blank lines and keeps a dash that is not a bullet', () => {
    expect(splitBullets('\nO(n) - linear\n\n-not a bullet')).toEqual([
      { kind: 'line', text: 'O(n) - linear' },
      { kind: 'line', text: '-not a bullet' },
    ]);
  });
});

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
