import { google } from 'googleapis';
import { SupabaseClient } from '@supabase/supabase-js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

export async function getGoogleAuthUrl() {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force refresh token
  });
}

export async function handleGoogleCallback(code: string, userId: string, supabase: SupabaseClient) {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  const { tokens } = await oauth2Client.getToken(code);
  
  // Store tokens in user_integrations table
  const { error } = await supabase
    .from('user_integrations')
    .upsert({
      user_id: userId,
      provider: 'google',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      scopes: tokens.scope?.split(' '),
      metadata: { scope: tokens.scope },
    }, { onConflict: 'user_id, provider' });

  if (error) throw error;
  
  return tokens;
}

export async function getGoogleCalendarClient(userId: string, supabase: SupabaseClient) {
  const { data: integration, error } = await supabase
    .from('user_integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single();

  if (error || !integration) {
    throw new Error('Google integration not found');
  }

  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token,
    expiry_date: integration.expires_at ? new Date(integration.expires_at).getTime() : undefined,
  });

  // Handle token refresh
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      await supabase
        .from('user_integrations')
        .update({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        })
        .eq('user_id', userId)
        .eq('provider', 'google');
    } else if (tokens.access_token) {
       await supabase
        .from('user_integrations')
        .update({
          access_token: tokens.access_token,
           expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        })
        .eq('user_id', userId)
        .eq('provider', 'google');
    }
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export async function createCalendarEvent(
  userId: string,
  supabase: SupabaseClient,
  event: {
    summary: string;
    description: string;
    startTime: string; // ISO string
    endTime: string; // ISO string
    attendees?: string[];
  }
) {
  const calendar = await getGoogleCalendarClient(userId, supabase);
  
  const resource = {
    summary: event.summary,
    description: event.description,
    start: {
      dateTime: event.startTime,
      timeZone: 'UTC', // Ensure consistent timezone handling
    },
    end: {
      dateTime: event.endTime,
      timeZone: 'UTC',
    },
    attendees: event.attendees?.map(email => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: Math.random().toString(36).substring(7),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: resource,
    conferenceDataVersion: 1,
  });

  return response.data;
}

export async function listCalendarEvents(
  userId: string,
  supabase: SupabaseClient,
  timeMin: string,
  timeMax: string
) {
  const calendar = await getGoogleCalendarClient(userId, supabase);
  
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return response.data.items;
}
