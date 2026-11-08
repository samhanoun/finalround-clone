/**
 * Where uploaded résumé files live in Supabase Storage, and the check that
 * keeps service-role storage calls inside the signed-in user's own folder.
 *
 * Users can edit their own resume_documents rows, so the stored bucket and
 * path are never trusted on their own: before the server signs, downloads or
 * removes a stored object with the service role, the object must be in the
 * résumés bucket, under `<userId>/`, with no path tricks. (Migration 0032 also
 * stops users changing those columns; this check stays as defence in depth.)
 */

export const RESUME_BUCKET = 'resumes';

/** A ".." path segment (not a ".." inside a name such as "John..Doe.pdf"). */
const PARENT_SEGMENT = /(^|\/)\.\.(\/|$)/;

/** True only for an object in the résumés bucket, inside `<userId>/`, without "..", "\" or "//". */
export function isOwnResumeObject(userId: string, bucket: string | null | undefined, path: string | null | undefined): boolean {
  if (!userId || bucket !== RESUME_BUCKET || typeof path !== 'string') return false;
  if (!path.startsWith(`${userId}/`)) return false;
  return !PARENT_SEGMENT.test(path) && !path.includes('\\') && !path.includes('//');
}

const MAX_NAME_LENGTH = 120;

/**
 * The uploaded file's name as it appears in the storage path: only letters,
 * digits, dots, underscores, spaces and dashes, and at most 120 characters
 * (the extension is kept). The original name stays in the row for display.
 */
export function storageFileName(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9._ -]/g, '-').trim();
  if (!safe) return 'resume';
  if (safe.length <= MAX_NAME_LENGTH) return safe;
  const dot = safe.lastIndexOf('.');
  const extension = dot > 0 && safe.length - dot <= 10 ? safe.slice(dot) : '';
  return `${safe.slice(0, MAX_NAME_LENGTH - extension.length).trimEnd()}${extension}`;
}

/** `<userId>/<timestamp>-<safe name>`: a new upload's path in RESUME_BUCKET. */
export function resumeObjectPath(userId: string, fileName: string, now = Date.now()): string {
  return `${userId}/${now}-${storageFileName(fileName)}`;
}
