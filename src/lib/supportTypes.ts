/** Help & support types (safe to import in the browser). */

export const SUPPORT_CATEGORIES = ['technical', 'billing', 'account', 'feature_request', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export type SupportMessage = { id: string; is_from_admin: boolean; content: string; created_at: string };

export type SupportTicket = {
  id: string;
  subject: string;
  description: string;
  category: SupportCategory;
  status: 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
  created_at: string;
  updated_at: string;
  messages: SupportMessage[];
};
