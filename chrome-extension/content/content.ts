/**
 * FinalRound Copilot - Content Script
 * Injected into web pages to provide interview copilot overlay
 */

import { ContentOverlay } from './overlay';

class ContentScript {
  private overlay: ContentOverlay | null = null;
  private settings: ExtensionSettings | null = null;
  private sessionState: SessionState | null = null;
  private isInitialized = false;
  
  constructor() {
    this.init();
  }
  
  /**
   * Initialize the content script
   */
  private async init(): Promise<void> {
    console.log('[FinalRound Copilot] Initializing content script');
    
    try {
      // Load settings from background
      await this.loadSettings();
      
      // Check if enabled
      if (!this.settings?.isEnabled) {
        console.log('[FinalRound Copilot] Copilot disabled, skipping injection');
        return;
      }
      
      // Create overlay
      this.createOverlay();
      
      // Setup message listener
      this.setupMessageListener();
      
      // Setup keyboard shortcuts
      this.setupKeyboardShortcuts();
      
      // Setup mutation observer for dynamic content
      this.setupMutationObserver();
      
      this.isInitialized = true;
      console.log('[FinalRound Copilot] Content script ready');
    } catch (error) {
      console.error('[FinalRound Copilot] Failed to initialize:', error);
    }
  }
  
  /**
   * Load settings from background script
   */
  private async loadSettings(): Promise<void> {
    try {
      const response = await this.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.success) {
        this.settings = response.data as ExtensionSettings;
      }
    } catch (error) {
      console.error('[FinalRound Copilot] Failed to load settings:', error);
    }
  }
  
  /**
   * Create the copilot overlay
   */
  private createOverlay(): void {
    if (this.overlay) return;
    
    this.overlay = new ContentOverlay(this.settings || getDefaultSettings());
    this.overlay.render();
    
    // Listen for overlay events
    this.overlay.on('suggestion_click', (suggestion: unknown) => {
      this.handleSuggestionClick(suggestion as SuggestionData);
    });
    
    this.overlay.on('toggle', (isVisible: unknown) => {
      this.sendMessage({ type: 'LOG_EVENT', data: { event: 'overlay_toggle', visible: isVisible as boolean } });
    });
  }
  
  /**
   * Setup message listener for background communication
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener((message: unknown) => {
      this.handleMessage(message as Message);
      return false;
    });
  }
  
  /**
   * Handle messages from background and popup
   */
  private handleMessage(message: Message): void {
    switch (message.type) {
      case 'TOGGLE_OVERLAY':
        this.toggleOverlay();
        break;
      
      case 'MUTE_TOGGLE':
        this.handleMuteToggle();
        break;
      
      case 'INSERT_FILLER':
        this.insertFiller();
        break;
      
      case 'SETTINGS_UPDATED':
        this.settings = message.data as ExtensionSettings;
        this.overlay?.updateSettings(this.settings);
        break;
      
      case 'SESSION_STATE_UPDATED':
        this.sessionState = message.data as SessionState;
        break;
        
      case 'SHOW_SUGGESTION':
        this.showSuggestion(message.data as SuggestionData as SuggestionData);
        break;
    }
  }
  
  /**
   * Setup keyboard shortcuts
   */
  private setupKeyboardShortcuts(): void {
    if (!this.settings?.hotkeys) return;
    
    document.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      
      // Toggle overlay
      if (ctrl && shift && key === 'f') {
        e.preventDefault();
        this.toggleOverlay();
      }
      
      // Toggle mute
      if (ctrl && shift && key === 'm') {
        e.preventDefault();
        this.handleMuteToggle();
      }
      
      // Insert filler
      if (ctrl && shift && key === ' ') {
        e.preventDefault();
        this.insertFiller();
      }
    });
  }
  
  /**
   * Setup mutation observer for dynamic content
   */
  private setupMutationObserver(): void {
    const observer = new MutationObserver((mutations) => {
      // Check if we need to re-inject or adjust overlay
      if (this.overlay?.isVisibleState()) {
        this.overlay.reposition();
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  /**
   * Toggle overlay visibility
   */
  private toggleOverlay(): void {
    if (!this.overlay) return;
    
    if (this.overlay.isVisibleState()) {
      this.overlay.hide();
    } else {
      this.overlay.show();
    }
  }
  
  /**
   * Handle mute toggle
   */
  private handleMuteToggle(): void {
    this.overlay?.toggleMuteState();
    this.sendMessage({ type: 'LOG_EVENT', data: { event: 'mute_toggle' } });
  }
  
  /**
   * Insert filler phrase
   */
  private insertFiller(): void {
    const fillers = [
      "That's a great question. Let me think about that for a moment...",
      "That's an interesting point. In my experience...",
      "I'd be happy to share my thoughts on that.",
      "Let me break this down into parts."
    ];
    
    const filler = fillers[Math.floor(Math.random() * fillers.length)];
    
    // Try to insert into active input
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      const input = activeElement as HTMLInputElement | HTMLTextAreaElement;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const text = input.value;
      
      input.value = text.substring(0, start) + filler + text.substring(end);
      input.selectionStart = input.selectionEnd = start + filler.length;
      input.focus();
    }
    
    // Show in overlay
    this.overlay?.showFillerNotification(filler);
    this.sendMessage({ type: 'LOG_EVENT', data: { event: 'filler_insert', text: filler } });
  }
  
  /**
   * Handle suggestion click
   */
  private handleSuggestionClick(suggestion: SuggestionData): void {
    // Try to insert into active input
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      const input = activeElement as HTMLInputElement | HTMLTextAreaElement;
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const text = input.value;
      
      input.value = text.substring(0, start) + suggestion.content + text.substring(end);
      input.selectionStart = input.selectionEnd = start + suggestion.content.length;
      input.focus();
    }
    
    this.sendMessage({ 
      type: 'LOG_EVENT', 
      data: { 
        event: 'suggestion_used', 
        type: suggestion.type,
        content: suggestion.content 
      } 
    });
  }
  
  /**
   * Show suggestion in overlay
   */
  private showSuggestion(data: SuggestionData): void {
    this.overlay?.addSuggestion(data);
  }
  
  /**
   * Send message to background
   */
  private async sendMessage(message: Message): Promise<MessageResponse | null> {
    try {
      const response = await chrome.runtime.sendMessage(message);
      return response as MessageResponse | null;
    } catch (error) {
      console.error('[FinalRound Copilot] Failed to send message:', error);
      return null;
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ContentScript());
} else {
  new ContentScript();
}

// Type definitions
interface ExtensionSettings {
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

interface SessionState {
  sessionId: string | null;
  isActive: boolean;
  startTime: number | null;
  mode: 'minimal' | 'standard' | 'detailed';
  transcript: TranscriptEntry[];
  suggestions: SuggestionEntry[];
}

interface TranscriptEntry {
  id: string;
  speaker: 'user' | 'interviewer' | 'system';
  content: string;
  timestamp: number;
  confidence?: number;
}

interface SuggestionEntry {
  id: string;
  type: 'answer' | 'clarify' | 'star' | 'follow-up' | 'filler';
  content: string;
  timestamp: number;
  accepted: boolean;
}

interface SuggestionData {
  type: 'answer' | 'clarify' | 'star' | 'follow-up' | 'filler';
  content: string;
}

interface Message {
  type: string;
  data?: unknown;
}

interface MessageResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

function getDefaultSettings(): ExtensionSettings {
  return {
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
}

// Chrome types for content script
declare const chrome: {
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown>;
    onMessage: {
      addListener: (callback: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => void) => void;
    };
  };
};

export { ContentScript };
