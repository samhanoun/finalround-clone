/**
 * FinalRound Copilot - Content Script
 * Injected into web pages to provide interview copilot overlay
 */
import { ContentOverlay } from './overlay';
class ContentScript {
    constructor() {
        this.overlay = null;
        this.settings = null;
        this.sessionState = null;
        this.isInitialized = false;
        this.init();
    }
    /**
     * Initialize the content script
     */
    async init() {
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
        }
        catch (error) {
            console.error('[FinalRound Copilot] Failed to initialize:', error);
        }
    }
    /**
     * Load settings from background script
     */
    async loadSettings() {
        try {
            const response = await this.sendMessage({ type: 'GET_SETTINGS' });
            if (response?.success) {
                this.settings = response.data;
            }
        }
        catch (error) {
            console.error('[FinalRound Copilot] Failed to load settings:', error);
        }
    }
    /**
     * Create the copilot overlay
     */
    createOverlay() {
        if (this.overlay)
            return;
        this.overlay = new ContentOverlay(this.settings || getDefaultSettings());
        this.overlay.render();
        // Listen for overlay events
        this.overlay.on('suggestion_click', (suggestion) => {
            this.handleSuggestionClick(suggestion);
        });
        this.overlay.on('toggle', (isVisible) => {
            this.sendMessage({ type: 'LOG_EVENT', data: { event: 'overlay_toggle', visible: isVisible } });
        });
    }
    /**
     * Setup message listener for background communication
     */
    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message) => {
            this.handleMessage(message);
            return false;
        });
    }
    /**
     * Handle messages from background and popup
     */
    handleMessage(message) {
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
                this.settings = message.data;
                this.overlay?.updateSettings(this.settings);
                break;
            case 'SESSION_STATE_UPDATED':
                this.sessionState = message.data;
                break;
            case 'SHOW_SUGGESTION':
                this.showSuggestion(message.data);
                break;
        }
    }
    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        if (!this.settings?.hotkeys)
            return;
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
    setupMutationObserver() {
        const observer = new MutationObserver((_mutations) => {
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
    toggleOverlay() {
        if (!this.overlay)
            return;
        if (this.overlay.isVisibleState()) {
            this.overlay.hide();
        }
        else {
            this.overlay.show();
        }
    }
    /**
     * Handle mute toggle
     */
    handleMuteToggle() {
        this.overlay?.toggleMuteState();
        this.sendMessage({ type: 'LOG_EVENT', data: { event: 'mute_toggle' } });
    }
    /**
     * Insert filler phrase
     */
    insertFiller() {
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
            const input = activeElement;
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
    handleSuggestionClick(suggestion) {
        // Try to insert into active input
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            const input = activeElement;
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
    showSuggestion(data) {
        this.overlay?.addSuggestion(data);
    }
    /**
     * Send message to background
     */
    async sendMessage(message) {
        try {
            const response = await chrome.runtime.sendMessage(message);
            return response;
        }
        catch (error) {
            console.error('[FinalRound Copilot] Failed to send message:', error);
            return null;
        }
    }
}
// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new ContentScript());
}
else {
    new ContentScript();
}
function getDefaultSettings() {
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
export { ContentScript };
