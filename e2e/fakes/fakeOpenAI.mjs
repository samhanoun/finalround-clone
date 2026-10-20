// A stand-in for the OpenAI chat completions API: streams the scripted answer
// in pieces (so the test sees text arrive progressively) and answers the
// question-gate classifier with JSON. Records every request for assertions.

import http from 'node:http';
import config from './config.cjs';

const { ANSWER_PIECES, KEYS } = config;

let requests = [];

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function startFakeOpenAI(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    if (url.pathname === '/__state') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ requests }));
    }
    if (url.pathname === '/__reset') {
      requests = [];
      return res.end('{"ok":true}');
    }
    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      res.statusCode = 404;
      return res.end('{}');
    }
    if (req.headers.authorization !== `Bearer ${KEYS.openai}`) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: { message: 'bad key' } }));
    }

    const body = await readJson(req);
    requests.push({ model: body?.model, stream: body?.stream === true, messages: body?.messages ?? [] });
    const id = `chatcmpl-e2e-${requests.length}`;
    const created = Math.floor(Date.now() / 1000);

    if (!body?.stream) {
      // The question gate's classifier.
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: body?.model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"answer":true,"category":"behavioral"}' } }],
        }),
      );
    }

    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.write(chunk({ role: 'assistant', content: '' }));
    for (const piece of ANSWER_PIECES) {
      await sleep(120);
      if (res.destroyed) return;
      res.write(chunk({ content: piece }));
    }
    res.write(chunk({}, 'stop'));
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
