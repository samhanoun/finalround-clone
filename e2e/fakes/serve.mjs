// Starts the fake Supabase, Deepgram and OpenAI services for the live-loop
// end-to-end test, and writes the WAV the fake microphone plays.
//   node e2e/fakes/serve.mjs
// Playwright starts this through webServer in playwright.live.config.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import config from './config.cjs';
import { startFakeDeepgram } from './fakeDeepgram.mjs';
import { startFakeOpenAI } from './fakeOpenAI.mjs';
import { startFakeSupabase } from './fakeSupabase.mjs';

const { PORTS, WAV_PATH } = config;

/**
 * A speech-like test signal at 16 kHz: 2.5 s of voiced tone bursts (a few
 * harmonics with a syllable-rate envelope), then 1.5 s of silence. Chromium
 * loops it, so the interviewer "speaks" and pauses repeatedly.
 */
function speechLikeWav() {
  const rate = 16000;
  const speechSeconds = 2.5;
  const totalSeconds = 4;
  const samples = new Int16Array(rate * totalSeconds);
  for (let i = 0; i < rate * speechSeconds; i += 1) {
    const t = i / rate;
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t); // ~4 syllables per second
    const voice =
      Math.sin(2 * Math.PI * 160 * t) + 0.6 * Math.sin(2 * Math.PI * 320 * t) + 0.35 * Math.sin(2 * Math.PI * 900 * t);
    samples[i] = Math.round(voice * syllable * 6000);
  }
  const data = Buffer.from(samples.buffer);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// One bad message must not take every fake down with it mid-test.
process.on('uncaughtException', (error) => console.error('[e2e fakes] uncaught', error));

mkdirSync(path.dirname(WAV_PATH), { recursive: true });
writeFileSync(WAV_PATH, speechLikeWav());

await Promise.all([
  startFakeSupabase(PORTS.supabase),
  startFakeDeepgram(PORTS.deepgram),
  startFakeOpenAI(PORTS.openai),
]);
console.log(
  `[e2e fakes] supabase :${PORTS.supabase} · deepgram :${PORTS.deepgram} · openai :${PORTS.openai} · wav ${WAV_PATH}`,
);
