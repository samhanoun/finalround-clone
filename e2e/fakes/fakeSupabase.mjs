// A small stand-in for Supabase: email/password auth plus the slice of the
// PostgREST API the live copilot uses (filters, order, limit, single rows,
// inserts, updates, RPCs), over in-memory tables. Rows with a user_id are only
// visible to that user unless the service-role key is used, like RLS.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import config from './config.cjs';

const { KEYS, RESUME, USER } = config;

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

/** An unsigned JWT-shaped token: clients only decode it, the fake checks it. */
function accessToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  return [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: userId, role: 'authenticated', aud: 'authenticated', email: USER.email, iat: now, exp: now + 24 * 3600 }),
    b64url('e2e-signature'),
  ].join('.');
}

function userIdFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return payload.sub === USER.id && payload.exp * 1000 > Date.now() ? payload.sub : null;
  } catch {
    return null;
  }
}

const userJson = () => ({
  id: USER.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: USER.email,
  email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  identities: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

function session() {
  const expiresIn = 24 * 3600;
  return {
    access_token: accessToken(USER.id),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: `e2e-refresh-${randomUUID()}`,
    user: userJson(),
  };
}

let clock = Date.parse('2026-10-20T10:00:00Z');
const timestamp = () => new Date(Math.max((clock += 1), Date.now())).toISOString();

function seed() {
  return {
    profiles: [{ id: USER.id, user_id: USER.id, full_name: 'E2E Candidate', onboarding_completed: true, created_at: timestamp() }],
    resume_documents: [{ ...RESUME, user_id: USER.id, created_at: timestamp() }],
    copilot_sessions: [],
    copilot_events: [],
  };
}

let tables = seed();
const rpcCalls = [];

const TABLE_DEFAULTS = {
  copilot_sessions: () => ({
    status: 'active',
    title: null,
    interview_session_id: null,
    metadata: {},
    stopped_at: null,
    duration_seconds: 0,
    consumed_minutes: 0,
  }),
};

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function valueAt(row, column) {
  const text = column.split('->>');
  if (text.length === 2) {
    const value = row[text[0]]?.[text[1]];
    return value === undefined || value === null ? null : String(value);
  }
  const json = column.split('->');
  if (json.length === 2) return row[json[0]]?.[json[1]] ?? null;
  return row[column];
}

function compare(a, b) {
  if (typeof a === 'number' || (!Number.isNaN(Number(a)) && !Number.isNaN(Number(b)) && a !== '' && b !== '')) return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

/** One PostgREST filter such as `eq.x`, `not.is.null`, `gte.2026-…`, `in.(a,b)`. */
function matcher(column, expression) {
  let negate = false;
  let rest = expression;
  if (rest.startsWith('not.')) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf('.');
  const op = rest.slice(0, dot);
  const value = rest.slice(dot + 1);
  return (row) => {
    const actual = valueAt(row, column);
    let ok;
    switch (op) {
      case 'eq':
        ok = actual !== null && actual !== undefined && String(actual) === value;
        break;
      case 'neq':
        ok = String(actual) !== value;
        break;
      case 'gt':
        ok = actual != null && compare(actual, value) > 0;
        break;
      case 'gte':
        ok = actual != null && compare(actual, value) >= 0;
        break;
      case 'lt':
        ok = actual != null && compare(actual, value) < 0;
        break;
      case 'lte':
        ok = actual != null && compare(actual, value) <= 0;
        break;
      case 'is':
        ok = value === 'null' ? actual == null : String(actual) === value;
        break;
      case 'in':
        ok = value.replace(/^\(|\)$/g, '').split(',').map((item) => item.replace(/^"|"$/g, '')).includes(String(actual));
        break;
      case 'ilike':
      case 'like': {
        const pattern = new RegExp(`^${value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, op === 'ilike' ? 'i' : '');
        ok = actual != null && pattern.test(String(actual));
        break;
      }
      default:
        ok = true; // unsupported filters are ignored rather than failing the app
    }
    return negate ? !ok : ok;
  };
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict', 'or', 'and']);

function applyQuery(rows, params) {
  let result = rows;
  for (const [key, value] of params) {
    if (!RESERVED.has(key)) result = result.filter(matcher(key, value));
  }
  const order = params.get('order');
  if (order) {
    const terms = order.split(',').map((term) => {
      const [column, direction] = term.split('.');
      return { column, desc: direction === 'desc' };
    });
    result = [...result].sort((a, b) => {
      for (const { column, desc } of terms) {
        const diff = compare(a[column] ?? '', b[column] ?? '');
        if (diff !== 0) return desc ? -diff : diff;
      }
      return 0;
    });
  }
  const offset = Number(params.get('offset') ?? 0);
  const limit = params.has('limit') ? Number(params.get('limit')) : undefined;
  return result.slice(offset, limit === undefined ? undefined : offset + limit);
}

function caller(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (token === KEYS.service) return { service: true, userId: null };
  return { service: false, userId: userIdFromToken(token) };
}

function visible(row, who) {
  if (who.service || !('user_id' in row)) return true;
  return who.userId !== null && row.user_id === who.userId;
}

function respondRows(req, res, rows, status = 200) {
  const wantsObject = (req.headers.accept ?? '').includes('application/vnd.pgrst.object+json');
  const prefer = req.headers.prefer ?? '';
  const headers = /count=/.test(prefer) ? { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` } : {};
  if (wantsObject) {
    if (rows.length !== 1) {
      return send(res, 406, {
        code: 'PGRST116',
        details: `The result contains ${rows.length} rows`,
        hint: null,
        message: 'JSON object requested, multiple (or no) rows returned',
      });
    }
    return send(res, status, rows[0], headers);
  }
  if (req.method !== 'GET' && !prefer.includes('return=representation')) return send(res, status === 200 ? 204 : status, undefined, headers);
  return send(res, status, rows, headers);
}

function rpc(name) {
  if (name === 'check_quota') return [{ allowed: true, used: 0, limit_val: 400, remaining: 400 }];
  if (name === 'get_user_plan') {
    return [{ plan_id: 'pro', plan_name: 'Pro', copilot_minutes_monthly: 400, copilot_session_minutes: 60, copilot_daily_minutes: 120 }];
  }
  return null;
}

async function handleRest(req, res, url) {
  const who = caller(req);
  const [, , , table, fn] = url.pathname.split('/'); // /rest/v1/<table> or /rest/v1/rpc/<fn>
  if (table === 'rpc') {
    rpcCalls.push({ fn, body: await readJson(req), service: who.service });
    return send(res, 200, rpc(fn));
  }
  tables[table] ??= [];
  const rows = tables[table];

  if (req.method === 'GET' || req.method === 'HEAD') {
    return respondRows(req, res, applyQuery(rows.filter((row) => visible(row, who)), url.searchParams));
  }
  if (req.method === 'POST') {
    const body = await readJson(req);
    const input = Array.isArray(body) ? body : [body];
    if (!who.service && input.some((row) => 'user_id' in row && row.user_id !== who.userId)) {
      return send(res, 403, { code: '42501', message: 'new row violates row-level security policy' });
    }
    const created = input.map((row) => ({
      id: randomUUID(),
      ...(TABLE_DEFAULTS[table]?.() ?? {}),
      created_at: timestamp(),
      updated_at: timestamp(),
      ...row,
    }));
    rows.push(...created);
    return respondRows(req, res, created, 201);
  }
  if (req.method === 'PATCH') {
    const patch = await readJson(req);
    const targets = applyQuery(rows.filter((row) => visible(row, who)), url.searchParams);
    targets.forEach((row) => Object.assign(row, patch, { updated_at: timestamp() }));
    return respondRows(req, res, targets);
  }
  if (req.method === 'DELETE') {
    const targets = new Set(applyQuery(rows.filter((row) => visible(row, who)), url.searchParams));
    tables[table] = rows.filter((row) => !targets.has(row));
    return respondRows(req, res, [...targets]);
  }
  return send(res, 405, { message: 'method not allowed' });
}

async function handleAuth(req, res, url) {
  if (url.pathname === '/auth/v1/token') {
    const body = (await readJson(req)) ?? {};
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password' && body.email === USER.email && body.password === USER.password) return send(res, 200, session());
    if (grant === 'refresh_token' && typeof body.refresh_token === 'string') return send(res, 200, session());
    return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials' });
  }
  if (url.pathname === '/auth/v1/user') {
    const { userId } = caller(req);
    return userId ? send(res, 200, userJson()) : send(res, 401, { code: 'bad_jwt', message: 'invalid JWT' });
  }
  if (url.pathname === '/auth/v1/logout') return send(res, 204);
  return send(res, 404, { message: 'not found' });
}

export function startFakeSupabase(port) {
  const server = http.createServer(async (req, res) => {
    // The browser calls this directly from the app's origin.
    res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,HEAD,OPTIONS');
    res.setHeader(
      'access-control-allow-headers',
      req.headers['access-control-request-headers'] ?? 'apikey,authorization,content-type,prefer,accept-profile,content-profile,x-client-info',
    );
    res.setHeader('access-control-expose-headers', 'content-range');
    if (req.method === 'OPTIONS') return send(res, 204);

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/__health') return send(res, 200, { ok: true });
      if (url.pathname === '/__state') return send(res, 200, { tables, rpcCalls });
      if (url.pathname === '/__reset') {
        tables = seed();
        rpcCalls.length = 0;
        return send(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
      if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url);
      return send(res, 404, { message: 'not found' });
    } catch (error) {
      return send(res, 500, { message: String(error) });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
