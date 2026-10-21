#!/usr/bin/env node
// Checks that the keys a real call needs are present and accepted, without
// printing any of them (build plan Step 8).
//
//   npm run check:live
//
// Reads .env.local (then .env) like the app does. Exits 1 if a required check fails.

import { existsSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const env = (name) => {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
};

const results = [];
const record = (ok, label, detail = '', required = true) => results.push({ ok, label, detail, required });

async function request(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

const describe = (res) => (res.status === 0 ? `request failed: ${res.error}` : `HTTP ${res.status}`);

function providerForModel(model) {
  if (/^claude-/i.test(model)) return 'anthropic';
  if (/^(gpt-|chatgpt-|o\d)/i.test(model)) return 'openai';
  return null;
}

// Supabase: the service role can read the plans, including the tester plan.
const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !anonKey) {
  record(false, 'Supabase URL and anon key', 'NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is empty');
} else {
  record(true, 'Supabase URL and anon key');
}
if (!supabaseUrl || !serviceKey) {
  record(false, 'Supabase service role key', 'SUPABASE_SERVICE_ROLE_KEY is empty');
} else {
  const res = await request(`${supabaseUrl}/rest/v1/plans?select=id`, { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` });
  const plans = Array.isArray(res.body) ? res.body.map((row) => row.id) : [];
  record(res.status === 200, 'Supabase service role key', res.status === 200 ? `plans: ${plans.join(', ')}` : describe(res));
  if (res.status === 200 && !plans.includes('tester')) {
    record(false, 'Tester plan', 'missing: apply supabase/migrations/0025_tester_plan.sql', false);
  }
}

// Deepgram: the relay's key works.
const deepgramKey = env('DEEPGRAM_API_KEY');
if (!deepgramKey) {
  record(false, 'Deepgram key', 'DEEPGRAM_API_KEY is empty');
} else {
  const res = await request('https://api.deepgram.com/v1/projects', { Authorization: `Token ${deepgramKey}` });
  record(res.status === 200, 'Deepgram key', res.status === 200 ? `model ${env('DEEPGRAM_MODEL') ?? 'nova-3 (default)'}` : describe(res));
}

// Models: each copilot model exists for the key of its provider.
const answerModel = env('COPILOT_ANSWER_MODEL') ?? 'gpt-4o-mini';
const models = {
  'answer model (COPILOT_ANSWER_MODEL)': answerModel,
  'question gate model (COPILOT_GATE_MODEL)': env('COPILOT_GATE_MODEL') ?? 'gpt-4o-mini',
  'coding and screen model (COPILOT_CODING_MODEL)': env('COPILOT_CODING_MODEL') ?? answerModel,
};
const seen = new Map();
for (const [label, model] of Object.entries(models)) {
  const provider = providerForModel(model);
  if (!provider) {
    record(false, `${label}: ${model}`, 'unknown provider (expected a gpt-*, o*, or claude-* model)');
    continue;
  }
  const key = provider === 'openai' ? env('OPENAI_API_KEY') : env('ANTHROPIC_API_KEY');
  if (!key) {
    record(false, `${label}: ${model}`, `${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'} is empty`);
    continue;
  }
  if (!seen.has(model)) {
    const base = provider === 'openai' ? (env('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1') : 'https://api.anthropic.com/v1';
    const headers =
      provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    seen.set(model, await request(`${base.replace(/\/$/, '')}/models/${encodeURIComponent(model)}`, headers));
  }
  const res = seen.get(model);
  record(res.status === 200, `${label}: ${model}`, res.status === 200 ? '' : describe(res));
}

// Stripe is optional for real calls (build plan Step 10).
const stripeKey = env('STRIPE_SECRET_KEY');
if (stripeKey) {
  const mode = stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_') ? 'test mode' : 'LIVE mode';
  const missing = ['STRIPE_WEBHOOK_SECRET', 'PRICE_ID_PRO_EUR', 'PRICE_ID_PRO_USD'].filter((name) => !env(name));
  record(missing.length === 0, `Stripe (${mode})`, missing.length ? `${missing.join(', ')} empty` : '', false);
} else {
  record(false, 'Stripe', 'not configured; only needed for billing', false);
}

for (const { ok, label, detail, required } of results) {
  const mark = ok ? '✔' : required ? '✖' : '–';
  console.log(`${mark} ${label}${detail ? `  (${detail})` : ''}`);
}

const failed = results.filter((r) => !r.ok && r.required);
console.log(failed.length ? `\n${failed.length} required check(s) failed.` : '\nReady for a real call.');
process.exit(failed.length ? 1 : 0);
