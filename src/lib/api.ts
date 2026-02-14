import { NextResponse } from 'next/server';

export function jsonError(status: number, message: string, extra?: unknown) {
  return NextResponse.json(
    { error: message, ...(extra ? { extra } : {}) },
    { status },
  );
}
