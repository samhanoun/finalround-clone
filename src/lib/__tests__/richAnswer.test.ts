import { tokenizeCode } from '@/lib/copilot/highlight';
import { layoutDiagram, parseDiagram } from '@/lib/copilot/diagram';
import { addRevision, answerCode, problemKey } from '@/lib/copilot/codeArtifacts';

describe('tokenizeCode', () => {
  it('colours Python keywords, strings, comments, numbers and calls without changing the text', () => {
    const code = 'def two_sum(nums, target):  # O(n)\n    seen = {}\n    return "done" if len(nums) > 0 else None';
    const tokens = tokenizeCode(code, 'python');
    expect(tokens.map((token) => token.text).join('')).toBe(code);
    expect(tokens).toEqual(
      expect.arrayContaining([
        { type: 'keyword', text: 'def' },
        { type: 'function', text: 'two_sum' },
        { type: 'comment', text: '# O(n)' },
        { type: 'string', text: '"done"' },
        { type: 'number', text: '0' },
        { type: 'keyword', text: 'None' },
      ]),
    );
  });

  it('handles C-like comments, aliases and case-insensitive SQL', () => {
    expect(tokenizeCode('/* a */ const x = 1; // b', 'ts').filter((t) => t.type === 'comment').map((t) => t.text)).toEqual(['/* a */', '// b']);
    expect(tokenizeCode('SELECT id FROM users', 'sql').filter((t) => t.type === 'keyword').map((t) => t.text)).toEqual(['SELECT', 'FROM']);
  });
});

describe('diagrams', () => {
  it('parses connections and lays them out in layers', () => {
    const edges = parseDiagram('Client -> API gateway: HTTPS\nAPI gateway -> Orders\n- Orders -> Postgres: writes\nnot an edge\nOrders --> Kafka');
    expect(edges).toEqual([
      { from: 'Client', to: 'API gateway', label: 'HTTPS' },
      { from: 'API gateway', to: 'Orders', label: '' },
      { from: 'Orders', to: 'Postgres', label: 'writes' },
      { from: 'Orders', to: 'Kafka', label: '' },
    ]);
    const layout = layoutDiagram(edges);
    const layer = Object.fromEntries(layout.nodes.map((node) => [node.id, node.layer]));
    expect(layer).toEqual({ Client: 0, 'API gateway': 1, Orders: 2, Postgres: 3, Kafka: 3 });
    expect(layout.rows).toBe(2);
  });

  it('survives cycles', () => {
    const layout = layoutDiagram(parseDiagram('A -> B\nB -> A'));
    expect(layout.nodes).toHaveLength(2);
  });
});

describe('code versions', () => {
  const answer = (code: string) => `Approach: hash map.\n\`\`\`python\n${code}\n\`\`\`\nComplexity: O(n).`;

  it('takes the code blocks of an answer, not its diagram', () => {
    expect(answerCode('```diagram\nA -> B\n```')).toBeNull();
    expect(answerCode(answer('x = 1'))).toEqual({ lang: 'python', code: 'x = 1' });
  });

  it('adds a version per change to the same problem, and a new problem for another question', () => {
    const q = { text: 'Find two numbers that add up to a target.' };
    let artifacts = addRevision([], q, answer('v1()'), 1);
    artifacts = addRevision(artifacts, q, answer('v1()'), 2); // unchanged: no new version
    artifacts = addRevision(artifacts, q, answer('v2()'), 3);
    artifacts = addRevision(artifacts, { text: 'Reverse a linked list.' }, answer('rev()'), 4);
    expect(artifacts.map((a) => [a.title, a.revisions.length])).toEqual([
      ['Reverse a linked list.', 1],
      ['Find two numbers that add up to a target.', 2],
    ]);
    expect(problemKey({ text: 'x', via: 'screen' })).toBe('screen');
  });
});
