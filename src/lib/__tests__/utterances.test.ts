import type { TranscriptResult } from '@/lib/stt/deepgramLive';
import { UtteranceAssembler, type Utterance } from '@/lib/stt/utterances';

function piece(partial: Partial<TranscriptResult> & Pick<TranscriptResult, 'text'>): TranscriptResult {
  return {
    role: 'interviewer',
    isFinal: true,
    speechFinal: false,
    startSec: 0,
    endSec: 1,
    confidence: 0.9,
    receivedAt: 1000,
    ...partial,
  };
}

function setup() {
  const utterances: Utterance[] = [];
  const assembler = new UtteranceAssembler((u) => utterances.push(u));
  return { assembler, utterances };
}

describe('UtteranceAssembler', () => {
  it('joins final pieces into one utterance that closes on speech_final', () => {
    const { assembler, utterances } = setup();
    assembler.push(piece({ text: 'So tell me', startSec: 2, endSec: 3, endedAt: 1_003_000 }));
    assembler.push(
      piece({ text: 'about a project you led.', startSec: 3, endSec: 4.5, endedAt: 1_004_500, speechFinal: true, receivedAt: 5 }),
    );

    expect(utterances).toEqual([
      {
        role: 'interviewer',
        text: 'So tell me about a project you led.',
        startSec: 2,
        endSec: 4.5,
        completedAt: 5,
        speechEndedAt: 1_004_500,
      },
    ]);
  });

  it('shows interim words as live text without committing them', () => {
    const { assembler, utterances } = setup();
    assembler.push(piece({ text: 'Walk me', startSec: 0, endSec: 1 }));
    assembler.push(piece({ text: 'through your', isFinal: false }));

    expect(assembler.liveText('interviewer')).toBe('Walk me through your');
    expect(assembler.liveText('candidate')).toBe('');
    expect(utterances).toHaveLength(0);
  });

  it('keeps speakers separate', () => {
    const { assembler, utterances } = setup();
    assembler.push(piece({ role: 'interviewer', text: 'Why this company?' }));
    assembler.push(piece({ role: 'candidate', text: 'Well,', speechFinal: true }));
    assembler.push(piece({ role: 'interviewer', text: 'And why now?', speechFinal: true }));

    expect(utterances.map((u) => [u.role, u.text])).toEqual([
      ['candidate', 'Well,'],
      ['interviewer', 'Why this company? And why now?'],
    ]);
  });

  it('closes on UtteranceEnd when Deepgram never flagged speech_final', () => {
    const { assembler, utterances } = setup();
    assembler.push(piece({ text: 'How do you handle conflict?' }));
    assembler.endOfUtterance('interviewer', 9);

    expect(utterances.map((u) => [u.text, u.completedAt])).toEqual([['How do you handle conflict?', 9]]);
  });

  it('waits for the last final when UtteranceEnd beats it', () => {
    const { assembler, utterances } = setup();
    assembler.push(piece({ text: 'Any questions', isFinal: false }));
    assembler.endOfUtterance('interviewer', 9);
    expect(utterances).toHaveLength(0);

    assembler.push(piece({ text: 'Any questions for me?' }));
    expect(utterances.map((u) => u.text)).toEqual(['Any questions for me?']);
  });

  it('ignores empty finals and repeated end signals', () => {
    const { assembler, utterances } = setup();
    assembler.push(piece({ text: '', speechFinal: true }));
    assembler.endOfUtterance('interviewer', 1);
    assembler.push(piece({ text: 'Great.', speechFinal: true }));
    assembler.endOfUtterance('interviewer', 2);

    expect(utterances.map((u) => u.text)).toEqual(['Great.']);
  });

  it('commits final words on flush and drops unfinished interim ones', () => {
    const { assembler, utterances } = setup();
    assembler.push(piece({ text: 'Thanks for', role: 'candidate' }));
    assembler.push(piece({ text: 'your ti', role: 'candidate', isFinal: false }));
    assembler.flush(42);

    expect(utterances).toEqual([expect.objectContaining({ role: 'candidate', text: 'Thanks for', completedAt: 42 })]);
    expect(assembler.liveText('candidate')).toBe('');
  });
});
