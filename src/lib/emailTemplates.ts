/** Plain, inline-styled emails (most mail apps ignore <style> blocks). */

const MIDNIGHT = '#0B1324';
const DECK = '#111B30';
const EMBER = '#FFB547';
const PAPER = '#F4F6FB';
const MUTED = '#9AA6BF';

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
}

/** An absolute link for an app path ("/jobs"), or null when the app URL isn't set. */
export function absoluteUrl(path?: string): string | null {
  const base = appUrl();
  if (!path || !base) return null;
  return path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Section = { heading: string; lines: string[] };

/** One email layout: a title, paragraphs, optional sections and one button. */
export function renderEmail({
  title,
  paragraphs,
  sections = [],
  button,
  footer = 'You get this email because of your Apex Round notification settings.',
  settingsLabel = 'Change settings',
}: {
  title: string;
  paragraphs: string[];
  sections?: Section[];
  button?: { label: string; url: string | null };
  footer?: string;
  settingsLabel?: string;
}): { html: string; text: string } {
  const buttonUrl = button?.url ?? null;
  const settingsUrl = absoluteUrl('/settings');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${MIDNIGHT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MIDNIGHT};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${DECK};border-radius:14px;padding:28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:${PAPER};">
<tr><td style="font-size:13px;letter-spacing:.04em;color:${EMBER};font-weight:600;padding-bottom:18px;">Apex Round</td></tr>
<tr><td style="font-size:20px;font-weight:600;line-height:1.3;padding-bottom:12px;">${escapeHtml(title)}</td></tr>
${paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.55;color:${PAPER};padding-bottom:12px;">${escapeHtml(p)}</td></tr>`).join('\n')}
${sections
  .map(
    (section) => `<tr><td style="padding:8px 0 4px;font-size:14px;font-weight:600;color:${PAPER};">${escapeHtml(section.heading)}</td></tr>
<tr><td style="font-size:14px;line-height:1.55;color:${MUTED};padding-bottom:8px;">${section.lines.map((line) => escapeHtml(line)).join('<br>')}</td></tr>`,
  )
  .join('\n')}
${
  button && buttonUrl
    ? `<tr><td style="padding:12px 0 4px;"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:${EMBER};color:${MIDNIGHT};text-decoration:none;font-weight:600;font-size:15px;padding:11px 18px;border-radius:10px;">${escapeHtml(button.label)}</a></td></tr>`
    : ''
}
<tr><td style="font-size:12px;line-height:1.5;color:${MUTED};padding-top:22px;">${escapeHtml(footer)}${
    settingsUrl ? ` <a href="${escapeHtml(settingsUrl)}" style="color:${MUTED};">${escapeHtml(settingsLabel)}</a>` : ''
  }</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    title,
    '',
    ...paragraphs,
    ...sections.flatMap((section) => ['', section.heading, ...section.lines.map((line) => `- ${line}`)]),
    ...(button && buttonUrl ? ['', `${button.label}: ${buttonUrl}`] : []),
    '',
    footer,
    ...(settingsUrl ? [`${settingsLabel}: ${settingsUrl}`] : []),
  ].join('\n');

  return { html, text };
}

