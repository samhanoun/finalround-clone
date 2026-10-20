import { render, screen } from '@testing-library/react';
import React from 'react';
import { AudioSourcesPanel } from '@/components/copilot/AudioSourcesPanel';
import type { AudioCapture } from '@/components/copilot/useAudioCapture';
import { fetchSttToken, type LiveTranscription } from '@/components/copilot/useLiveTranscription';
import { SttTokenError } from '@/lib/stt/deepgramLive';

function capture(status: AudioCapture['status']): AudioCapture {
  return {
    status,
    error: null,
    start: jest.fn(),
    stop: jest.fn(),
    subscribeFrames: jest.fn(() => () => undefined),
    subscribeLevels: jest.fn(() => () => undefined),
    getDisplayVideoTrack: jest.fn(() => null),
  };
}

function transcription(partial: Partial<LiveTranscription> = {}): LiveTranscription {
  return { status: 'live', error: null, captions: { candidate: '', interviewer: '' }, ...partial };
}

describe('AudioSourcesPanel with live transcription', () => {
  it('shows the transcription state and what each speaker is saying', () => {
    render(
      <AudioSourcesPanel
        capture={capture('live')}
        transcription={transcription({ captions: { interviewer: 'Walk me through your', candidate: '' } })}
        disabled={false}
      />,
    );

    expect(screen.getByText('Transcribing')).toBeInTheDocument();
    expect(screen.getByText('Walk me through your')).toBeInTheDocument();
    expect(screen.getByLabelText('Live captions')).toHaveTextContent('You…');
  });

  it('shows reconnects and transcription errors', () => {
    const { rerender } = render(
      <AudioSourcesPanel capture={capture('live')} transcription={transcription({ status: 'reconnecting' })} disabled={false} />,
    );
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();

    rerender(
      <AudioSourcesPanel
        capture={capture('live')}
        transcription={transcription({ status: 'error', error: 'You have used all your copilot minutes for now.' })}
        disabled={false}
      />,
    );
    expect(screen.getByText('Transcription stopped')).toBeInTheDocument();
    expect(screen.getByText('You have used all your copilot minutes for now.')).toBeInTheDocument();
  });

  it('hides captions until audio is live', () => {
    render(<AudioSourcesPanel capture={capture('idle')} transcription={transcription()} disabled={false} />);
    expect(screen.queryByLabelText('Live captions')).not.toBeInTheDocument();
    expect(screen.queryByText('Transcribing')).not.toBeInTheDocument();
  });
});

describe('fetchSttToken', () => {
  function respond(status: number, body: unknown) {
    global.fetch = jest.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body }) as unknown as typeof fetch;
  }

  async function failure(): Promise<SttTokenError> {
    try {
      await fetchSttToken('session-1');
    } catch (e) {
      return e as SttTokenError;
    }
    throw new Error('expected fetchSttToken to fail');
  }

  it('returns the token and listen URL', async () => {
    respond(200, { token: 't', listenUrl: 'wss://x', expiresIn: 30 });
    await expect(fetchSttToken('session-1')).resolves.toEqual({ token: 't', listenUrl: 'wss://x', expiresIn: 30 });
    expect(global.fetch).toHaveBeenCalledWith('/api/stt/token', expect.objectContaining({ method: 'POST', body: '{"sessionId":"session-1"}' }));
  });

  it('gives up with a readable message on permanent errors', async () => {
    respond(503, { error: 'stt_not_configured' });
    const error = await failure();
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/DEEPGRAM_API_KEY/);

    respond(403, { error: 'quota_exceeded' });
    expect((await failure()).retryable).toBe(false);
  });

  it('retries on rate limits, server errors and network failures', async () => {
    respond(429, { error: 'rate_limited' });
    expect((await failure()).retryable).toBe(true);

    respond(502, { error: 'stt_token_failed' });
    expect((await failure()).retryable).toBe(true);

    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    expect((await failure()).retryable).toBe(true);
  });
});
