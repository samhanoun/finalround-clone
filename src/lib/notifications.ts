import { createAdminClient } from '@/lib/supabase/admin';

export type NotificationType = 'interview_reminder' | 'application_update' | 'ai_suggestion' | 'system';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export async function createNotification({
  userId,
  type,
  title,
  message,
  data = {},
}: CreateNotificationParams) {
  const supabase = createAdminClient();

  const { data: notification, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      message,
      data,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create notification:', error);
    return null;
  }

  return notification;
}

// Helper functions for common notification scenarios
export async function notifyInterviewReminder(userId: string, interviewTitle: string, scheduledAt: Date) {
  return createNotification({
    userId,
    type: 'interview_reminder',
    title: 'Interview Reminder',
    message: `Your interview "${interviewTitle}" is coming up soon!`,
    data: {
      interviewTitle,
      scheduledAt: scheduledAt.toISOString(),
    },
  });
}

export async function notifyApplicationUpdate(
  userId: string,
  company: string,
  title: string,
  stage: string
) {
  return createNotification({
    userId,
    type: 'application_update',
    title: 'Application Update',
    message: `Your application to ${company} for ${title} has moved to "${stage}"`,
    data: { company, title, stage },
  });
}

export async function notifyAISuggestion(userId: string, suggestionType: string, message: string) {
  return createNotification({
    userId,
    type: 'ai_suggestion',
    title: 'AI Suggestion',
    message,
    data: { suggestionType },
  });
}
