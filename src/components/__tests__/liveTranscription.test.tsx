import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { AudioSourcesPanel } from '@/components/copilot/AudioSourcesPanel';
import type { AudioCapture } from '@/components/copilot/useAudioCapture';
import type { LiveTranscription } from '@/components/copilot/useLiveTranscription';
import type { VoiceSample } from '@/components/copilot/useVoiceSample';
import { SpeakerResolver } from '@/lib/stt/speakers';
import { sttStreamUrl } from '@/lib/stt/relayProtocol';

function capture(status: AudioCapture['status']): AudioCapture {
  return {
    status,
    error: null,
    ended: null,
    start: jest.fn(),
    stop: jest.fn(),
    subscribeFrames: jest.fn(() => () => undefined),
    subscribeLevels: jest.fn(() => () => undefined),
    getDisplayVideoTrack: jest.fn(() => null),
  };
}

function transcription(partial: Partial<LiveTranscription> = {}): LiveTranscription {
  return { status: 'live', error: null, errorCode: null, captions: { candidate: '', interviewer: '' }, ...partial };
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
        transcription={transcription({ status: 'error', error: 'quota', errorCode: 'quotaExceeded' })}
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

describe('AudioSourcesPanel in phone / in-person mode', () => {
  function voiceSample(partial: Partial<VoiceSample> = {}): VoiceSample {
    return {
      state: 'none',
      progress: 0,
      tooQuiet: false,
      record: jest.fn(),
      cancel: jest.fn(),
      forget: jest.fn(),
      resolver: new SpeakerResolver(),
      ...partial,
    };
  }

  it('shows one microphone, no share steps, and asks for a voice sample once listening', () => {
    const sample = voiceSample();
    const { rerender } = render(
      <AudioSourcesPanel capture={capture('idle')} transcription={transcription()} disabled={false} voiceSample={sample} />,
    );
    expect(screen.getByRole('meter', { name: 'Microphone (both of you) level' })).toBeInTheDocument();
    expect(screen.queryByRole('meter', { name: 'Interviewer (shared audio) level' })).not.toBeInTheDocument();
    expect(screen.getByText(/Put your phone on speaker/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record my voice' })).toBeDisabled();

    rerender(<AudioSourcesPanel capture={capture('live')} transcription={transcription()} disabled={false} voiceSample={sample} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record my voice' }));
    expect(sample.record).toHaveBeenCalled();
  });

  it('shows the sentence to read while recording, and the saved state after', () => {
    const { rerender } = render(
      <AudioSourcesPanel
        capture={capture('live')}
        transcription={transcription()}
        disabled={false}
        voiceSample={voiceSample({ state: 'recording', progress: 0.4 })}
      />,
    );
    expect(screen.getByText(/I am getting ready for my interview today/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Recording your voice sample' })).toHaveAttribute('aria-valuenow', '40');

    const forget = jest.fn();
    rerender(
      <AudioSourcesPanel
        capture={capture('live')}
        transcription={transcription()}
        disabled={false}
        voiceSample={voiceSample({ state: 'ready', forget })}
      />,
    );
    expect(screen.getByText(/Saved in this browser/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Forget my voice' }));
    expect(forget).toHaveBeenCalled();
  });
});

describe('sttStreamUrl', () => {
  it('points at the relay on the same host as the page, with wss on https', () => {
    expect(sttStreamUrl('abc', { protocol: 'https:', host: 'app.example.com' })).toBe('wss://app.example.com/api/stt/stream?session=abc');
    expect(sttStreamUrl('abc', { protocol: 'http:', host: 'localhost:3000' })).toBe('ws://localhost:3000/api/stt/stream?session=abc');
  });

  it('encodes the session id', () => {
    expect(sttStreamUrl('a b&c', { protocol: 'http:', host: 'h' })).toBe('ws://h/api/stt/stream?session=a%20b%26c');
  });
});
