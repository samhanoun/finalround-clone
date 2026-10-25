/**
 * @jest-environment node
 */
import { AnswerStreamError, createSseParser, readAnswerStream, type SseMessage } from '@/lib/copilot/sse';

function parseAll(chunks: string[]) {
  const messages: SseMessage[] = [];
  const parser = createSseParser((message) => messages.push(message));
  chunks.forEach((chunk) => parser.push(chunk));
  parser.end();
  return messages;
}

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

describe('createSseParser', () => {
  it('parses events split across arbitrary chunk boundaries', () => {
    const wire = 'event: token\ndata: {"text":"Hi"}\n\nevent: done\ndata: {"ttftMs":420}\n\n';
    const whole = parseAll([wire]);
    const byChar = parseAll(wire.split(''));
    expect(byChar).toEqual(whole);
    expect(whole).toEqual([
      { event: 'token', data: '{"text":"Hi"}' },
      { event: 'done', data: '{"ttftMs":420}' },
    ]);
  });

  it('handles CRLF, comments, multi-line data and a missing final blank line', () => {
    expect(parseAll([': keep-alive\r\n\r\ndata: a\r\ndata: b\r\n\r\nevent: x\ndata: last'])).toEqual([
      { event: 'message', data: 'a\nb' },
      { event: 'x', data: 'last' },
    ]);
  });
});

describe('readAnswerStream', () => {
  it('passes each token on and resolves with the done details', async () => {
    const texts: string[] = [];
    const done = await readAnswerStream(
      streamOf(['event: token\ndata: {"text":"I led "}\n\nevent: tok', 'en\ndata: {"text":"the migration."}\n\n', 'event: done\ndata: {"model":"gpt-4o-mini","ttftMs":380}\n\n']),
      (text) => texts.push(text),
    );
    expect(texts.join('')).toBe('I led the migration.');
    expect(done).toEqual({ model: 'gpt-4o-mini', ttftMs: 380 });
  });

  it('rejects on an error event or a stream that ends without done', async () => {
    await expect(readAnswerStream(streamOf(['event: error\ndata: {"error":"answer_failed"}\n\n']), () => undefined)).rejects.toBeInstanceOf(
      AnswerStreamError,
    );
    await expect(readAnswerStream(streamOf(['event: token\ndata: {"text":"I"}\n\n']), () => undefined)).rejects.toThrow(
      'stream_ended_early',
    );
  });
});
