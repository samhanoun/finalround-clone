import { NextResponse } from 'next/server';

/** A database or runtime error object (Postgrest errors carry code/details/hint). */
function isInternalError(value: unknown): boolean {
  if (value instanceof Error) return true;
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.message === 'string' && ('code' in v || 'details' in v || 'hint' in v || 'stack' in v);
}

/**
 * A JSON error response. `extra` carries client-safe details (validation
 * errors, a request id). Raw database and runtime error objects are logged
 * here instead of being sent, so responses never reveal schema names,
 * queries or stack traces.
 */
export function jsonError(status: number, message: string, extra?: unknown) {
  const internal = isInternalError(extra);
  if (extra && internal) {
    const detail = extra instanceof Error ? extra.message : extra;
    console.error('[api] %s %s', status, message, detail);
  }
  return NextResponse.json({ error: message, ...(extra && !internal ? { extra } : {}) }, { status });
}

export type LimitedJson = { ok: true; data: unknown } | { ok: false; tooLarge: boolean };

/**
 * Reads a JSON body, stopping as soon as it passes `maxBytes`. The
 * Content-Length header is only a hint: a chunked body has none, and
 * `req.json()` would buffer whatever arrives.
 */
export async function readJsonLimited(req: Request, maxBytes: number): Promise<LimitedJson> {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) return { ok: false, tooLarge: true };
  if (!req.body) return { ok: false, tooLarge: false };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, data: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}
