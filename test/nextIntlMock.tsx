/**
 * Jest stand-in for next-intl (which ships as ES modules Jest can't load):
 * translations come from the real English messages, so component tests keep
 * asserting the text people see. Supports {values}, plural and select, t.rich
 * and t.has; formatting uses the browser Intl APIs.
 */
import React from 'react';
import messages from '../src/messages/en.json';

type Values = Record<string, unknown>;

function lookup(path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), messages);
}

/** Finds the body of a `{name, plural|select, …}` block starting at `start` (the opening brace). */
function blockEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function formatMessage(text: string, values: Values = {}): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') {
      out += text[i];
      i += 1;
      continue;
    }
    const end = blockEnd(text, i);
    const inner = text.slice(i + 1, end);
    const match = /^\s*(\w+)\s*(?:,\s*(plural|select)\s*,([\s\S]*))?$/.exec(inner);
    if (!match) {
      out += text.slice(i, end + 1);
    } else if (!match[2]) {
      out += String(values[match[1]] ?? `{${match[1]}}`);
    } else {
      const value = values[match[1]];
      const options = new Map<string, string>();
      const body = match[3];
      let j = 0;
      while (j < body.length) {
        const keyMatch = /\s*(=?\w+)\s*\{/y;
        keyMatch.lastIndex = j;
        const found = keyMatch.exec(body);
        if (!found) break;
        const open = keyMatch.lastIndex - 1;
        const close = blockEnd(body, open);
        options.set(found[1], body.slice(open + 1, close));
        j = close + 1;
      }
      let chosen: string | undefined;
      if (match[2] === 'plural') {
        const n = Number(value);
        chosen = options.get(`=${n}`) ?? (n === 1 ? options.get('one') : undefined) ?? options.get('other');
        chosen = chosen?.replace(/#/g, String(n));
      } else {
        chosen = options.get(String(value)) ?? options.get('other');
      }
      out += formatMessage(chosen ?? '', values);
    }
    i = end + 1;
  }
  return out;
}

/**
 * One translator per namespace, like next-intl's hooks: a new function on
 * every render would make effects that depend on `t` re-run (and refetch) in
 * a loop under Jest.
 */
const translators = new Map<string, ReturnType<typeof buildTranslator>>();
function makeTranslator(namespace?: string) {
  const key = namespace ?? '';
  let translator = translators.get(key);
  if (!translator) {
    translator = buildTranslator(namespace);
    translators.set(key, translator);
  }
  return translator;
}

function buildTranslator(namespace?: string) {
  const full = (key: string) => (namespace ? `${namespace}.${key}` : key);
  const t = (key: string, values?: Values) => {
    const message = lookup(full(key));
    return typeof message === 'string' ? formatMessage(message, values) : full(key);
  };
  t.has = (key: string) => typeof lookup(full(key)) === 'string';
  t.raw = (key: string) => lookup(full(key));
  t.rich = (key: string, values: Record<string, unknown> = {}) => {
    const text = t(key, Object.fromEntries(Object.entries(values).filter(([, v]) => typeof v !== 'function')) as Values);
    const parts: React.ReactNode[] = [];
    const tag = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let last = 0;
    let found: RegExpExecArray | null;
    while ((found = tag.exec(text))) {
      parts.push(text.slice(last, found.index));
      const render = values[found[1]];
      parts.push(typeof render === 'function' ? React.createElement(React.Fragment, { key: found.index }, (render as (c: string) => React.ReactNode)(found[2])) : found[2]);
      last = found.index + found[0].length;
    }
    parts.push(text.slice(last));
    return React.createElement(React.Fragment, null, ...parts);
  };
  t.markup = t;
  return t;
}

const formatter = {
  dateTime: (value: Date, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en', options).format(value),
  number: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat('en', options).format(value),
  relativeTime: (value: Date, now: Date = new Date()) => {
    const minutes = Math.round((value.getTime() - now.getTime()) / 60000);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
    if (Math.abs(minutes) < 1440) return rtf.format(Math.round(minutes / 60), 'hour');
    return rtf.format(Math.round(minutes / 1440), 'day');
  },
  list: (items: string[]) => items.join(', '),
};

export const useTranslations = (namespace?: string) => makeTranslator(namespace);
export const getTranslations = async (namespace?: string | { namespace?: string }) =>
  makeTranslator(typeof namespace === 'string' ? namespace : namespace?.namespace);
export const useFormatter = () => formatter;
export const getFormatter = async () => formatter;
export const createTranslator = ({ namespace }: { namespace?: string }) => makeTranslator(namespace);
export const createFormatter = () => formatter;
export const useLocale = () => 'en';
export const getLocale = async () => 'en';
export const useMessages = () => messages;
export const getMessages = async () => messages;
export const useNow = () => new Date();
export const useTimeZone = () => 'UTC';
export function NextIntlClientProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}
export const hasLocale = () => true;
