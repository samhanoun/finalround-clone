import { chunkText, renderRetrieved, retrieve, sourceList, tokenize, type Chunk } from '@/lib/copilot/retrieval';

describe('tokenize', () => {
  it('keeps meaningful words, including C++ and C#, and drops filler', () => {
    expect(tokenize('Tell me about a time you used C++ and C# at Stripe.')).toEqual(['used', 'c++', 'c#', 'stripe']);
    expect(tokenize('Migración de pagos')).toEqual(['migracion', 'pagos']);
  });
});

describe('chunkText', () => {
  it('splits on sentences into passages with a little overlap', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} talks about topic ${i + 1} in some detail here.`).join(' ');
    const chunks = chunkText(text, { idPrefix: 'material:1', source: 'Notes', kind: 'material' }, 40);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]).toMatchObject({ id: 'material:1#1', source: 'Notes', kind: 'material' });
    // The last sentence of a passage starts the next one.
    const lastOfFirst = chunks[0].text.split('. ').pop() as string;
    expect(chunks[1].text.startsWith(lastOfFirst.replace(/\.$/, ''))).toBe(true);
  });
});

describe('retrieve', () => {
  const chunks: Chunk[] = [
    { id: 'resume#1', source: 'Résumé', kind: 'resume', text: 'Led the payments migration at Stripe, cutting checkout latency by 40%.' },
    { id: 'resume#2', source: 'Résumé', kind: 'resume', text: 'Mentored four engineers and ran the on-call rotation.' },
    { id: 'material:a#1', source: 'Kafka project notes', kind: 'material', text: 'Designed a Kafka event pipeline handling 2 million events per day with exactly-once delivery.' },
    { id: 'memory:x', source: 'Memory', kind: 'memory', text: 'Prefers to explain trade-offs with latency numbers.' },
  ];

  it('finds the passages that match the question', () => {
    const hits = retrieve('How did you design the event pipeline with Kafka?', chunks, 2);
    expect(hits[0].id).toBe('material:a#1');
    expect(hits.every((hit) => hit.score > 0)).toBe(true);
  });

  it('returns nothing for an unrelated question', () => {
    expect(retrieve('What is your favourite colour?', chunks)).toEqual([]);
  });

  it('renders numbered sources for the prompt and the answer', () => {
    const hits = retrieve('payments latency at Stripe', chunks, 2);
    expect(renderRetrieved(hits)).toContain('[S1] (Résumé) Led the payments migration');
    expect(sourceList(hits)[0]).toEqual({ tag: 'S1', source: 'Résumé', kind: 'resume' });
    expect(renderRetrieved([])).toBeNull();
  });
});
