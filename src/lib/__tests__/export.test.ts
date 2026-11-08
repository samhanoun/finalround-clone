/** @jest-environment jsdom */

// A stand-in for jsPDF that records what is drawn (the real one needs canvas APIs jsdom lacks).
const drawn: Array<{ text: string; x: number; y: number; align?: string }> = [];
const pages: number[] = [];
const saved: string[] = [];
jest.mock('jspdf', () => {
  return jest.fn().mockImplementation(() => ({
    internal: { pageSize: { getWidth: () => 600, getHeight: () => 300 } },
    setTextColor: jest.fn(),
    setDrawColor: jest.fn(),
    setFont: jest.fn(),
    setFontSize: jest.fn(),
    line: jest.fn(),
    splitTextToSize: (text: string) => [text],
    text: (text: string, x: number, y: number, options?: { align?: string }) => drawn.push({ text, x, y, align: options?.align }),
    addPage: () => pages.push(drawn.length),
    save: (name: string) => saved.push(name),
  }));
});

import { columnsOf, exportToPDF } from '@/lib/export';

beforeEach(() => {
  drawn.length = 0;
  pages.length = 0;
  saved.length = 0;
});

describe('exportToPDF', () => {
  it('writes the title, a header and one line per row, as text', () => {
    exportToPDF(
      [
        { Stage: 'Tracked', Jobs: 4 },
        { Stage: 'Applied', Jobs: 2 },
      ],
      'job-search-funnel',
      'Your job search',
    );
    expect(saved).toEqual(['job-search-funnel.pdf']);
    expect(drawn.map((d) => d.text)).toEqual(['Your job search', 'Stage', 'Jobs', 'Tracked', '4', 'Applied', '2']);
    // A column of numbers is right-aligned, its header too; labels aren't.
    expect(drawn.find((d) => d.text === '4')?.align).toBe('right');
    expect(drawn.find((d) => d.text === 'Jobs')?.align).toBe('right');
    expect(drawn.find((d) => d.text === 'Stage')?.align).toBeUndefined();
    expect(drawn.find((d) => d.text === 'Tracked')?.align).toBeUndefined();
  });

  it('runs a long table over pages and repeats the header on each', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ Week: `Week ${i + 1}`, Sessions: i }));
    exportToPDF(rows, 'weekly-activity', 'Week by week');
    expect(pages.length).toBeGreaterThan(0);
    const headers = drawn.filter((d) => d.text === 'Week').length;
    expect(headers).toBe(pages.length + 1);
    expect(drawn.filter((d) => d.text.startsWith('Week ')).length).toBe(30 + 1);
  });

  it('leaves empty cells empty', () => {
    exportToPDF([{ Week: '2026-11-02', Score: null }], 'weekly', 'Weekly');
    expect(drawn.map((d) => d.text)).toEqual(['Weekly', 'Week', 'Score', '2026-11-02', '']);
  });
});

describe('columnsOf', () => {
  it('lists every column once, in first-seen order', () => {
    expect(columnsOf([{ a: 1, b: 2 }, { b: 3, c: 4 }])).toEqual(['a', 'b', 'c']);
  });
});
