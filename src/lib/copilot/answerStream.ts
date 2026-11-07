import { streamChat, type StreamChatOptions } from '@/lib/llmRouter';

/**
 * Server-sent events for a streamed answer, shared by the answer and screen routes:
 *
 *   event: token  data: {"text":"…"}                     (repeated)
 *   event: done   data: {"model","ttftMs","totalMs","sources"}  (+ "cached": true for a replay)
 *
 * `sources` lists the candidate's own passages the answer cited ([S1]…), from retrieval.
 *   event: error  data: {"error":"answer_failed","requestId"}
 */

export type AnswerSource = { tag: string; source: string; kind: string };
export type FinishedAnswer = {
  text: string;
  model: string;
  ttftMs: number | null;
  totalMs: number;
  sources: AnswerSource[];
};

/** The retrieved passages the answer actually cited, in tag order. */
export function citedSources(text: string, sources: AnswerSource[]): AnswerSource[] {
  return sources.filter((source) => new RegExp(`\\[${source.tag}\\]`).test(text));
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function eventStreamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Streams `chat` as events. Aborting `signal` (the client went away, or a newer
 * question replaced this one) cancels the model call. `result()` is the
 * finished answer once the stream is over: null if it was aborted, failed or
 * empty, so callers save nothing in those cases.
 */
export function streamAnswerEvents({
  chat,
  receivedAt,
  requestId,
  signal,
  onError,
  sources = [],
}: {
  chat: Omit<StreamChatOptions, 'signal'>;
  receivedAt: number;
  requestId: string;
  signal?: AbortSignal | null;
  onError: (error: unknown) => void;
  /** Passages put in the prompt as [S1]…; the done event lists the ones the answer used. */
  sources?: AnswerSource[];
}): { body: ReadableStream<Uint8Array>; result: () => FinishedAnswer | null } {
  const abort = new AbortController();
  signal?.addEventListener('abort', () => abort.abort(), { once: true });

  let text = '';
  let firstTokenAt: number | null = null;
  let finishedAt: number | null = null;
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(sseEvent(event, data)));
      try {
        for await (const piece of streamChat({ ...chat, signal: abort.signal })) {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          text += piece;
          send('token', { text: piece });
        }
        finishedAt = Date.now();
        send('done', {
          model: chat.model,
          ttftMs: firstTokenAt === null ? null : firstTokenAt - receivedAt,
          totalMs: finishedAt - receivedAt,
          sources: citedSources(text, sources),
        });
      } catch (e) {
        if (!abort.signal.aborted) {
          onError(e);
          send('error', { error: 'answer_failed', requestId });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed because the client went away
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return {
    body,
    result: () =>
      finishedAt === null || abort.signal.aborted || !text.trim()
        ? null
        : {
            text: text.trim(),
            model: chat.model,
            ttftMs: firstTokenAt === null ? null : firstTokenAt - receivedAt,
            totalMs: finishedAt - receivedAt,
            sources: citedSources(text, sources),
          },
  };
}

/** A saved answer replayed in the same format, for a request already answered. */
export function replayAnswerEvents({ text, model, receivedAt }: { text: string; model: string; receivedAt: number }) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const elapsed = Date.now() - receivedAt;
      controller.enqueue(encoder.encode(sseEvent('token', { text })));
      controller.enqueue(encoder.encode(sseEvent('done', { model, ttftMs: elapsed, totalMs: elapsed, cached: true })));
      controller.close();
    },
  });
}
