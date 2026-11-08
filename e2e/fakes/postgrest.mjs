// PostgREST's query language over in-memory rows, for the fake Supabase: the
// select list (columns, aliases, casts, JSON paths, embedded resources),
// filters (operators, not., or=/and=), ordering and paging.
// https://docs.postgrest.org/en/stable/references/api/tables_views.html

/** Splits `a,b(c,d),"e,f"` at the commas outside parentheses and double quotes. */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\' && quoted) i += 1;
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === '(') depth += 1;
    else if (!quoted && c === ')') depth -= 1;
    else if (!quoted && depth === 0 && c === ',') {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** A column's value, or a JSON path's (`data->a->>b`: `->` keeps JSON, `->>` gives text). */
export function valueAt(row, path) {
  if (row === null || row === undefined) return undefined;
  const parts = path.split(/(->>|->)/);
  let value = row[parts[0]];
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i + 1];
    if (value === null || value === undefined || typeof value !== 'object') return null;
    const next = Array.isArray(value) && /^-?\d+$/.test(key) ? value.at(Number(key)) : value[key];
    value = next === undefined ? null : next;
    if (parts[i] === '->>' && value !== null) value = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return value;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/** Milliseconds for an ISO date or timestamp (no zone means UTC, Supabase's time zone), else NaN. */
function timeOf(text) {
  const match = ISO_TIME.exec(text);
  if (!match) return Number.NaN;
  const zoned = match[1] || text.length === 10 ? text : `${text}Z`;
  return Date.parse(zoned.replace(' ', 'T'));
}

/** Postgres-like ordering of two non-null values: numbers, timestamps, booleans, then text. */
export function compareValues(a, b) {
  const bothNumeric = typeof a === 'number' || typeof b === 'number' || (a !== '' && b !== '' && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)));
  if (bothNumeric && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b))) return Number(a) - Number(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(String(a) === 'true') - Number(String(b) === 'true');
  const ta = timeOf(String(a));
  const tb = timeOf(String(b));
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  return String(a).localeCompare(String(b));
}

/** The items of a PostgREST list `(a,"b,c")` or a Postgres array literal `{a,b}`. */
export function parseList(text) {
  const inner = text.replace(/^[({]/, '').replace(/[)}]$/, '');
  const items = [];
  let current = '';
  let quoted = false;
  let wasQuoted = false;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (quoted) {
      if (c === '\\' && i + 1 < inner.length) current += inner[(i += 1)];
      else if (c === '"') quoted = false;
      else current += c;
    } else if (c === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (c === ',') {
      items.push(current);
      current = '';
      wasQuoted = false;
    } else current += c;
  }
  if (inner.length || wasQuoted) items.push(current);
  return items;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** SQL LIKE: `%` (or PostgREST's `*`) is any run of characters, `_` one character, `\` escapes. */
export function likeRegExp(pattern, insensitive) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) source += escapeRegExp(pattern[(i += 1)]);
    else if (c === '%' || c === '*') source += '[\\s\\S]*';
    else if (c === '_') source += '[\\s\\S]';
    else source += escapeRegExp(c);
  }
  return new RegExp(`^${source}$`, insensitive ? 'i' : '');
}

/** A `cs`/`cd`/`ov` operand: a JSON object or array, or a Postgres array literal `{a,b}`. */
function containerValue(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // not JSON: an array literal
  }
  return text.startsWith('{') ? parseList(text) : text;
}

/** jsonb @> (and array @>): every part of `inner` is in `outer`. */
export function jsonContains(outer, inner) {
  if (Array.isArray(inner)) {
    if (!Array.isArray(outer)) return inner.length === 0 && outer !== null && typeof outer === 'object';
    return inner.every((item) => outer.some((candidate) => jsonContains(candidate, item)));
  }
  if (inner !== null && typeof inner === 'object') {
    if (Array.isArray(outer)) return Object.keys(inner).length === 0;
    if (outer === null || typeof outer !== 'object') return false;
    return Object.entries(inner).every(([key, value]) => key in outer && jsonContains(outer[key], value));
  }
  return outer === inner || (outer !== null && outer !== undefined && typeof outer !== 'object' && String(outer) === String(inner));
}

const unquote = (value) => (/^".*"$/s.test(value) ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value);

/**
 * One filter, e.g. `eq.x`, `not.is.null`, `gte.2026-…`, `in.(a,b)`, `ilike.*x*`,
 * `cs.{"mode":"x"}`. A comparison with NULL is never true, as in SQL.
 * Unknown operators match everything rather than failing the app.
 */
export function matcher(column, expression, { quoted = false } = {}) {
  let rest = expression;
  let negate = false;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  const op = (dot === -1 ? rest : rest.slice(0, dot)).replace(/\(.*\)$/, ''); // fts(english) → fts
  const raw = dot === -1 ? '' : rest.slice(dot + 1);
  const value = quoted ? unquote(raw) : raw;
  const test = (actual) => {
    switch (op) {
      case 'eq':
        return String(actual) === value;
      case 'neq':
        return String(actual) !== value;
      case 'gt':
        return compareValues(actual, value) > 0;
      case 'gte':
        return compareValues(actual, value) >= 0;
      case 'lt':
        return compareValues(actual, value) < 0;
      case 'lte':
        return compareValues(actual, value) <= 0;
      case 'in':
        return parseList(value).includes(String(actual));
      case 'like':
        return likeRegExp(value, false).test(String(actual));
      case 'ilike':
        return likeRegExp(value, true).test(String(actual));
      case 'match':
        return new RegExp(value).test(String(actual));
      case 'imatch':
        return new RegExp(value, 'i').test(String(actual));
      case 'cs':
        return jsonContains(actual, containerValue(value));
      case 'cd':
        return jsonContains(containerValue(value), actual);
      case 'ov': {
        const wanted = containerValue(value);
        return Array.isArray(actual) && Array.isArray(wanted) && actual.some((item) => wanted.some((other) => jsonContains(item, other)));
      }
      case 'fts':
      case 'plfts':
      case 'phfts':
      case 'wfts':
        // Not a real text search: every word of the query appears in the text.
        return value
          .split(/[\s&|!']+/)
          .filter(Boolean)
          .every((word) => String(actual).toLowerCase().includes(word.toLowerCase()));
      default:
        return true;
    }
  };
  return (row) => {
    const actual = valueAt(row, column);
    if (op === 'is' || op === 'isdistinct') {
      const target = value.toLowerCase();
      let ok;
      if (op === 'is') {
        ok = target === 'null' || target === 'unknown' ? actual === null || actual === undefined : String(actual) === target;
      } else {
        ok = target === 'null' ? actual !== null && actual !== undefined : String(actual ?? 'null') !== value;
      }
      return negate ? !ok : ok;
    }
    if (actual === null || actual === undefined) return false;
    const ok = test(actual);
    return negate ? !ok : ok;
  };
}

/** `or=(a.eq.1,and(b.gt.2,c.is.null))` and `and=(…)`, nested as deep as given. */
export function logicMatcher(kind, text) {
  const inner = text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1) : text;
  const predicates = splitTopLevel(inner).map((part) => {
    const nested = /^(not\.)?(or|and)(\(.*\))$/s.exec(part);
    if (nested) {
      const predicate = logicMatcher(nested[2], nested[3]);
      return nested[1] ? (row) => !predicate(row) : predicate;
    }
    const dot = part.indexOf('.');
    return matcher(part.slice(0, dot), part.slice(dot + 1), { quoted: true });
  });
  return kind === 'or' ? (row) => predicates.some((p) => p(row)) : (row) => predicates.every((p) => p(row));
}

/** Query parameters that aren't filters. */
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict', 'apikey']);

/**
 * The filters among `params` whose key starts with `prefix` (an embedded
 * resource's `alias.`; '' for the top level), as one predicate.
 */
export function filterPredicate(params, prefix = '') {
  const predicates = [];
  for (const [rawKey, value] of params) {
    if (!rawKey.startsWith(prefix)) continue;
    const key = rawKey.slice(prefix.length);
    if (!key || RESERVED.has(key)) continue;
    const logic = /^(not\.)?(or|and)$/.exec(key);
    if (logic) {
      const predicate = logicMatcher(logic[2], value);
      predicates.push(logic[1] ? (row) => !predicate(row) : predicate);
      continue;
    }
    // Another embedded resource's parameter (`messages.limit`): not this level's.
    if (key.includes('.')) continue;
    predicates.push(matcher(key, value));
  }
  return (row) => predicates.every((p) => p(row));
}

/** `order=a.desc.nullslast,b`: ASC puts NULLs last and DESC first, unless told otherwise. */
export function orderRows(rows, orderText) {
  if (!orderText) return rows;
  const terms = splitTopLevel(orderText).map((term) => {
    const parts = term.split('.');
    const column = parts.shift();
    const desc = parts.includes('desc');
    const nullsFirst = parts.includes('nullsfirst') ? true : parts.includes('nullslast') ? false : desc;
    return { column, desc, nullsFirst };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc, nullsFirst } of terms) {
      const x = valueAt(a, column);
      const y = valueAt(b, column);
      const xNull = x === null || x === undefined;
      const yNull = y === null || y === undefined;
      if (xNull || yNull) {
        if (xNull && yNull) continue;
        return xNull === nullsFirst ? -1 : 1;
      }
      const diff = compareValues(x, y);
      if (diff !== 0) return desc ? -diff : diff;
    }
    return 0;
  });
}

/** `offset` and `limit` (for the top level, or an embedded resource's `alias.limit`). */
export function pageRows(rows, params, prefix = '') {
  const offset = Number(params.get(`${prefix}offset`) ?? 0) || 0;
  const limit = params.has(`${prefix}limit`) ? Number(params.get(`${prefix}limit`)) : undefined;
  return rows.slice(offset, limit === undefined ? undefined : offset + limit);
}

/**
 * The select list: `*`, `col`, `alias:col`, `col::text`, `data->>key`,
 * `alias:relation!hint!inner(…)`, `...relation(…)`. Whitespace is already
 * stripped by supabase-js.
 */
export function parseSelect(text) {
  return splitTopLevel(text || '*').map(parseSelectItem);
}

function parseSelectItem(item) {
  let rest = item;
  let spread = false;
  if (rest.startsWith('...')) {
    spread = true;
    rest = rest.slice(3);
  }
  let alias = null;
  const aliased = /^("?)([A-Za-z_][\w ]*)\1:(?!:)(.+)$/s.exec(rest);
  if (aliased) {
    alias = aliased[2];
    rest = aliased[3];
  }
  const open = rest.indexOf('(');
  if (open > 0 && rest.endsWith(')')) {
    const [relation, ...modifiers] = rest.slice(0, open).split('!');
    return {
      kind: 'embed',
      relation,
      alias,
      spread,
      inner: modifiers.includes('inner'),
      hint: modifiers.find((m) => m !== 'inner' && m !== 'left') ?? null,
      children: parseSelect(rest.slice(open + 1, -1)),
    };
  }
  if (rest === '*') return { kind: 'star' };
  const [path, cast = null] = rest.split('::');
  const last = path.split(/->>|->/).pop();
  return { kind: 'column', path, cast, key: alias ?? last };
}

/** `col::text`, `::int` and friends, roughly. */
export function castValue(value, cast) {
  if (!cast || value === null || value === undefined) return value;
  if (/^(text|varchar|char)/.test(cast)) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^(int|integer|bigint|smallint|numeric|float|real|double)/.test(cast)) return Number(value);
  if (cast === 'boolean' || cast === 'bool') return value === true || value === 'true';
  return value;
}
