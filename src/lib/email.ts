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
const DEFAULT_FROM_NAME = process.env.EMAIL_FROM_NAME || 'FinalRound';

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!apiKey) {
    console.warn('SENDGRID_API_KEY not configured - email not sent:', options.subject);
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
    await sgMail.send(msg as any);
    console.log(`Email sent: ${options.subject} to ${options.to}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

// Helper to render React Email templates
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderEmail<T>(Component: React.ComponentType<T>, props: T): Promise<string> {
  const element = React.createElement(Component as any, props as any);
  return await render(element, {
    plainText: true,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderEmailHtml<T>(Component: React.ComponentType<T>, props: T): Promise<string> {
  const element = React.createElement(Component as any, props as any);
  return await render(element);
}
