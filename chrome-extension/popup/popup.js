/**
 * FinalRound Copilot - Popup Script
 * Handles popup UI interactions
 */

document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    sessionBtn: document.getElementById('sessionBtn'),
    enableToggle: document.getElementById('enableToggle'),
    starToggle: document.getElementById('starToggle'),
    confidenceToggle: document.getElementById('confidenceToggle'),
    modeBtns: document.querySelectorAll('.mode-btn'),
    openDashboard: document.getElementById('openDashboard')
  };
  
  // Load current state
  async function loadState() {
    try {
      // Get settings
      const settingsResponse = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsResponse?.success) {
        const settings = settingsResponse.data;
        elements.enableToggle.checked = settings.isEnabled;
        elements.starToggle.checked = settings.enableSTAR;
        elements.confidenceToggle.checked = settings.showConfidencePrompts;
        
        // Update mode buttons
        elements.modeBtns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === settings.copilotMode);
        });
      }
      
      // Get session state
      const sessionResponse = await chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' });
      if (sessionResponse?.success) {
        const session = sessionResponse.data;
        updateSessionUI(session.isActive);
      }
    } catch (error) {
      console.error('[Popup] Failed to load state:', error);
    }
  }
  
  // Update session UI
  function updateSessionUI(isActive: boolean) {
    elements.statusDot?.classList.toggle('active', isActive);
    elements.statusText.textContent = isActive ? 'Active' : 'Inactive';
    
    if (elements.sessionBtn) {
      elements.sessionBtn.textContent = isActive ? 'End Session' : 'Start Session';
      elements.sessionBtn.classList.toggle('start', !isActive);
      elements.sessionBtn.classList.toggle('stop', isActive);
    }
  }
  
  // Toggle session
  async function toggleSession() {
    try {
      const sessionResponse = await chrome.runtime.sendMessage({ type: 'GET_SESSION_STATE' });
      const isActive = sessionResponse?.data?.isActive;
      
      if (isActive) {
        await chrome.runtime.sendMessage({ type: 'END_SESSION' });
        updateSessionUI(false);
      } else {
        const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        const mode = settings?.data?.copilotMode || 'standard';
        
        const startResponse = await chrome.runtime.sendMessage({
          type: 'START_SESSION',
          data: { mode }
        });
        
        if (startResponse?.success) {
          updateSessionUI(true);
        }
      }
    } catch (error) {
      console.error('[Popup] Failed to toggle session:', error);
    }
  }
  
  // Update settings
  async function updateSettings(updates: Record<string, unknown>) {
    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        data: updates
      });
    } catch (error) {
      console.error('[Popup] Failed to update settings:', error);
    }
  }
  
  // Event listeners
  elements.sessionBtn?.addEventListener('click', toggleSession);
  
  elements.enableToggle?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    updateSettings({ isEnabled: target.checked });
  });
  
  elements.starToggle?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    updateSettings({ enableSTAR: target.checked });
  });
  
  elements.confidenceToggle?.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    updateSettings({ showConfidencePrompts: target.checked });
  });
  
  elements.modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode) {
        elements.modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateSettings({ copilotMode: mode });
      }
    });
  });
  
  elements.openDashboard?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://finalround.example.com/dashboard' });
  });
  
  // Initialize
  loadState();
});
