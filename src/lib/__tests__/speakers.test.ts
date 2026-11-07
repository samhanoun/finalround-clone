import { SpeakerResolver } from '@/lib/stt/speakers';
import { voiceprint } from '@/lib/stt/voiceprint';
import { ON_THE_PHONE, THEM, YOU, speak } from '../../../test/syntheticVoice';

const SAMPLE = voiceprint(speak(YOU, 8, 1))!;

describe('SpeakerResolver', () => {
  it('treats everyone as the interviewer until there is a voice sample', () => {
    const speakers = new SpeakerResolver();
    speakers.addSpeech(0, speak(YOU, 3, 2));
    expect(speakers.role(0)).toBe('interviewer');
  });

  it('tells the candidate from the interviewer by the sample', () => {
    const speakers = new SpeakerResolver();
    speakers.setSample(SAMPLE);
    speakers.addSpeech(0, speak(THEM, 3, 3));
    speakers.addSpeech(1, speak(YOU, 3, 4));
    expect(speakers.role(0)).toBe('interviewer');
    expect(speakers.role(1)).toBe('candidate');
  });

  it('decides with one voice heard so far, and from interim audio before any final', () => {
    const speakers = new SpeakerResolver();
    speakers.setSample(SAMPLE);
    speakers.addSpeech(0, speak(ON_THE_PHONE, 3, 5));
    expect(speakers.role(0)).toBe('interviewer');
    // Speaker 1 hasn't had a final yet: its interim audio is enough.
    expect(speakers.role(1, { pending: speak(YOU, 3, 6) })).toBe('candidate');
    expect(speakers.role(1)).toBe('interviewer'); // nothing kept from the guess
  });

  it('waits for enough speech before comparing', () => {
    const speakers = new SpeakerResolver();
    speakers.setSample(SAMPLE);
    speakers.addSpeech(0, speak(YOU, 0.5, 7));
    expect(speakers.role(0)).toBe('interviewer');
    speakers.addSpeech(0, speak(YOU, 3, 8));
    expect(speakers.role(0)).toBe('candidate');
  });

  it('knows whoever speaks while the sample is being recorded is the candidate', () => {
    const speakers = new SpeakerResolver();
    speakers.startCalibration(1_000);
    expect(speakers.role(2, { atMs: 1_500 })).toBe('candidate');
    speakers.addSpeech(2, speak(YOU, 2, 9), 1_500);
    speakers.finishCalibration(9_000, SAMPLE);
    speakers.addSpeech(0, speak(YOU, 3, 10), 12_000);
    // Speaker 2 was heard during the sample; on this connection everyone else is the interviewer.
    expect(speakers.role(2, { atMs: 12_000 })).toBe('candidate');
    expect(speakers.role(0, { atMs: 12_000 })).toBe('interviewer');
  });

  it('forgets speaker numbers on reconnect, but keeps the sample', () => {
    const speakers = new SpeakerResolver();
    speakers.setSample(SAMPLE);
    speakers.addSpeech(0, speak(YOU, 3, 11));
    expect(speakers.role(0)).toBe('candidate');
    speakers.reset();
    expect(speakers.role(0)).toBe('interviewer');
    speakers.addSpeech(0, speak(THEM, 3, 12));
    expect(speakers.role(0)).toBe('interviewer');
    expect(speakers.hasSample()).toBe(true);
  });
});
