// A stand-in for Deepgram's live endpoint. It checks the server's API key and
// measures the audio per channel. It "hears" the scripted question only once
// it has received a second of interviewer audio (channel 1), which proves the
// browser captured the fake microphone and the relay forwarded it.

import http from 'node:http';
import { WebSocketServer } from 'ws';
import config from './config.cjs';

const { INTERIM, KEYS, QUESTION } = config;

const SAMPLE_RATE = 16000;
const SPEECH_RMS = 300; // int16 RMS; the fixture plays well above this
const SPEECH_NEEDED_SAMPLES = SAMPLE_RATE; // one second of interviewer speech

let connections = [];

function results(channel, start, duration, transcript, extra = {}) {
  return JSON.stringify({
    type: 'Results',
    channel_index: [channel, 2],
    start,
    duration,
    is_final: false,
    speech_final: false,
    channel: {
      alternatives: [
        {
          transcript,
          confidence: 0.98,
          words: transcript
            .split(' ')
            .filter(Boolean)
            .map((word, index, all) => {
              const step = duration / Math.max(all.length, 1);
              return { word: word.toLowerCase().replace(/[?.,]/g, ''), punctuated_word: word, start: start + index * step, end: start + (index + 1) * step };
            }),
        },
      ],
    },
    ...extra,
  });
}

export function startFakeDeepgram(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/__state') return res.end(JSON.stringify({ connections }));
    if (url.pathname === '/__reset') {
      connections = [];
      return res.end(JSON.stringify({ ok: true }));
    }
    res.statusCode = 404;
    res.end('{}');
  });

  const wss = new WebSocketServer({
    server,
    path: '/v1/listen',
    verifyClient: ({ req }, done) => {
      // The relay authenticates with our server-side key; browsers never get it.
      if (req.headers.authorization === `Token ${KEYS.deepgram}`) done(true);
      else done(false, 401, 'Unauthorized');
    },
  });

  wss.on('connection', (socket, req) => {
    const conn = {
      url: req.url,
      authorization: req.headers.authorization,
      frames: 0,
      samples: 0,
      interviewerSpeechSamples: 0,
      maxRms: [0, 0],
      controls: [],
      sentQuestion: false,
    };
    connections.push(conn);

    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        let type;
        try {
          type = JSON.parse(data.toString()).type;
        } catch {
          type = 'invalid';
        }
        conn.controls.push(type);
        const now = conn.samples / SAMPLE_RATE;
        if (type === 'Finalize') socket.send(results(1, now, 0, '', { is_final: true, from_finalize: true }));
        if (type === 'CloseStream') {
          socket.send(results(1, now, 0, '', { is_final: true }));
          setTimeout(() => socket.close(1000), 20);
        }
        return;
      }

      // Copy first: ws can hand over a Buffer at an odd offset, which an Int16Array view can't start at.
      const aligned = new Uint8Array(data.byteLength);
      aligned.set(data);
      const pcm = new Int16Array(aligned.buffer);
      const sums = [0, 0];
      for (let i = 0; i < pcm.length; i += 1) sums[i % 2] += pcm[i] * pcm[i];
      const perChannel = pcm.length / 2;
      const rms = sums.map((sum) => Math.sqrt(sum / Math.max(perChannel, 1)));
      conn.frames += 1;
      conn.samples += perChannel;
      conn.maxRms = conn.maxRms.map((max, channel) => Math.max(max, Math.round(rms[channel])));
      if (rms[1] > SPEECH_RMS) conn.interviewerSpeechSamples += perChannel;

      if (!conn.sentQuestion && conn.interviewerSpeechSamples >= SPEECH_NEEDED_SAMPLES) {
        conn.sentQuestion = true;
        const end = conn.samples / SAMPLE_RATE;
        const start = Math.max(0, end - 1.6);
        socket.send(results(1, start, 0.8, INTERIM));
        setTimeout(() => {
          socket.send(results(1, start, 1.6, QUESTION, { is_final: true, speech_final: true }));
          socket.send(JSON.stringify({ type: 'UtteranceEnd', channel: [1, 2], last_word_end: end }));
        }, 150);
      }
    });
  });

  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
