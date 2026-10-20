/**
 * Deepgram live-streaming URL for the copilot's two-channel capture.
 *
 * The browser sends interleaved 16 kHz PCM16 (channel 0 = candidate mic,
 * channel 1 = meeting audio), so `multichannel` keeps the speakers apart and
 * every result carries its `channel_index`. Built on the server so model and
 * language stay under our control.
 */

export const DEEPGRAM_LISTEN_ENDPOINT = 'wss://api.deepgram.com/v1/listen';

export type DeepgramListenOptions = {
  /** Tests only: a local fake instead of Deepgram. */
  endpoint?: string;
  model?: string;
  language?: string;
  sampleRate?: number;
  channels?: number;
};

export function buildDeepgramListenUrl({
  endpoint = DEEPGRAM_LISTEN_ENDPOINT,
  model = 'nova-3',
  language = 'en',
  sampleRate = 16000,
  channels = 2,
}: DeepgramListenOptions = {}): string {
  const params = new URLSearchParams({
    model,
    language,
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: String(channels),
    multichannel: 'true',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
    // Deepgram marks `speech_final` after 300 ms of silence...
    endpointing: '300',
    // ...and sends UtteranceEnd after a 1 s gap between words, which still works
    // when background noise keeps its voice-activity detector from firing.
    utterance_end_ms: '1000',
    vad_events: 'true',
  });
  return `${endpoint}?${params.toString()}`;
}
