import { NextResponse } from 'next/server';

export function jsonError(status: number, message: string, extra?: unknown) {
  return NextResponse.json(
    { error: message, ...(extra ? { extra } : {}) },
    { status },
  );
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
