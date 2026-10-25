/**
 * Server-sent events over fetch (EventSource can't POST or be aborted per
 * request). Parses `event:` / `data:` blocks as chunks arrive, in any split.
 */

export type SseMessage = { event: string; data: string };

const BLOCK_END = /\r\n\r\n|\n\n|\r\r/;

export function createSseParser(onMessage: (message: SseMessage) => void) {
  let buffer = '';

  function dispatch(block: string) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r\n|\n|\r/)) {
      if (!line || line.startsWith(':')) continue; // blank or comment
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) onMessage({ event, data: data.join('\n') });
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      let match = BLOCK_END.exec(buffer);
      while (match) {
        dispatch(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = BLOCK_END.exec(buffer);
      }
    },
    /** Dispatches a final block that had no trailing blank line. */
    end() {
      if (buffer.trim()) dispatch(buffer);
      buffer = '';
    },
  };
}

export type AnswerDone = { model?: string; ttftMs?: number | null; totalMs?: number };

export class AnswerStreamError extends Error {
  constructor(readonly code: string) {
    super(code === 'answer_failed' ? 'The answer could not be generated. Try Answer now again.' : `Answer failed (${code}).`);
    this.name = 'AnswerStreamError';
  }
}

/** Reads the answer route's stream, calling `onText` for each piece. Resolves with the `done` details. */
export async function readAnswerStream(
  body: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<AnswerDone> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let done: AnswerDone | null = null;
  let failure: string | null = null;

  const parser = createSseParser(({ event, data }) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'token' && typeof payload.text === 'string') onText(payload.text);
    else if (event === 'done') done = payload as AnswerDone;
    else if (event === 'error') failure = typeof payload.error === 'string' ? payload.error : 'answer_failed';
  });

  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();

  if (failure) throw new AnswerStreamError(failure);
  if (!done) throw new AnswerStreamError('stream_ended_early');
  return done;
}
