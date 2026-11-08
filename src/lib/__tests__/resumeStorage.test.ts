import { isOwnResumeObject, RESUME_BUCKET, resumeObjectPath, storageFileName } from '@/lib/resumeStorage';

const USER = '0e2e0000-0000-4000-8000-000000000001';
const OTHER = '9f9f0000-0000-4000-8000-000000000002';

describe('isOwnResumeObject', () => {
  it("accepts an object in the résumés bucket inside the user's folder", () => {
    expect(isOwnResumeObject(USER, RESUME_BUCKET, `${USER}/1730000000000-cv.pdf`)).toBe(true);
    // ".." inside a name is fine; only a ".." path segment is a trick.
    expect(isOwnResumeObject(USER, 'resumes', `${USER}/1730000000000-John..Doe.pdf`)).toBe(true);
  });

  it("refuses another user's folder, including a folder that only starts like the user's id", () => {
    expect(isOwnResumeObject(USER, 'resumes', `${OTHER}/cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', `${USER}x/cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', `x/${USER}/cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', USER)).toBe(false);
  });

  it('refuses any other bucket', () => {
    expect(isOwnResumeObject(USER, 'avatars', `${USER}/cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, 'Resumes', `${USER}/cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, null, `${USER}/cv.pdf`)).toBe(false);
  });

  it('refuses parent segments, backslashes and empty segments', () => {
    expect(isOwnResumeObject(USER, 'resumes', `${USER}/../${OTHER}/cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', `${USER}/..`)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', `${USER}/a/../../${OTHER}/cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', `${USER}/..\\${OTHER}\\cv.pdf`)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', `${USER}//cv.pdf`)).toBe(false);
  });

  it('refuses a missing path or user', () => {
    expect(isOwnResumeObject(USER, 'resumes', null)).toBe(false);
    expect(isOwnResumeObject(USER, 'resumes', undefined)).toBe(false);
    expect(isOwnResumeObject('', 'resumes', '/cv.pdf')).toBe(false);
  });
});

describe('storageFileName and resumeObjectPath', () => {
  it('keeps letters, digits, dots, underscores, spaces and dashes, and replaces the rest', () => {
    expect(storageFileName('Jane Doe_CV-2026.pdf')).toBe('Jane Doe_CV-2026.pdf');
    // The slashes go, so the dots left behind are part of a name, never a path segment.
    expect(storageFileName('Résumé (final)/../x.pdf')).toBe('R-sum- -final--..-x.pdf');
    expect(storageFileName('a\\b?c#d.docx')).toBe('a-b-c-d.docx');
    expect(storageFileName('John..Doe.pdf')).toBe('John..Doe.pdf');
  });

  it('shortens a long name but keeps its extension', () => {
    const name = storageFileName(`${'x'.repeat(300)}.docx`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('.docx')).toBe(true);
  });

  it('never gives an empty name', () => {
    expect(storageFileName('   ')).toBe('resume');
  });

  it("builds a path in the user's folder that passes the ownership check", () => {
    const path = resumeObjectPath(USER, '../../etc/passwd.pdf', 1730000000000);
    expect(path).toBe(`${USER}/1730000000000-..-..-etc-passwd.pdf`);
    expect(isOwnResumeObject(USER, RESUME_BUCKET, path)).toBe(true);
  });
});
