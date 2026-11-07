import sgMail from '@sendgrid/mail';
import { render } from '@react-email/render';
import React from 'react';

// Initialize SendGrid
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

export interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
}

const DEFAULT_FROM_EMAIL = process.env.EMAIL_FROM_ADDRESS || 'noreply@finalroundy.com';
const DEFAULT_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Apex Round';

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!apiKey) {
    console.warn('[email] SENDGRID_API_KEY is not set; not sent:', options.subject);
    return false;
  }

  const msg = {
    to: options.to,
    from: options.from || `${DEFAULT_FROM_NAME} <${DEFAULT_FROM_EMAIL}>`,
    subject: options.subject,
    text: options.text,
    html: options.html,
    ...(options.templateId && { templateId: options.templateId }),
    ...(options.dynamicTemplateData && { dynamicTemplateData: options.dynamicTemplateData }),
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sgMail.send(msg as any);
    return true;
  } catch (error) {
    console.error('Error sending email:', error instanceof Error ? error.message : error);
    return false;
  }
}

// Helper to render React Email templates
export async function renderEmail<T extends object>(Component: React.ComponentType<T>, props: T): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(Component as any, props);
  return await render(element, {
    plainText: true,
  });
}

export async function renderEmailHtml<T extends object>(Component: React.ComponentType<T>, props: T): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(Component as any, props);
  return await render(element);
}
