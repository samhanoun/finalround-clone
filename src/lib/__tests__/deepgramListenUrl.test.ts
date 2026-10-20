import { buildDeepgramListenUrl } from '@/lib/stt/deepgramListenUrl';

describe('buildDeepgramListenUrl', () => {
  it('asks for two-channel 16 kHz PCM with interim results and end-of-speech events', () => {
    const url = new URL(buildDeepgramListenUrl());

    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('wss://api.deepgram.com/v1/listen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model: 'nova-3',
      language: 'en',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '2',
      multichannel: 'true',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
      vad_events: 'true',
    });
  });

  it('uses the configured model and language', () => {
    const url = new URL(buildDeepgramListenUrl({ model: 'nova-3-general', language: 'multi' }));
    expect(url.searchParams.get('model')).toBe('nova-3-general');
    expect(url.searchParams.get('language')).toBe('multi');
  });
});
