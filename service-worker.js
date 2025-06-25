// Google Meet Audio Indicator Service Worker with Debug Logging
let activeTabId = null;
let isMonitoring = false;
let offscreenDocumentCreated = false;

// Track audio states for different tabs
const tabAudioStates = new Map();

console.log('[Service Worker] Google Meet Audio Indicator loaded');

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
  console.log('[Service Worker] Tab activated:', activeTabId);
  await updateIconForCurrentTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url?.includes('meet.google.com')) {
    console.log('[Service Worker] Meet tab updated:', tabId, tab.url);
    // Reset monitoring when navigating to a new Meet
    if (tabAudioStates.has(tabId)) {
      tabAudioStates.delete(tabId);
    }
    await updateIconForTab(tabId);
  }
  
  if (tabId === activeTabId) {
    await updateIconForCurrentTab();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('[Service Worker] Tab removed:', tabId);
  tabAudioStates.delete(tabId);
  if (tabId === activeTabId) {
    activeTabId = null;
  }
});

// Listen for messages from content script and offscreen document
chrome.runtime.onMessage.addListener(async (message, sender) => {
  console.log('[Service Worker] Message received:', message.type, message);
  
  switch (message.type) {
    case 'meet-detected':
      if (sender.tab) {
        console.log('[Service Worker] Meet detected on tab:', sender.tab.id);
        await startMonitoringTab(sender.tab.id);
      }
      break;
      
    case 'audio-state-changed':
      if (sender.tab) {
        console.log('[Service Worker] Audio state changed for tab:', sender.tab.id, {
          hasAudio: message.hasAudio,
          isSpeaking: message.isSpeaking
        });
        
        tabAudioStates.set(sender.tab.id, {
          hasAudio: message.hasAudio,
          isSpeaking: message.isSpeaking,
          timestamp: Date.now()
        });
        await updateIconForTab(sender.tab.id);
        
        // Send update to popup if it's open
        try {
          chrome.runtime.sendMessage({
            type: 'popup-update-status',
            hasAudio: message.hasAudio,
            isSpeaking: message.isSpeaking
          });
        } catch (e) {
          // Popup might not be open, ignore error
        }
      }
      break;
      
    case 'offscreen-audio-detected':
      if (message.tabId) {
        console.log('[Service Worker] Offscreen audio detected for tab:', message.tabId, {
          hasAudio: message.hasAudio,
          audioLevel: message.audioLevel
        });
        
        const currentState = tabAudioStates.get(message.tabId) || {};
        tabAudioStates.set(message.tabId, {
          ...currentState,
          hasTabAudio: message.hasAudio,
          audioLevel: message.audioLevel,
          timestamp: Date.now()
        });
        await updateIconForTab(message.tabId);
      }
      break;
      
    case 'get-tab-audio-state':
      // Return current state for popup
      const state = tabAudioStates.get(message.tabId);
      console.log('[Service Worker] Returning tab audio state:', message.tabId, state);
      return Promise.resolve({ state });
  }
});

async function startMonitoringTab(tabId) {
  try {
    console.log('[Service Worker] Starting monitoring for tab:', tabId);
    
    // Create offscreen document if needed
    if (!offscreenDocumentCreated) {
      const existingContexts = await chrome.runtime.getContexts({});
      const offscreenDocument = existingContexts.find(
        (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
      );

      if (!offscreenDocument) {
        console.log('[Service Worker] Creating offscreen document');
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['USER_MEDIA'],
          justification: 'Monitoring audio activity in Google Meet tabs'
        });
        offscreenDocumentCreated = true;
      } else {
        console.log('[Service Worker] Offscreen document already exists');
      }
    }

    // Get media stream for the tab
    console.log('[Service Worker] Getting media stream for tab:', tabId);
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    console.log('[Service Worker] Got stream ID:', streamId);

    // Send stream to offscreen document for audio monitoring
    chrome.runtime.sendMessage({
      type: 'start-audio-monitoring',
      target: 'offscreen',
      data: { streamId, tabId }
    });

  } catch (error) {
    console.error('[Service Worker] Failed to start monitoring:', error);
  }
}

async function updateIconForCurrentTab() {
  if (activeTabId) {
    await updateIconForTab(activeTabId);
  }
}

async function updateIconForTab(tabId) {
  const state = tabAudioStates.get(tabId);
  let iconPath = 'icons/inactive.png';
  let badgeText = '';
  let badgeColor = '#666666';

  console.log('[Service Worker] Updating icon for tab:', tabId, 'state:', state);

  if (state) {
    if (state.isSpeaking) {
      // User is speaking (microphone active)
      iconPath = 'icons/speaking.png';
      badgeText = 'MIC';
      badgeColor = '#4CAF50'; // Green
      console.log('[Service Worker] Setting speaking icon');
    } else if (state.hasTabAudio || state.hasAudio) {
      // Tab has audio (others speaking)
      iconPath = 'icons/listening.png';
      badgeText = '♪';
      badgeColor = '#2196F3'; // Blue
      console.log('[Service Worker] Setting listening icon');
    } else {
      console.log('[Service Worker] Setting inactive icon');
    }
  } else {
    console.log('[Service Worker] No state found, using inactive icon');
  }

  try {
    // Update icon and badge
    await chrome.action.setIcon({ 
      path: iconPath,
      tabId: tabId 
    });
    
    await chrome.action.setBadgeText({ 
      text: badgeText,
      tabId: tabId 
    });
    
    await chrome.action.setBadgeBackgroundColor({ 
      color: badgeColor,
      tabId: tabId 
    });
    
    console.log('[Service Worker] Icon updated successfully');
  } catch (error) {
    console.error('[Service Worker] Error updating icon:', error);
  }
}

// Clean up old states periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30000; // 30 seconds
  
  for (const [tabId, state] of tabAudioStates.entries()) {
    if (now - state.timestamp > maxAge) {
      console.log('[Service Worker] Cleaning up old state for tab:', tabId);
      tabAudioStates.delete(tabId);
    }
  }
}, 10000);

// Debug function to check current states
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'debug-get-states') {
    console.log('[Service Worker] Current tab audio states:', Object.fromEntries(tabAudioStates));
    sendResponse({ states: Object.fromEntries(tabAudioStates) });
  }
});