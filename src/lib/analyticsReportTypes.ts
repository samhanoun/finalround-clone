/** Scheduled report choices (safe to import in the browser). */

export const REPORT_TYPES = ['summary', 'job_search', 'practice', 'full'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_FREQUENCIES = ['weekly', 'monthly'] as const;
export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];
