/**
 * FinalRound Copilot - Storage Manager
 * Handles persistent storage for settings, session state, and events
 */

export interface ExtensionSettings {
  isEnabled: boolean;
  copilotMode: 'minimal' | 'standard' | 'detailed';
  hotkeys: {
    toggle: string;
    mute: string;
    filler: string;
  };
  autoInject: boolean;
  showConfidencePrompts: boolean;
  enableSTAR: boolean;
  theme: 'light' | 'dark' | 'auto';
  opacity: number;
}

export interface SessionState {
  sessionId: string | null;
  isActive: boolean;
  startTime: number | null;
  mode: 'minimal' | 'standard' | 'detailed';
  transcript: TranscriptEntry[];
  suggestions: SuggestionEntry[];
}

export interface TranscriptEntry {
  id: string;
  speaker: 'user' | 'interviewer' | 'system';
  content: string;
  timestamp: number;
  confidence?: number;
}

export interface SuggestionEntry {
  id: string;
  type: 'answer' | 'clarify' | 'star' | 'follow-up' | 'filler';
  content: string;
  timestamp: number;
  accepted: boolean;
}

export interface StoredEvent {
  event: string;
  sessionId?: string;
  timestamp: number;
  [key: string]: unknown;
}

const STORAGE_KEYS = {
  SETTINGS: 'finalround_settings',
  SESSION_STATE: 'finalround_session_state',
  EVENTS: 'finalround_events'
} as const;

const DEFAULT_SETTINGS: ExtensionSettings = {
  isEnabled: true,
  copilotMode: 'standard',
  hotkeys: {
    toggle: 'CommandOrControl+Shift+F',
    mute: 'CommandOrControl+Shift+M',
    filler: 'CommandOrControl+Shift+Space'
  },
  autoInject: true,
  showConfidencePrompts: true,
  enableSTAR: true,
  theme: 'dark',
  opacity: 0.95
};

const DEFAULT_SESSION_STATE: SessionState = {
  sessionId: null,
  isActive: false,
  startTime: null,
  mode: 'standard',
  transcript: [],
  suggestions: []
};

export class StorageManager {
  private cache: Map<string, unknown> = new Map();
  
  /**
   * Initialize storage with default values if not already set
   */
  async initializeDefaults(defaults: Partial<ExtensionSettings>): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      
      if (!stored[STORAGE_KEYS.SETTINGS]) {
        const mergedDefaults = { ...DEFAULT_SETTINGS, ...defaults };
        await chrome.storage.local.set({
          [STORAGE_KEYS.SETTINGS]: mergedDefaults
        });
        this.cache.set(STORAGE_KEYS.SETTINGS, mergedDefaults);
        console.log('[Storage] Initialized with defaults');
      } else {
        this.cache.set(STORAGE_KEYS.SETTINGS, stored[STORAGE_KEYS.SETTINGS]);
      }
      
      // Initialize session state if not exists
      const sessionStored = await chrome.storage.local.get(STORAGE_KEYS.SESSION_STATE);
      if (!sessionStored[STORAGE_KEYS.SESSION_STATE]) {
        await chrome.storage.local.set({
          [STORAGE_KEYS.SESSION_STATE]: DEFAULT_SESSION_STATE
        });
        this.cache.set(STORAGE_KEYS.SESSION_STATE, DEFAULT_SESSION_STATE);
      }
    } catch (error) {
      console.error('[Storage] Failed to initialize:', error);
    }
  }
  
  /**
   * Get all extension settings
   */
  async getSettings(): Promise<ExtensionSettings> {
    if (this.cache.has(STORAGE_KEYS.SETTINGS)) {
      return this.cache.get(STORAGE_KEYS.SETTINGS) as ExtensionSettings;
    }
    
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      const settings = (stored[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS) as ExtensionSettings;
      this.cache.set(STORAGE_KEYS.SETTINGS, settings);
      return settings;
    } catch (error) {
      console.error('[Storage] Failed to get settings:', error);
      return DEFAULT_SETTINGS;
    }
  }
  
  /**
   * Update extension settings
   */
  async updateSettings(updates: Partial<ExtensionSettings>): Promise<void> {
    try {
      const current = await this.getSettings();
      const updated = { ...current, ...updates };
      
      await chrome.storage.local.set({
        [STORAGE_KEYS.SETTINGS]: updated
      });
      
      this.cache.set(STORAGE_KEYS.SETTINGS, updated);
      console.log('[Storage] Settings updated:', updates);
    } catch (error) {
      console.error('[Storage] Failed to update settings:', error);
      throw error;
    }
  }
  
  /**
   * Get current session state
   */
  async getSessionState(): Promise<SessionState> {
    if (this.cache.has(STORAGE_KEYS.SESSION_STATE)) {
      return this.cache.get(STORAGE_KEYS.SESSION_STATE) as SessionState;
    }
    
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.SESSION_STATE);
      const state = (stored[STORAGE_KEYS.SESSION_STATE] || DEFAULT_SESSION_STATE) as SessionState;
      this.cache.set(STORAGE_KEYS.SESSION_STATE, state);
      return state;
    } catch (error) {
      console.error('[Storage] Failed to get session state:', error);
      return DEFAULT_SESSION_STATE;
    }
  }
  
  /**
   * Update session state
   */
  async setSessionState(state: Partial<SessionState>): Promise<void> {
    try {
      const current = await this.getSessionState();
      const updated = { ...current, ...state };
      
      await chrome.storage.local.set({
        [STORAGE_KEYS.SESSION_STATE]: updated
      });
      
      this.cache.set(STORAGE_KEYS.SESSION_STATE, updated);
    } catch (error) {
      console.error('[Storage] Failed to set session state:', error);
      throw error;
    }
  }
  
  /**
   * Add transcript entry
   */
  async addTranscriptEntry(entry: Omit<TranscriptEntry, 'id' | 'timestamp'>): Promise<void> {
    const state = await this.getSessionState();
    
    const newEntry: TranscriptEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now()
    };
    
    state.transcript.push(newEntry);
    
    // Keep only last 500 entries
    if (state.transcript.length > 500) {
      state.transcript.splice(0, state.transcript.length - 500);
    }
    
    await this.setSessionState({ transcript: state.transcript });
  }
  
  /**
   * Add suggestion entry
   */
  async addSuggestionEntry(entry: Omit<SuggestionEntry, 'id' | 'timestamp'>): Promise<void> {
    const state = await this.getSessionState();
    
    const newEntry: SuggestionEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now()
    };
    
    state.suggestions.push(newEntry);
    
    // Keep only last 100 entries
    if (state.suggestions.length > 100) {
      state.suggestions.splice(0, state.suggestions.length - 100);
    }
    
    await this.setSessionState({ suggestions: state.suggestions });
  }
  
  /**
   * Mark suggestion as accepted
   */
  async acceptSuggestion(suggestionId: string): Promise<void> {
    const state = await this.getSessionState();
    
    const suggestion = state.suggestions.find(s => s.id === suggestionId);
    if (suggestion) {
      suggestion.accepted = true;
      await this.setSessionState({ suggestions: state.suggestions });
    }
  }
  
  /**
   * Get analytics events
   */
  async getEvents(): Promise<StoredEvent[]> {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.EVENTS);
      return (stored[STORAGE_KEYS.EVENTS] || []) as StoredEvent[];
    } catch (error) {
      console.error('[Storage] Failed to get events:', error);
      return [];
    }
  }
  
  /**
   * Set analytics events
   */
  async setEvents(events: StoredEvent[]): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.EVENTS]: events
      });
    } catch (error) {
      console.error('[Storage] Failed to set events:', error);
    }
  }
  
  /**
   * Clear all stored data
   */
  async clearAll(): Promise<void> {
    try {
      await chrome.storage.local.clear();
      this.cache.clear();
      console.log('[Storage] All data cleared');
    } catch (error) {
      console.error('[Storage] Failed to clear data:', error);
      throw error;
    }
  }
  
  /**
   * Export data for user (for GDPR/CCPA)
   */
  async exportData(): Promise<{ settings: ExtensionSettings; session: SessionState; events: StoredEvent[] }> {
    const [settings, session, events] = await Promise.all([
      this.getSettings(),
      this.getSessionState(),
      this.getEvents()
    ]);
    
    return { settings, session, events };
  }
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Session configuration type
export interface SessionConfig {
  mode?: 'minimal' | 'standard' | 'detailed';
  role?: string;
  company?: string;
}

// Analytics event type
export interface AnalyticsEvent {
  event: string;
  sessionId?: string;
  timestamp: number;
  [key: string]: unknown;
}

// Export singleton instance
export const storageManager = new StorageManager();
