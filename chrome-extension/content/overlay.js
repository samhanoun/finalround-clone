/**
 * FinalRound Copilot - Content Overlay
 * UI component that renders the copilot overlay on the page
 */
import { EventEmitter } from './events';
class ContentOverlay extends EventEmitter {
    constructor(settings) {
        super();
        this.container = null;
        this.isVisible = false;
        this.isMuted = false;
        this.suggestions = [];
        this.settings = settings;
    }
    /**
     * Render the overlay
     */
    render() {
        // Remove existing container if any
        if (this.container) {
            this.container.remove();
        }
        // Create container
        this.container = document.createElement('div');
        this.container.id = 'finalround-copilot-overlay';
        this.container.className = `fr-overlay fr-theme-${this.settings.theme}`;
        this.container.style.cssText = this.getContainerStyles();
        // Add to page
        document.body.appendChild(this.container);
        // Render internal content
        this.renderContent();
    }
    /**
     * Get container styles
     */
    getContainerStyles() {
        return `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 380px;
      max-height: 500px;
      background: ${this.settings.theme === 'dark' ? '#1a1a2e' : '#ffffff'};
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      opacity: ${this.settings.opacity};
      transition: opacity 0.2s ease, transform 0.2s ease;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    `;
    }
    /**
     * Render overlay content
     */
    renderContent() {
        if (!this.container)
            return;
        this.container.innerHTML = `
      <div class="fr-header">
        <div class="fr-header-content">
          <div class="fr-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>FinalRound Copilot</span>
          </div>
          <div class="fr-header-controls">
            <button class="fr-btn fr-btn-mute" title="Toggle Sound">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                <path class="fr-sound-wave" d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            </button>
            <button class="fr-btn fr-btn-minimize" title="Minimize">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12h14"/>
              </svg>
            </button>
            <button class="fr-btn fr-btn-close" title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      <div class="fr-body">
        <div class="fr-welcome">
          <p>Ready to help with your interview!</p>
          <p class="fr-hint">Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> to toggle</p>
        </div>
        
        <div class="fr-suggestions-list"></div>
        
        <div class="fr-quick-actions">
          <button class="fr-action-btn" data-action="star">
            <span class="fr-action-icon">📋</span>
            <span>STAR Method</span>
          </button>
          <button class="fr-action-btn" data-action="clarify">
            <span class="fr-action-icon">❓</span>
            <span>Clarify</span>
          </button>
          <button class="fr-action-btn" data-action="followup">
            <span class="fr-action-icon">🔄</span>
            <span>Follow-up</span>
          </button>
        </div>
      </div>
      
      <div class="fr-footer">
        <span class="fr-status">
          <span class="fr-status-dot"></span>
          <span>Ready</span>
        </span>
      </div>
    `;
        // Add event listeners
        this.attachEventListeners();
        // Add styles
        this.addStyles();
    }
    /**
     * Add CSS styles
     */
    addStyles() {
        if (document.getElementById('fr-styles'))
            return;
        const styles = document.createElement('style');
        styles.id = 'fr-styles';
        styles.textContent = `
      .fr-overlay {
        color: #e0e0e0;
      }
      
      .fr-overlay.fr-theme-light {
        color: #333;
      }
      
      .fr-header {
        padding: 12px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .fr-header-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .fr-logo {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
        color: white;
      }
      
      .fr-header-controls {
        display: flex;
        gap: 4px;
      }
      
      .fr-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        transition: background 0.2s;
      }
      
      .fr-btn:hover {
        background: rgba(255, 255, 255, 0.25);
      }
      
      .fr-btn.fr-btn-mute.muted .fr-sound-wave {
        display: none;
      }
      
      .fr-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }
      
      .fr-welcome {
        text-align: center;
        padding: 20px;
        color: #888;
        font-size: 13px;
      }
      
      .fr-welcome p:first-child {
        font-size: 15px;
        color: #aaa;
        margin-bottom: 8px;
      }
      
      .fr-hint kbd {
        background: #333;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        font-family: monospace;
      }
      
      .fr-suggestions-list {
        margin-bottom: 16px;
        max-height: 200px;
        overflow-y: auto;
      }
      
      .fr-suggestion {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        cursor: pointer;
        transition: background 0.2s;
        border: 1px solid transparent;
      }
      
      .fr-suggestion:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(102, 126, 234, 0.5);
      }
      
      .fr-suggestion-type {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #888;
        margin-bottom: 4px;
      }
      
      .fr-suggestion-content {
        font-size: 13px;
        line-height: 1.5;
      }
      
      .fr-quick-actions {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      
      .fr-action-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 12px 8px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        cursor: pointer;
        color: #aaa;
        font-size: 11px;
        transition: all 0.2s;
      }
      
      .fr-action-btn:hover {
        background: rgba(102, 126, 234, 0.2);
        border-color: #667eea;
        color: white;
      }
      
      .fr-action-icon {
        font-size: 18px;
      }
      
      .fr-footer {
        padding: 8px 16px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        font-size: 11px;
        color: #666;
      }
      
      .fr-status {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      .fr-status-dot {
        width: 8px;
        height: 8px;
        background: #4ade80;
        border-radius: 50%;
        animation: fr-pulse 2s infinite;
      }
      
      @keyframes fr-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      
      .fr-hidden {
        display: none !important;
      }
      
      .fr-minimized .fr-body,
      .fr-minimized .fr-footer {
        display: none;
      }
    `;
        document.head.appendChild(styles);
    }
    /**
     * Attach event listeners
     */
    attachEventListeners() {
        if (!this.container)
            return;
        // Close button
        this.container.querySelector('.fr-btn-close')?.addEventListener('click', () => {
            this.hide();
            this.emit('toggle', false);
        });
        // Minimize button
        this.container.querySelector('.fr-btn-minimize')?.addEventListener('click', () => {
            this.container?.classList.toggle('fr-minimized');
        });
        // Mute button
        this.container.querySelector('.fr-btn-mute')?.addEventListener('click', () => {
            this.toggleMuteState();
        });
        // Quick action buttons
        this.container.querySelectorAll('.fr-action-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.getAttribute('data-action');
                this.handleQuickAction(action);
            });
        });
    }
    /**
     * Handle quick action buttons
     */
    handleQuickAction(action) {
        const templates = {
            star: {
                type: 'star',
                content: 'Situation: \nTask: \nAction: \nResult: '
            },
            clarify: {
                type: 'clarify',
                content: 'Could you please clarify what you mean by...?'
            },
            followup: {
                type: 'follow-up',
                content: 'Building on that point, I\'d also like to mention...'
            }
        };
        if (action && templates[action]) {
            this.addSuggestion(templates[action]);
            this.emit('suggestion_click', templates[action]);
        }
    }
    /**
     * Add a suggestion to the list
     */
    addSuggestion(suggestion) {
        this.suggestions.unshift(suggestion);
        // Keep max 10 suggestions
        if (this.suggestions.length > 10) {
            this.suggestions.pop();
        }
        this.renderSuggestions();
    }
    /**
     * Render suggestions list
     */
    renderSuggestions() {
        const list = this.container?.querySelector('.fr-suggestions-list');
        if (!list)
            return;
        list.innerHTML = this.suggestions.map((s, i) => `
      <div class="fr-suggestion" data-index="${i}">
        <div class="fr-suggestion-type">${s.type}</div>
        <div class="fr-suggestion-content">${this.escapeHtml(s.content)}</div>
      </div>
    `).join('');
        // Add click listeners
        list.querySelectorAll('.fr-suggestion').forEach(el => {
            el.addEventListener('click', () => {
                const index = parseInt(el.getAttribute('data-index') || '0');
                const suggestion = this.suggestions[index];
                if (suggestion) {
                    this.emit('suggestion_click', suggestion);
                }
            });
        });
    }
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    /**
     * Toggle mute state
     */
    toggleMuteState() {
        this.isMuted = !this.isMuted;
        const muteBtn = this.container?.querySelector('.fr-btn-mute');
        if (muteBtn) {
            muteBtn.classList.toggle('muted', this.isMuted);
        }
    }
    /**
     * Show filler notification
     */
    showFillerNotification(text) {
        this.addSuggestion({
            type: 'filler',
            content: text
        });
    }
    /**
     * Show the overlay
     */
    show() {
        this.isVisible = true;
        this.container?.classList.remove('fr-hidden');
        this.container?.style.removeProperty('display');
    }
    /**
     * Hide the overlay
     */
    hide() {
        this.isVisible = false;
        this.container?.classList.add('fr-hidden');
    }
    /**
     * Check if overlay is visible
     */
    isVisibleState() {
        return this.isVisible;
    }
    /**
     * Update settings
     */
    updateSettings(settings) {
        this.settings = settings;
        if (this.container) {
            this.container.className = `fr-overlay fr-theme-${settings.theme}`;
            this.container.style.opacity = String(settings.opacity);
        }
    }
    /**
     * Reposition overlay (for dynamic content)
     */
    reposition() {
        // Currently fixed to bottom-right, but could be made draggable
    }
}
export { ContentOverlay };
