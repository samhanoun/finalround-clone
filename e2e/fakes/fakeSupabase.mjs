// A small stand-in for Supabase over in-memory state, for the end-to-end tests:
// - Auth (GoTrue): email and password sign-up and sign-in for any number of
//   users, refresh tokens, the user endpoint (read, change password), Google
//   sign-in, password recovery, and the admin API (get, create, update or ban,
//   delete users).
// - PostgREST: selects with embedded resources, filters (with not./or=/and=),
//   order, paging, counts, single rows, inserts, upserts, updates, deletes with
//   ON DELETE CASCADE / SET NULL, unique keys, column defaults, generated
//   columns, a little row-level security (see POLICIES), and the RPCs the app
//   calls.
// - Storage: upload, signed URLs and their download, remove; bytes in memory.
// What it knows of the schema comes from supabase/migrations (supabaseSchema.mjs).
// Test-only endpoints: /__health, /__state (everything, without passwords or
// file bytes) and /__reset.

import http from 'node:http';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import config from './config.cjs';
import { castValue, filterPredicate, orderRows, pageRows, parseSelect, valueAt } from './postgrest.mjs';
import { FOREIGN_KEYS, GENERATED_COLUMNS, KNOWN_TABLES, columnDefaults, lowerBtrim, primaryKey, uniqueKeys } from './supabaseSchema.mjs';

const { KEYS, RESUME, USER } = config;

// ---------------------------------------------------------------------------
// Clock, tokens

let clock = Date.parse('2026-10-20T10:00:00Z');
/** Now, but never the same instant twice, so rows made in a row sort in that order. */
const timestamp = () => {
  clock = Math.max(clock + 1, Date.now());
  return new Date(clock).toISOString();
};

/** The fake's own signing key (HS256, like a Supabase project's JWT secret). */
const JWT_SECRET = 'e2e-fake-supabase-jwt-secret';
const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function signJwt(payload) {
  const unsigned = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}`;
  return `${unsigned}.${createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')}`;
}

/** The claims of a token this fake signed: `{ claims }`, or `{ error }` ('invalid' or 'expired'). */
function readJwt(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { error: 'invalid' };
  const expected = createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { error: 'invalid' };
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return { error: 'expired' };
    return { claims };
  } catch {
    return { error: 'invalid' };
  }
}

// ---------------------------------------------------------------------------
// State

/** Tables by name; rows are plain objects. */
let tables = {};
/** Auth users by id: what GoTrue keeps in auth.users (passwords are test values, in the clear). */
let users = new Map();
/** Signed-in sessions: session id → user id. Banning or deleting a user ends theirs. */
let sessions = new Map();
/** Refresh tokens → session id. */
let refreshTokens = new Map();
/** Storage objects by `bucket/name`. */
let objects = new Map();
/** Buckets the migrations create (0006_storage_resumes_policies). */
const BUCKETS = new Set(['resumes']);

const rpcCalls = [];
/** "Forgot your password?" requests: the email and where the link should lead. */
const recoverRequests = [];
/** Google sign-in: one-time codes handed back to the app, with the PKCE challenge each must match. */
const oauthCodes = new Map();
const oauthRequests = [];
/** Calls to the auth admin API that change a user (ban, confirm, metadata, password), for assertions. */
const authAdminCalls = [];

const tableRows = (table) => (tables[table] ??= []);
/** A table's rows for reading, without adding an empty table to the state. */
const peek = (table) => tables[table] ?? [];

/** A new row as Postgres would store it: an id, the column defaults, timestamps, then what was sent. */
function completeRow(table, input) {
  const now = timestamp();
  const row = { id: randomUUID(), ...columnDefaults(table, timestamp), created_at: now, updated_at: now, ...input };
  applyGenerated(table, row);
  return row;
}

function applyGenerated(table, row) {
  for (const [column, compute] of Object.entries(GENERATED_COLUMNS[table] ?? {})) row[column] = compute(row);
}

/** Inserts without any checks (seed data and triggers). */
function insertRaw(table, input) {
  const row = completeRow(table, input);
  tableRows(table).push(row);
  return row;
}

function newUser({ id = randomUUID(), email, password, userMetadata = {}, appMetadata = null, confirmed = true, createdAt = timestamp() }) {
  return {
    id,
    email: String(email).trim().toLowerCase(),
    password,
    identityId: randomUUID(),
    email_confirmed_at: confirmed ? createdAt : null,
    phone: '',
    last_sign_in_at: null,
    app_metadata: appMetadata ?? { provider: 'email', providers: ['email'] },
    user_metadata: userMetadata,
    banned_until: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

/** A new auth user, and their profile (the on_auth_user_created trigger, 0024_create_profile_on_signup). */
function createUser(options) {
  const user = newUser(options);
  users.set(user.id, user);
  insertRaw('profiles', {
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
  });
  return user;
}

function seed() {
  tables = {};
  users = new Map();
  sessions = new Map();
  refreshTokens = new Map();
  objects = new Map();
  const user = createUser({ id: USER.id, email: USER.email, password: USER.password, createdAt: '2026-01-01T00:00:00.000Z' });
  Object.assign(tableRows('profiles').find((row) => row.id === user.id), { full_name: 'E2E Candidate', onboarding_completed: true });
  insertRaw('resume_documents', { ...RESUME, user_id: USER.id, parse_status: 'completed' });
  tables.copilot_sessions = [];
  tables.copilot_events = [];
}
seed();

const findUserByEmail = (email) => [...users.values()].find((user) => user.email === String(email ?? '').trim().toLowerCase());
const isBanned = (user) => Boolean(user.banned_until && Date.parse(user.banned_until) > Date.now());

function userJson(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.email_confirmed_at,
    phone: user.phone,
    confirmed_at: user.email_confirmed_at,
    last_sign_in_at: user.last_sign_in_at,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    identities: [
      {
        identity_id: user.identityId,
        id: user.id,
        user_id: user.id,
        identity_data: { email: user.email, email_verified: Boolean(user.email_confirmed_at), phone_verified: false, sub: user.id },
        provider: 'email',
        last_sign_in_at: user.last_sign_in_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
        email: user.email,
      },
    ],
    created_at: user.created_at,
    updated_at: user.updated_at,
    is_anonymous: false,
    ...(user.banned_until ? { banned_until: user.banned_until } : {}),
  };
}

const SESSION_SECONDS = 24 * 3600;

/** Access and refresh tokens for a session (a new session unless one is given). */
function sessionFor(user, sessionId = null) {
  const id = sessionId ?? randomUUID();
  sessions.set(id, user.id);
  const now = Math.floor(Date.now() / 1000);
  const refreshToken = `e2e-refresh-${randomUUID()}`;
  refreshTokens.set(refreshToken, id);
  const accessToken = signJwt({
    aud: 'authenticated',
    exp: now + SESSION_SECONDS,
    iat: now,
    sub: user.id,
    email: user.email,
    phone: '',
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    session_id: id,
    is_anonymous: false,
  });
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: SESSION_SECONDS,
    expires_at: now + SESSION_SECONDS,
    refresh_token: refreshToken,
    user: userJson(user),
  };
}

function endSessions(userId) {
  for (const [id, owner] of sessions) if (owner === userId) sessions.delete(id);
}

/** Who is calling: the service role, a signed-in user (their JWT), or anonymous (the anon key). */
function caller(req) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (token === KEYS.service || (!token && req.headers.apikey === KEYS.service)) return { service: true, userId: null, claims: null };
  const { claims } = readJwt(token);
  return { service: false, userId: claims?.role === 'authenticated' ? claims.sub : null, claims: claims ?? null };
}

// ---------------------------------------------------------------------------
// HTTP helpers

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The JSON body, or undefined when it is empty or not JSON. */
async function readJson(req) {
  const body = (await readBody(req)).toString('utf8');
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

/** A PostgREST error. */
class RestError extends Error {
  constructor(status, body) {
    super(body.message);
    this.status = status;
    this.body = { code: body.code, details: body.details ?? null, hint: body.hint ?? null, message: body.message };
  }
}

// ---------------------------------------------------------------------------
// Row-level security, kept small. The service-role key bypasses it all, as in
// Supabase. For a user's token:
// - profiles: only their own row, to read and to update (profiles_select_own and
//   profiles_update_own, 0001); users can't insert or delete profiles, and the
//   server-owned columns can't change (guard_profile_server_columns, 0032).
// - organization_members: the rows of teams where they are an active member
//   (organization_members_read, 0020); only the team's owner adds, changes or
//   removes rows (organization_members_manage_owner).
// - support_messages: the messages on their own tickets, or any for staff
//   (support_messages_select_own_or_admin, 0019).
// - any other row with a user_id: only its own user's (a stand-in for the many
//   "*_own" policies). Rows without one are open to every caller.

function orgRole(organizationId, userId) {
  const member = peek('organization_members').find(
    (row) => row.organization_id === organizationId && row.user_id === userId && row.status === 'active',
  );
  return member?.role ?? null;
}

const isStaff = (userId) => peek('admin_users').some((row) => row.user_id === userId);

const POLICIES = {
  profiles: {
    read: (row, uid) => row.id === uid,
    update: (row, uid) => row.id === uid,
    insert: () => false,
    delete: () => false,
  },
  organization_members: {
    read: (row, uid) => orgRole(row.organization_id, uid) !== null,
    update: (row, uid) => orgRole(row.organization_id, uid) === 'owner',
    insert: (row, uid) => orgRole(row.organization_id, uid) === 'owner',
    delete: (row, uid) => orgRole(row.organization_id, uid) === 'owner',
  },
  support_messages: {
    read: (row, uid) => isStaff(uid) || peek('support_tickets').some((ticket) => ticket.id === row.ticket_id && ticket.user_id === uid),
  },
};

/** May this caller do `action` (read, insert, update, delete) to this row? */
function allowed(action, table, row, who) {
  if (who.service) return true;
  const rule = POLICIES[table]?.[action];
  if (rule) return who.userId !== null && rule(row, who.userId);
  return !('user_id' in row) || (who.userId !== null && row.user_id === who.userId);
}

const PROFILE_SERVER_COLUMNS = ['id', 'email', 'organization_id', 'created_at'];

function rlsError(table, who) {
  return new RestError(who.userId ? 403 : 401, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
}

// ---------------------------------------------------------------------------
// Keys and foreign keys

/** The unique key (or primary key) a changed row would break, if any. NULLs never clash, as in SQL. */
function uniqueClash(table, rows, changed) {
  for (const key of uniqueKeys(table)) {
    const signature = (row) => {
      const values = key.map((column) => valueAt(row, column));
      return values.some((value) => value === null || value === undefined) ? null : JSON.stringify(values.map(String));
    };
    for (const row of changed) {
      const mine = signature(row);
      if (mine !== null && rows.some((other) => other !== row && signature(other) === mine)) {
        return { key, values: key.map((column) => valueAt(row, column)) };
      }
    }
  }
  return null;
}

function duplicateError(table, clash) {
  const isPrimary = clash.key.join() === primaryKey(table).join();
  const name = isPrimary ? `${table}_pkey` : `${table}_${clash.key.map((c) => c.replace(/\W+/g, '_')).join('_')}_key`;
  return new RestError(409, {
    code: '23505',
    details: `Key (${clash.key.join(', ')})=(${clash.values.join(', ')}) already exists.`,
    message: `duplicate key value violates unique constraint "${name}"`,
  });
}

/**
 * Deletes rows and follows the foreign keys that point at them, as Postgres
 * does: ON DELETE CASCADE deletes the rows that reference them too, SET NULL
 * clears the column, NO ACTION refuses while rows still point at them.
 * Referential actions ignore row-level security, as in Postgres.
 * `table` may be 'auth.users' (rows are then `{ id }`).
 */
function deleteCascade(table, doomed) {
  const deleting = new Map();
  const clearing = [];
  const blocking = [];
  const queue = [[table, doomed]];
  while (queue.length) {
    const [name, list] = queue.shift();
    const seen = deleting.get(name) ?? new Set();
    deleting.set(name, seen);
    const fresh = list.filter((row) => !seen.has(row));
    fresh.forEach((row) => seen.add(row));
    if (!fresh.length) continue;
    for (const fk of FOREIGN_KEYS.filter((key) => key.parent === name)) {
      const values = new Set(fresh.map((row) => row[fk.parentColumn]).filter((value) => value !== null && value !== undefined).map(String));
      if (!values.size) continue;
      const children = peek(fk.table).filter((child) => child[fk.column] !== null && child[fk.column] !== undefined && values.has(String(child[fk.column])));
      if (!children.length) continue;
      if (fk.onDelete === 'cascade') queue.push([fk.table, children]);
      else if (fk.onDelete === 'set null') children.forEach((row) => clearing.push({ table: fk.table, row, column: fk.column }));
      else children.forEach((row) => blocking.push({ fk, row }));
    }
  }
  const block = blocking.find(({ fk, row }) => !deleting.get(fk.table)?.has(row));
  if (block) {
    throw new RestError(409, {
      code: '23503',
      details: `Key (${block.fk.parentColumn})=(${block.row[block.fk.column]}) is still referenced from table "${block.fk.table}".`,
      message: `update or delete on table "${table}" violates foreign key constraint "${block.fk.name}" on table "${block.fk.table}"`,
    });
  }
  for (const { table: name, row, column } of clearing) if (!deleting.get(name)?.has(row)) row[column] = null;
  for (const [name, set] of deleting) if (tables[name]) tables[name] = tables[name].filter((row) => !set.has(row));
}

// ---------------------------------------------------------------------------
// PostgREST: selects and embedded resources

/** The foreign key behind `parent → relation(…)`: many-to-one (an object) or one-to-many (an array). */
function relationship(parent, item) {
  const fits = (fk) => !item.hint || fk.column === item.hint || fk.name === item.hint;
  const found = [
    ...FOREIGN_KEYS.filter((fk) => fk.table === parent && fk.parent === item.relation && fits(fk)).map((fk) => ({ fk, many: false })),
    ...FOREIGN_KEYS.filter((fk) => fk.table === item.relation && fk.parent === parent && fits(fk)).map((fk) => ({ fk, many: true })),
  ];
  if (found.length === 1) return found[0];
  if (found.length > 1) {
    throw new RestError(300, {
      code: 'PGRST201',
      details: found.map(({ fk }) => fk.name).join(', '),
      hint: `Try changing '${item.relation}' to one of the foreign keys above, e.g. '${item.relation}!${found[0].fk.name}'.`,
      message: `Could not embed because more than one relationship was found for '${parent}' and '${item.relation}'`,
    });
  }
  throw new RestError(400, {
    code: 'PGRST200',
    details: `Searched for a foreign key relationship between '${parent}' and '${item.relation}' in the schema 'public', but no matches were found.`,
    message: `Could not find a relationship between '${parent}' and '${item.relation}' in the schema cache`,
  });
}

/** An embedded resource for one row, with its own filters, order and limit (`alias.col=…`, `alias.order=…`). */
function embedded(table, row, item, who, params, prefix) {
  const { fk, many } = relationship(table, item);
  const filter = filterPredicate(params, prefix);
  const candidates = peek(item.relation).filter((other) => allowed('read', item.relation, other, who));
  if (many) {
    const key = row[fk.parentColumn];
    let children = candidates.filter((child) => key !== null && key !== undefined && String(child[fk.column]) === String(key) && filter(child));
    children = pageRows(orderRows(children, params.get(`${prefix}order`)), params, prefix);
    return children.map((child) => project(item.relation, child, item.children, who, params, prefix));
  }
  const value = row[fk.column];
  if (value === null || value === undefined) return null;
  const target = candidates.find((other) => String(other[fk.parentColumn]) === String(value));
  return target && filter(target) ? project(item.relation, target, item.children, who, params, prefix) : null;
}

/** A row as the select list asks for it. A selected column the row lacks is null, as in Postgres. */
function project(table, row, items, who, params, prefix = '') {
  const out = {};
  for (const item of items) {
    if (item.kind === 'star') Object.assign(out, row);
    else if (item.kind === 'column') {
      const value = valueAt(row, item.path);
      out[item.key] = castValue(value === undefined ? null : value, item.cast);
    } else {
      const name = item.alias ?? item.relation;
      const value = embedded(table, row, item, who, params, `${prefix}${name}.`);
      if (item.spread) Object.assign(out, value ?? {});
      else out[name] = value;
    }
  }
  return out;
}

/** `relation!inner(…)`: only rows whose embedded resource isn't empty. */
function passesInnerJoins(table, row, items, who, params) {
  return items.every((item) => {
    if (item.kind !== 'embed' || !item.inner) return true;
    const value = embedded(table, row, item, who, params, `${item.alias ?? item.relation}.`);
    return Array.isArray(value) ? value.length > 0 : value !== null;
  });
}

/** The rows a request's filters (and !inner joins) pick, before ordering. */
function matchingRows(table, rows, params, who, select) {
  const filter = filterPredicate(params);
  return rows.filter((row) => filter(row) && passesInnerJoins(table, row, select, who, params));
}

function wantsObject(req) {
  return String(req.headers.accept ?? '').includes('application/vnd.pgrst.object+json');
}

function countHeader(req, total, offset, length) {
  if (!/count=(exact|planned|estimated)/.test(String(req.headers.prefer ?? ''))) return {};
  return { 'content-range': length ? `${offset}-${offset + length - 1}/${total}` : `*/${total}` };
}

/** One object (Accept: …object+json, from .single() / .maybeSingle()), or the array. */
function sendRows(req, res, status, rows, headers) {
  if (wantsObject(req)) {
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
  return send(res, status, rows, headers);
}

/** After a write: the rows (Prefer: return=representation, i.e. .select()), or nothing. */
function sendWritten(req, res, url, table, rows, who, status) {
  const headers = countHeader(req, rows.length, 0, 0);
  if (!String(req.headers.prefer ?? '').includes('return=representation')) {
    return send(res, status === 201 ? 201 : 204, undefined, headers);
  }
  const select = parseSelect(url.searchParams.get('select') ?? '*');
  const shown = orderRows(rows, url.searchParams.get('order')).map((row) => project(table, row, select, who, url.searchParams));
  return sendRows(req, res, status, shown, headers);
}

function generatedColumnIn(table, input, verb) {
  const generated = GENERATED_COLUMNS[table];
  const column = generated && Object.keys(input).find((key) => key in generated);
  if (!column) return;
  throw new RestError(400, {
    code: '428C9',
    details: `Column "${column}" is a generated column.`,
    message: verb === 'insert' ? `cannot insert a non-DEFAULT value into column "${column}"` : `column "${column}" can only be updated to DEFAULT`,
  });
}

function restore(snapshots) {
  for (const [row, copy] of snapshots) {
    for (const key of Object.keys(row)) delete row[key];
    Object.assign(row, copy);
  }
}

const sameColumns = (a, b) => a.length === b.length && a.every((column) => b.includes(column));

async function insertRows(req, res, url, table, who) {
  const body = await readJson(req);
  const input = Array.isArray(body) ? body : [body];
  if (body === undefined || input.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new RestError(400, { code: 'PGRST102', message: 'Empty or invalid json' });
  }
  input.forEach((row) => generatedColumnIn(table, row, 'insert'));

  // Upserts: POST ?on_conflict=cols with Prefer: resolution=merge-duplicates|ignore-duplicates.
  // Without on_conflict PostgREST uses the primary key.
  const prefer = String(req.headers.prefer ?? '');
  const resolution = /resolution=merge-duplicates/.test(prefer) ? 'merge' : /resolution=ignore-duplicates/.test(prefer) ? 'ignore' : null;
  const onConflict = (url.searchParams.get('on_conflict') ?? '').split(',').map((c) => c.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const target = resolution ? (onConflict.length ? onConflict : primaryKey(table)) : null;
  if (target && KNOWN_TABLES.has(table) && !uniqueKeys(table).some((key) => sameColumns(key, target))) {
    throw new RestError(400, { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' });
  }

  const rows = tableRows(table);
  const inserted = [];
  const merged = [];
  const written = [];
  const snapshots = new Map();
  try {
    for (const raw of input) {
      const candidate = completeRow(table, raw);
      if (target) {
        const same = (row) =>
          target.every((column) => {
            const a = valueAt(row, column);
            const b = valueAt(candidate, column);
            return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
          });
        const existing = rows.find(same) ?? inserted.find(same);
        if (existing) {
          if (resolution === 'ignore') continue;
          if (!allowed('update', table, existing, who)) throw rlsError(table, who);
          if (!snapshots.has(existing)) snapshots.set(existing, { ...existing });
          Object.assign(existing, raw, { updated_at: timestamp() });
          applyGenerated(table, existing);
          if (!allowed('update', table, existing, who)) throw rlsError(table, who);
          if (!merged.includes(existing)) merged.push(existing);
          written.push(existing);
          continue;
        }
      }
      if (!allowed('insert', table, candidate, who)) throw rlsError(table, who);
      inserted.push(candidate);
      written.push(candidate);
    }
    const clash = uniqueClash(table, [...rows, ...inserted], [...inserted, ...merged]);
    if (clash) throw duplicateError(table, clash);
  } catch (error) {
    restore(snapshots);
    throw error;
  }
  rows.push(...inserted);
  return sendWritten(req, res, url, table, written, who, 201);
}

async function updateRows(req, res, url, table, who, select) {
  const patch = await readJson(req);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new RestError(400, { code: 'PGRST102', message: 'Empty or invalid json' });
  generatedColumnIn(table, patch, 'update');
  const rows = tableRows(table);
  const visible = rows.filter((row) => allowed('read', table, row, who) && allowed('update', table, row, who));
  const targets = pageRows(orderRows(matchingRows(table, visible, url.searchParams, who, select), url.searchParams.get('order')), url.searchParams);
  if (!who.service && table === 'profiles') {
    const changed = PROFILE_SERVER_COLUMNS.find((column) => column in patch && targets.some((row) => String(row[column] ?? null) !== String(patch[column] ?? null)));
    if (changed) {
      throw new RestError(403, { code: '42501', message: 'profiles: id, email, organization_id and created_at change through the server only' });
    }
  }
  const snapshots = new Map(targets.map((row) => [row, { ...row }]));
  try {
    for (const row of targets) {
      Object.assign(row, patch, { updated_at: timestamp() });
      applyGenerated(table, row);
      if (!allowed('update', table, row, who)) throw rlsError(table, who);
    }
    const clash = uniqueClash(table, rows, targets);
    if (clash) throw duplicateError(table, clash);
  } catch (error) {
    restore(snapshots);
    throw error;
  }
  return sendWritten(req, res, url, table, targets, who, 200);
}

function deleteRows(req, res, url, table, who, select) {
  const visible = tableRows(table).filter((row) => allowed('read', table, row, who) && allowed('delete', table, row, who));
  const targets = pageRows(orderRows(matchingRows(table, visible, url.searchParams, who, select), url.searchParams.get('order')), url.searchParams);
  deleteCascade(table, targets);
  return sendWritten(req, res, url, table, targets, who, 200);
}

// ---------------------------------------------------------------------------
// RPCs (POST /rest/v1/rpc/<name>)

const min = (values) => values.reduce((a, b) => (b < a ? b : a));
const max = (values) => values.reduce((a, b) => (b > a ? b : a));
const clamp = (value, fallback, low, high) => Math.min(Math.max(Number(value ?? fallback) || fallback, low), high);

/** company_question_bank (0031): shared questions for one company, one row per question, never who shared it. */
function companyQuestionBank({ p_company = null, p_limit = 100 } = {}) {
  const company = lowerBtrim(p_company);
  const groups = new Map();
  for (const row of peek('company_questions')) {
    if (row.shared !== true || company === null || row.company_key !== company) continue;
    groups.set(row.question_key, [...(groups.get(row.question_key) ?? []), row]);
  }
  return [...groups.values()]
    .map((group) => ({
      question_text: min(group.map((row) => row.question_text)),
      question_type: min(group.map((row) => row.question_type)),
      reports: new Set(group.map((row) => row.user_id)).size,
      last_reported_at: max(group.map((row) => row.created_at)),
    }))
    .sort((a, b) => b.reports - a.reports || Date.parse(b.last_reported_at) - Date.parse(a.last_reported_at))
    .slice(0, clamp(p_limit, 100, 1, 200));
}

/** company_question_companies (0031): companies with shared questions, by how many distinct questions. */
function companyQuestionCompanies({ p_query = null, p_limit = 20 } = {}) {
  // `company_key like '%' || <the query, with \ % _ escaped> || '%'`: the query as a plain substring.
  const needle = p_query === null || p_query === undefined ? null : lowerBtrim(p_query);
  const groups = new Map();
  for (const row of peek('company_questions')) {
    if (row.shared !== true || (needle !== null && !String(row.company_key).includes(needle))) continue;
    groups.set(row.company_key, [...(groups.get(row.company_key) ?? []), row]);
  }
  return [...groups.values()]
    .map((group) => ({ company: min(group.map((row) => row.company)), questions: new Set(group.map((row) => row.question_key)).size }))
    .sort((a, b) => b.questions - a.questions)
    .slice(0, clamp(p_limit, 20, 1, 50));
}

/** `authenticated`: execute is granted to signed-in users only (and the service role), not anon. */
const RPCS = {
  check_quota: { run: () => [{ allowed: true, used: 0, limit_val: 400, remaining: 400 }] },
  get_user_plan: {
    run: () => [{ plan_id: 'pro', plan_name: 'Pro', copilot_minutes_monthly: 400, copilot_session_minutes: 60, copilot_daily_minutes: 120 }],
  },
  company_question_bank: { authenticated: true, run: companyQuestionBank },
  company_question_companies: { authenticated: true, run: companyQuestionCompanies },
};

async function callRpc(req, res, url, name, who) {
  const args = (req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readJson(req)) ?? {};
  rpcCalls.push({ fn: name, body: args, service: who.service });
  const rpc = RPCS[name];
  if (!rpc) return send(res, 200, null); // other functions answer null rather than failing the app
  if (rpc.authenticated && !who.service && !who.userId) {
    throw new RestError(401, { code: '42501', message: `permission denied for function ${name}` });
  }
  const result = rpc.run(args, who);
  if (!Array.isArray(result)) return send(res, 200, result);
  // A function returning a table takes filters, order and limit like a table.
  const params = req.method === 'GET' ? new URLSearchParams() : url.searchParams;
  const rows = pageRows(orderRows(result.filter(filterPredicate(params)), params.get('order')), params);
  return sendRows(req, res, 200, rows, {});
}

async function handleRest(req, res, url) {
  const who = caller(req);
  const [, , , rawTable, rawFn] = url.pathname.split('/'); // /rest/v1/<table> or /rest/v1/rpc/<fn>
  const table = decodeURIComponent(rawTable ?? '');
  if (table === 'rpc') return callRpc(req, res, url, decodeURIComponent(rawFn ?? ''), who);
  if (!table) return send(res, 404, { message: 'not found' });
  const select = parseSelect(url.searchParams.get('select') ?? '*');

  if (req.method === 'GET' || req.method === 'HEAD') {
    const readable = tableRows(table).filter((row) => allowed('read', table, row, who));
    const ordered = orderRows(matchingRows(table, readable, url.searchParams, who, select), url.searchParams.get('order'));
    const page = pageRows(ordered, url.searchParams);
    const offset = Number(url.searchParams.get('offset') ?? 0) || 0;
    const shown = page.map((row) => project(table, row, select, who, url.searchParams));
    return sendRows(req, res, 200, shown, countHeader(req, ordered.length, offset, shown.length));
  }
  if (req.method === 'POST') return insertRows(req, res, url, table, who);
  if (req.method === 'PATCH') return updateRows(req, res, url, table, who, select);
  if (req.method === 'DELETE') return deleteRows(req, res, url, table, who, select);
  return send(res, 405, { message: 'method not allowed' });
}

// ---------------------------------------------------------------------------
// Auth (GoTrue)

/** GoTrue's API version header: with it, supabase-js reads `code` from error bodies. */
const AUTH_HEADERS = { 'x-supabase-api-version': '2024-01-01' };

function authSend(res, status, body) {
  return send(res, status, body, AUTH_HEADERS);
}

function authError(res, status, code, message, extra = {}) {
  return authSend(res, status, { code, error_code: code, msg: message, ...extra });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6; // GoTrue's default minimum length

function weakPassword(res) {
  return authError(res, 422, 'weak_password', `Password should be at least ${MIN_PASSWORD} characters.`, {
    weak_password: { reasons: ['length'] },
  });
}

/** The signed-in user behind a request's access token, or an error response already sent. */
function requireUser(req, res) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const { claims } = readJwt(token);
  if (!claims?.sub) {
    authError(res, 403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is malformed');
    return null;
  }
  const user = users.get(claims.sub);
  if (!user) {
    authError(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist');
    return null;
  }
  if (!sessions.has(claims.session_id)) {
    authError(res, 403, 'session_not_found', 'Session from session_id claim in JWT does not exist');
    return null;
  }
  return user;
}

/** Go durations as GoTrue reads ban_duration: "24h", "1h30m", "876000h", or "none". */
function durationMs(text) {
  const units = { ns: 1e-6, us: 1e-3, µs: 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  const parts = [...String(text).matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)];
  if (!parts.length || parts.map((p) => p[0]).join('') !== String(text)) return null;
  return parts.reduce((total, [, amount, unit]) => total + Number(amount) * units[unit], 0);
}

function mergeMetadata(current, changes) {
  const next = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Deletes an auth user and everything the foreign keys say goes with them. */
function deleteUser(user) {
  deleteCascade('auth.users', [{ id: user.id }]);
  users.delete(user.id);
  endSessions(user.id);
}

async function handleAdmin(req, res, url) {
  if (!caller(req).service) return authError(res, 403, 'not_admin', 'User not allowed');
  const match = /^\/auth\/v1\/admin\/users(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match) return authError(res, 404, 'not_found', 'Not found');
  const id = match[1] ? decodeURIComponent(match[1]) : null;

  if (!id) {
    if (req.method === 'GET') {
      const page = Math.max(Number(url.searchParams.get('page') ?? 1) || 1, 1);
      const perPage = Math.max(Number(url.searchParams.get('per_page') ?? 50) || 50, 1);
      const all = [...users.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      return send(res, 200, { users: all.slice((page - 1) * perPage, page * perPage).map(userJson), aud: 'authenticated' }, {
        ...AUTH_HEADERS,
        'x-total-count': String(all.length),
      });
    }
    if (req.method === 'POST') {
      const body = (await readJson(req)) ?? {};
      if (!EMAIL.test(String(body.email ?? ''))) return authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
      if (findUserByEmail(body.email)) return authError(res, 422, 'email_exists', 'A user with this email address has already been registered');
      if (body.password !== undefined && String(body.password).length < MIN_PASSWORD) return weakPassword(res);
      const user = createUser({
        email: body.email,
        password: body.password ?? null,
        userMetadata: body.user_metadata ?? {},
        appMetadata: body.app_metadata ? { provider: 'email', providers: ['email'], ...body.app_metadata } : null,
        confirmed: body.email_confirm === true,
      });
      authAdminCalls.push({ method: 'POST', userId: user.id, email: user.email, at: timestamp() });
      return authSend(res, 200, userJson(user));
    }
    return authError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  const user = users.get(id);
  if (!user) return authError(res, 404, 'user_not_found', 'User not found');
  if (req.method === 'GET') return authSend(res, 200, userJson(user));
  if (req.method === 'PUT') {
    const body = (await readJson(req)) ?? {};
    if (body.password !== undefined && String(body.password).length < MIN_PASSWORD) return weakPassword(res);
    if (body.email !== undefined) {
      const other = findUserByEmail(body.email);
      if (other && other.id !== user.id) return authError(res, 422, 'email_exists', 'A user with this email address has already been registered');
      user.email = String(body.email).trim().toLowerCase();
    }
    if (body.ban_duration !== undefined) {
      if (body.ban_duration === 'none') user.banned_until = null;
      else {
        const ms = durationMs(body.ban_duration);
        if (ms === null) return authError(res, 400, 'validation_failed', 'invalid format for ban duration: ' + body.ban_duration);
        user.banned_until = new Date(Date.now() + ms).toISOString();
        // GoTrue signs a banned user out everywhere.
        endSessions(user.id);
      }
    }
    if (body.password !== undefined) user.password = String(body.password);
    if (body.email_confirm === true && !user.email_confirmed_at) user.email_confirmed_at = timestamp();
    if (body.user_metadata) user.user_metadata = mergeMetadata(user.user_metadata, body.user_metadata);
    if (body.app_metadata) user.app_metadata = mergeMetadata(user.app_metadata, body.app_metadata);
    user.updated_at = timestamp();
    authAdminCalls.push({
      method: 'PUT',
      userId: user.id,
      ...(body.ban_duration !== undefined ? { ban_duration: body.ban_duration } : {}),
      ...(body.email_confirm !== undefined ? { email_confirm: body.email_confirm } : {}),
      ...(body.password !== undefined ? { password: '(changed)' } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.user_metadata ? { user_metadata: body.user_metadata } : {}),
      ...(body.app_metadata ? { app_metadata: body.app_metadata } : {}),
      banned_until: user.banned_until,
      at: timestamp(),
    });
    return authSend(res, 200, userJson(user));
  }
  if (req.method === 'DELETE') {
    deleteUser(user);
    authAdminCalls.push({ method: 'DELETE', userId: user.id, email: user.email, at: timestamp() });
    return authSend(res, 200, {});
  }
  return authError(res, 405, 'method_not_allowed', 'Method not allowed');
}

async function handleAuth(req, res, url) {
  if (url.pathname.startsWith('/auth/v1/admin/')) return handleAdmin(req, res, url);

  // Sign-up with email and password. Email confirmation is off (autoconfirm), so it signs in at once.
  if (url.pathname === '/auth/v1/signup' && req.method === 'POST') {
    const body = (await readJson(req)) ?? {};
    const email = String(body.email ?? '').trim();
    if (!email || !body.password) return authError(res, 422, 'validation_failed', 'Signup requires a valid password');
    if (!EMAIL.test(email)) return authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
    if (String(body.password).length < MIN_PASSWORD) return weakPassword(res);
    if (findUserByEmail(email)) return authError(res, 422, 'user_already_exists', 'User already registered');
    const user = createUser({ email, password: String(body.password), userMetadata: body.data ?? {} });
    return authSend(res, 200, sessionFor(user));
  }

  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const body = (await readJson(req)) ?? {};
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const user = findUserByEmail(body.email);
      if (!user || user.password === null || user.password !== body.password) {
        return authError(res, 400, 'invalid_credentials', 'Invalid login credentials', { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      }
      if (!user.email_confirmed_at) return authError(res, 400, 'email_not_confirmed', 'Email not confirmed');
      if (isBanned(user)) return authError(res, 400, 'user_banned', 'User is banned');
      user.last_sign_in_at = timestamp();
      return authSend(res, 200, sessionFor(user));
    }
    if (grant === 'refresh_token') {
      const sessionId = refreshTokens.get(String(body.refresh_token ?? ''));
      const user = sessionId && sessions.has(sessionId) ? users.get(sessions.get(sessionId)) : null;
      if (!user) return authError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      if (isBanned(user)) return authError(res, 400, 'user_banned', 'User is banned');
      return authSend(res, 200, sessionFor(user, sessionId));
    }
    // The code exchange: the verifier must hash to the challenge sent at /authorize (S256), once.
    if (grant === 'pkce' && oauthCodes.has(body.auth_code)) {
      const challenge = oauthCodes.get(body.auth_code);
      oauthCodes.delete(body.auth_code);
      const hashed = createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64url');
      if (hashed === challenge) {
        const user = users.get(USER.id);
        user.last_sign_in_at = timestamp();
        return authSend(res, 200, sessionFor(user));
      }
      return authError(res, 400, 'bad_code_verifier', 'code challenge does not match previously saved code verifier', { error: 'invalid_grant' });
    }
    return authError(res, 400, 'invalid_credentials', 'Invalid login credentials', { error: 'invalid_grant', error_description: 'Invalid login credentials' });
  }

  if (url.pathname === '/auth/v1/user') {
    if (req.method === 'GET') {
      const user = requireUser(req, res);
      return user ? authSend(res, 200, userJson(user)) : undefined;
    }
    // updateUser: a new password (the reset page), email or metadata. Email changes apply at once (autoconfirm).
    if (req.method === 'PUT') {
      const user = requireUser(req, res);
      if (!user) return undefined;
      const body = (await readJson(req)) ?? {};
      if (body.password !== undefined) {
        if (String(body.password).length < MIN_PASSWORD) return weakPassword(res);
        if (String(body.password) === user.password) {
          return authError(res, 422, 'same_password', 'New password should be different from the old password.');
        }
        user.password = String(body.password);
      }
      if (body.email !== undefined && String(body.email).trim().toLowerCase() !== user.email) {
        if (!EMAIL.test(String(body.email))) return authError(res, 400, 'validation_failed', 'Unable to validate email address: invalid format');
        if (findUserByEmail(body.email)) return authError(res, 422, 'email_exists', 'A user with this email address has already been registered');
        user.email = String(body.email).trim().toLowerCase();
      }
      if (body.data) user.user_metadata = mergeMetadata(user.user_metadata, body.data);
      user.updated_at = timestamp();
      return authSend(res, 200, userJson(user));
    }
  }

  // Signing out keeps the session: other tests share USER's account, and a real "global" sign-out
  // would end every one of their sessions.
  if (url.pathname === '/auth/v1/logout') return send(res, 204, undefined, AUTH_HEADERS);

  // "Continue with Google": Supabase would send the browser to Google; the fake goes straight back to the
  // app's callback with a one-time code, as Supabase does once Google says yes.
  if (url.pathname === '/auth/v1/authorize') {
    const provider = url.searchParams.get('provider');
    const redirectTo = url.searchParams.get('redirect_to');
    const challenge = url.searchParams.get('code_challenge');
    oauthRequests.push({ provider, redirectTo, pkce: Boolean(challenge) });
    if (provider !== 'google' || !redirectTo || !challenge) return send(res, 400, { error: 'invalid_request' });
    const code = randomUUID();
    oauthCodes.set(code, challenge);
    const back = new URL(redirectTo);
    back.searchParams.set('code', code);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }
  if (url.pathname === '/auth/v1/recover') {
    const body = (await readJson(req)) ?? {};
    recoverRequests.push({ email: body.email, redirectTo: url.searchParams.get('redirect_to') });
    return authSend(res, 200, {});
  }
  // No team has single sign-on set up here.
  if (url.pathname === '/auth/v1/sso') return authError(res, 404, 'sso_provider_not_found', 'No SSO provider assigned for this domain');
  if (url.pathname === '/auth/v1/settings') {
    return authSend(res, 200, { external: { email: true, google: true }, disable_signup: false, mailer_autoconfirm: true, phone_autoconfirm: false, sms_provider: '', saml_enabled: false });
  }
  return send(res, 404, { message: 'not found' });
}

// ---------------------------------------------------------------------------
// Storage

function storageError(res, statusCode, error, message) {
  return send(res, 400, { statusCode: String(statusCode), error, message });
}

/** storage.objects policies (0006): a user reads and writes only `resumes/<their id>/…`. */
function storageAllowed(who, bucket, name) {
  if (who.service) return true;
  return who.userId !== null && bucket === 'resumes' && name.split('/')[0] === who.userId;
}

const objectKey = (bucket, name) => `${bucket}/${name}`;
const decodePath = (path) => path.split('/').map(decodeURIComponent).join('/');

function objectJson(object) {
  return {
    id: object.id,
    bucket_id: object.bucket,
    name: object.name,
    owner: object.owner,
    created_at: object.created_at,
    updated_at: object.updated_at,
    last_accessed_at: object.updated_at,
    metadata: { size: object.bytes.length, mimetype: object.contentType, cacheControl: object.cacheControl },
  };
}

/** The bytes and type of an upload: a raw body, or the file in a multipart form (browser File/Blob uploads). */
async function uploadedFile(req) {
  const body = await readBody(req);
  const type = String(req.headers['content-type'] ?? 'application/octet-stream');
  if (!type.startsWith('multipart/form-data')) return { bytes: body, contentType: type };
  const form = await new Request('http://fake.invalid/', { method: 'POST', headers: { 'content-type': type }, body }).formData();
  const file = [...form.values()].find((value) => typeof value === 'object' && value !== null && 'arrayBuffer' in value);
  if (!file) return { bytes: Buffer.alloc(0), contentType: 'application/octet-stream' };
  return { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type || 'application/octet-stream' };
}

async function handleStorage(req, res, url) {
  const who = caller(req);
  const path = url.pathname.slice('/storage/v1'.length);
  let match;

  // Signed URLs: POST makes one (createSignedUrl), GET with ?token= downloads with it (no other auth).
  if ((match = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(path))) {
    const bucket = decodeURIComponent(match[1]);
    const name = decodePath(match[2]);
    const object = objects.get(objectKey(bucket, name));
    if (req.method === 'POST') {
      const body = (await readJson(req)) ?? {};
      if (!object || !storageAllowed(who, bucket, name)) return storageError(res, 404, 'not_found', 'Object not found');
      const expiresIn = Math.max(Number(body.expiresIn) || 60, 1);
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt({ url: objectKey(bucket, name), iat: now, exp: now + expiresIn });
      return send(res, 200, { signedURL: `/object/sign/${objectKey(bucket, name)}?token=${token}` });
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const { claims, error } = readJwt(url.searchParams.get('token'));
      if (error === 'expired') return storageError(res, 400, 'InvalidJWT', 'jwt expired');
      if (!claims || claims.url !== objectKey(bucket, name)) return storageError(res, 400, 'InvalidSignature', 'The signature you provided is invalid');
      if (!object) return storageError(res, 404, 'not_found', 'Object not found');
      const download = url.searchParams.get('download');
      res.writeHead(200, {
        'content-type': object.contentType,
        'content-length': String(object.bytes.length),
        'cache-control': `max-age=${object.cacheControl}`,
        etag: `"${object.sha256}"`,
        ...(download !== null ? { 'content-disposition': `attachment; filename="${download || name.split('/').pop()}"` } : {}),
      });
      return res.end(req.method === 'HEAD' ? undefined : object.bytes);
    }
  }

  // remove(): DELETE /object/<bucket> {prefixes: [names]}
  if ((match = /^\/object\/([^/]+)\/?$/.exec(path)) && req.method === 'DELETE') {
    const bucket = decodeURIComponent(match[1]);
    const body = (await readJson(req)) ?? {};
    const removed = [];
    for (const name of Array.isArray(body.prefixes) ? body.prefixes : []) {
      const key = objectKey(bucket, String(name));
      const object = objects.get(key);
      if (object && storageAllowed(who, bucket, object.name)) {
        objects.delete(key);
        removed.push(objectJson(object));
      }
    }
    return send(res, 200, removed);
  }

  // Upload (POST, x-upsert), update (PUT), download (GET), one object at a time.
  if ((match = /^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(path))) {
    const bucket = decodeURIComponent(match[1]);
    const name = decodePath(match[2]);
    const key = objectKey(bucket, name);
    if (!BUCKETS.has(bucket)) return storageError(res, 404, 'Bucket not found', 'Bucket not found');
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!storageAllowed(who, bucket, name)) return storageError(res, 403, 'Unauthorized', 'new row violates row-level security policy');
      const existing = objects.get(key);
      if (req.method === 'POST' && existing && String(req.headers['x-upsert']) !== 'true') {
        return storageError(res, 409, 'Duplicate', 'The resource already exists');
      }
      if (req.method === 'PUT' && !existing) return storageError(res, 404, 'not_found', 'Object not found');
      const { bytes, contentType } = await uploadedFile(req);
      const now = timestamp();
      const object = {
        id: existing?.id ?? randomUUID(),
        bucket,
        name,
        bytes,
        contentType,
        cacheControl: String(req.headers['cache-control'] ?? 'max-age=3600').replace(/^max-age=/, ''),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        owner: who.userId,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      };
      objects.set(key, object);
      return send(res, 200, { Key: key, Id: object.id });
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const object = objects.get(key);
      if (!object || !storageAllowed(who, bucket, name)) return storageError(res, 404, 'not_found', 'Object not found');
      res.writeHead(200, { 'content-type': object.contentType, 'content-length': String(object.bytes.length) });
      return res.end(req.method === 'HEAD' ? undefined : object.bytes);
    }
  }
  return storageError(res, 404, 'not_found', 'Not found');
}

// ---------------------------------------------------------------------------
// The server

function state() {
  return {
    tables,
    rpcCalls,
    recoverRequests,
    oauthRequests,
    authAdminCalls,
    users: [...users.values()].map(userJson),
    storage: [...objects.values()].map((object) => ({
      bucket: object.bucket,
      name: object.name,
      size: object.bytes.length,
      contentType: object.contentType,
      sha256: object.sha256,
      owner: object.owner,
      created_at: object.created_at,
      updated_at: object.updated_at,
    })),
  };
}

export function startFakeSupabase(port) {
  const server = http.createServer(async (req, res) => {
    // The browser calls this directly from the app's origin.
    res.setHeader('access-control-allow-origin', req.headers.origin ?? '*');
    res.setHeader('access-control-allow-credentials', 'true');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
    res.setHeader(
      'access-control-allow-headers',
      req.headers['access-control-request-headers'] ??
        'apikey,authorization,content-type,prefer,accept-profile,content-profile,x-client-info,x-supabase-api-version,x-upsert,cache-control',
    );
    res.setHeader('access-control-expose-headers', 'content-range,x-supabase-api-version,x-total-count,content-disposition');
    if (req.method === 'OPTIONS') return send(res, 204);

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/__health') return send(res, 200, { ok: true });
      if (url.pathname === '/__state') return send(res, 200, state());
      if (url.pathname === '/__reset') {
        seed();
        rpcCalls.length = 0;
        recoverRequests.length = 0;
        oauthRequests.length = 0;
        authAdminCalls.length = 0;
        oauthCodes.clear();
        return send(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
      if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url);
      if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url);
      return send(res, 404, { message: 'not found' });
    } catch (error) {
      if (error instanceof RestError) return send(res, error.status, error.body);
      console.error('[fake supabase]', req.method, req.url, error);
      return send(res, 500, { message: String(error) });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
