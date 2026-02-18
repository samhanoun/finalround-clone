/**
 * FinalRound Copilot - Background Service Worker
 * Handles extension lifecycle, message routing, and storage coordination
 */

import { StorageManager, ExtensionSettings, SessionState, SessionConfig, AnalyticsEvent } from './storage';

// Default extension state
const DEFAULT_STATE = {
  isEnabled: true,
  copilotMode: 'standard' as const,
  hotkeys: {
    toggle: 'CommandOrControl+Shift+F',
    mute: 'CommandOrControl+Shift+M',
    filler: 'CommandOrControl+Shift+Space'
  },
  sessionId: null
};

// Chrome API types
interface ChromeTabs {
  onUpdated: {
    addListener: (callback: (tabId: number, changeInfo: { status?: string }, tab: { id?: number; url?: string }) => void) => void;
  };
  query: (query: { active?: boolean; currentWindow?: boolean }) => Promise<Array<{ id?: number; url?: string }>>;
  sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
}

interface ChromeRuntime {
  onMessage: {
    addListener: (callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void) => void;
  };
  sendMessage: (message: unknown) => Promise<unknown>;
}

interface ChromeCommands {
  onCommand: {
    addListener: (callback: (command: string) => void) => void;
  };
}

interface ChromeScripting {
  executeScript: (options: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
}

interface ChromeStorage {
  local: {
    get: (keys: string | string[]) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
  };
}

interface Chrome {
  tabs: ChromeTabs;
  runtime: ChromeRuntime;
  commands: ChromeCommands;
  scripting: ChromeScripting;
  storage: ChromeStorage;
}

declare const chrome: Chrome;

// Message types
interface Message {
  type: string;
  data?: unknown;
}

interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Initialize extension
async function initialize(): Promise<void> {
  console.log('[FinalRound Copilot] Initializing background service worker');
  
  const storage = new StorageManager();
  await storage.initializeDefaults(DEFAULT_STATE);
  
  // Register content script on tab updates
  chrome.tabs.onUpdated.addListener(handleTabUpdate);
  
  // Handle messages from content scripts and popup
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    handleMessage(message as Message, sender, sendResponse);
    return true;
  });
  
  // Handle keyboard shortcuts
  chrome.commands.onCommand.addListener(handleCommand);
  
  console.log('[FinalRound Copilot] Background service worker ready');
}

// Handle tab updates - inject content script when needed
async function handleTabUpdate(
  tabId: number, 
  changeInfo: { status?: string }, 
  tab: { id?: number; url?: string }
): Promise<void> {
  if (changeInfo.status === 'complete' && tab.url) {
    // Check if we should inject on this URL
    const storage = new StorageManager();
    const settings = await storage.getSettings();
    
    if (settings.autoInject && isSupportedUrl(tab.url)) {
      try {
        if (tab.id) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/content.js']
          });
          console.log('[FinalRound Copilot] Content script injected into tab:', tabId);
        }
      } catch (error) {
        console.error('[FinalRound Copilot] Failed to inject content script:', error);
      }
    }
  }
}

// Check if URL is a supported interview platform
function isSupportedUrl(url: string): boolean {
  const supportedDomains = [
    'zoom.us',
    'meet.google.com',
    'webex.com',
    'teams.microsoft.com',
    'hirevue.com',
    'codility.com',
    'hackerrank.com',
    'leetcode.com',
    'exercism.io',
    'coderpad.io'
  ];
  
  try {
    const hostname = new URL(url).hostname;
    return supportedDomains.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

// Handle messages from content scripts and popup
async function handleMessage(
  message: Message,
  sender: unknown,
  sendResponse: (response?: MessageResponse) => void
): Promise<void> {
  const senderTab = sender as { tab?: { id?: number } };
  const storage = new StorageManager();
  
  switch (message.type) {
    case 'GET_SETTINGS':
      const settings = await storage.getSettings();
      sendResponse({ success: true, data: settings });
      break;
    
    case 'UPDATE_SETTINGS':
      await storage.updateSettings(message.data as Partial<ExtensionSettings>);
      sendResponse({ success: true });
      break;
    
    case 'START_SESSION':
      const sessionId = await startSession(message.data as SessionConfig);
      sendResponse({ success: true, data: { sessionId } });
      break;
    
    case 'END_SESSION':
      await endSession();
      sendResponse({ success: true });
      break;
    
    case 'GET_SESSION_STATE':
      const state = await storage.getSessionState();
      sendResponse({ success: true, data: state });
      break;
    
    case 'TOGGLE_COPILOT':
      await toggleCopilot(senderTab.tab?.id);
      sendResponse({ success: true });
      break;
    
    case 'LOG_EVENT':
      await logEvent(message.data as AnalyticsEvent);
      sendResponse({ success: true });
      break;
    
    default:
      console.warn('[FinalRound Copilot] Unknown message type:', message.type);
      sendResponse({ success: false, error: 'Unknown message type' });
  }
}

// Handle keyboard commands
async function handleCommand(command: string): Promise<void> {
  switch (command) {
    case 'toggle-copilot':
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        await toggleCopilot(tab.id);
      }
      break;
    
    case 'toggle-mute':
      await broadcastToContent('MUTE_TOGGLE');
      break;
    
    case 'insert-filler':
      await broadcastToContent('INSERT_FILLER');
      break;
  }
}

// Toggle copilot overlay visibility
async function toggleCopilot(tabId?: number): Promise<void> {
  if (!tabId) return;
  
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_OVERLAY' });
  } catch (error) {
    console.error('[FinalRound Copilot] Failed to toggle copilot:', error);
  }
}

// Broadcast message to content script
async function broadcastToContent(type: string, data?: unknown): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.sendMessage(tab.id, { type, data });
    }
  } catch (error) {
    console.error('[FinalRound Copilot] Failed to broadcast:', error);
  }
}

// Start a new copilot session
async function startSession(config: SessionConfig): Promise<string> {
  const storage = new StorageManager();
  const sessionId = generateSessionId();
  
  await storage.setSessionState({
    sessionId,
    isActive: true,
    startTime: Date.now(),
    mode: config.mode || 'standard',
    transcript: [],
    suggestions: []
  });
  
  await logEvent({
    event: 'session_start',
    sessionId,
    mode: config.mode,
    timestamp: Date.now()
  });
  
  return sessionId;
}

// End current session
async function endSession(): Promise<void> {
  const storage = new StorageManager();
  const state = await storage.getSessionState();
  
  if (state.sessionId) {
    await logEvent({
      event: 'session_end',
      sessionId: state.sessionId,
      duration: Date.now() - (state.startTime || 0),
      timestamp: Date.now()
    });
  }
  
  await storage.setSessionState({
    sessionId: null,
    isActive: false,
    startTime: null,
    mode: 'standard',
    transcript: [],
    suggestions: []
  });
}

// Log analytics event
async function logEvent(event: AnalyticsEvent): Promise<void> {
  const storage = new StorageManager();
  const events = await storage.getEvents();
  
  events.push({
    ...event,
    timestamp: event.timestamp || Date.now()
  });
  
  // Keep only last 1000 events in memory
  if (events.length > 1000) {
    events.splice(0, events.length - 1000);
  }
  
  await storage.setEvents(events);
}

// Generate unique session ID
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Initialize when service worker starts
initialize();
