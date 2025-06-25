// Google Meet Audio Indicator Service Worker with Transcription
let activeTabId = null;
let isMonitoring = false;
let offscreenDocumentCreated = false;

// Track audio states and transcriptions for different tabs
const tabAudioStates = new Map();
const tabTranscriptions = new Map();

console.log('[Service Worker] Google Meet Audio Indicator with Transcription loaded');

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
    if (tabTranscriptions.has(tabId)) {
      tabTranscriptions.delete(tabId);
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
  tabTranscriptions.delete(tabId);
  if (tabId === activeTabId) {
    activeTabId = null;
  }
});

// Listen for messages from content script and offscreen document
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
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
            tabId: sender.tab.id,
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
      
    case 'transcription-update':
      if (message.tabId) {
        console.log('[Service Worker] Transcription update for tab:', message.tabId);
        
        const currentTranscription = tabTranscriptions.get(message.tabId) || {
          recentTranscripts: [],
          currentInterim: ''
        };
        
        tabTranscriptions.set(message.tabId, {
          recentTranscripts: message.recentTranscripts || currentTranscription.recentTranscripts,
          currentInterim: message.interimTranscript || '',
          lastUpdate: Date.now()
        });
        
        // Send update to popup if it's open
        try {
          chrome.runtime.sendMessage({
            type: 'popup-transcription-update',
            tabId: message.tabId,
            finalTranscript: message.finalTranscript,
            interimTranscript: message.interimTranscript,
            recentTranscripts: message.recentTranscripts
          });
        } catch (e) {
          // Popup might not be open, ignore error
        }
      }
      break;
      
    case 'get-tab-audio-state':
      // Return current state for popup
      const state = tabAudioStates.get(message.tabId);
      const transcription = tabTranscriptions.get(message.tabId);
      console.log('[Service Worker] Returning tab audio state:', message.tabId, state);
      sendResponse({ 
        state,
        transcription
      });
      return true;
      
    case 'toggle-transcription':
      if (message.tabId) {
        console.log('[Service Worker] Toggling transcription for tab:', message.tabId, message.enabled);
        
        // Forward to offscreen document
        chrome.runtime.sendMessage({
          type: 'toggle-transcription',
          target: 'offscreen',
          data: {
            tabId: message.tabId,
            enabled: message.enabled
          }
        });
        
        // Store transcription state
        await chrome.storage.local.set({
          [`transcription_${message.tabId}`]: message.enabled
        });
      }
      break;
      
    case 'debug-get-states':
      console.log('[Service Worker] Current tab audio states:', Object.fromEntries(tabAudioStates));
      console.log('[Service Worker] Current transcriptions:', Object.fromEntries(tabTranscriptions));
      sendResponse({ 
        audioStates: Object.fromEntries(tabAudioStates),
        transcriptions: Object.fromEntries(tabTranscriptions)
      });
      return true;
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
          justification: 'Monitoring audio activity and transcription in Google Meet tabs'
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

    // Check if transcription was previously enabled for this tab
    const result = await chrome.storage.local.get([`transcription_${tabId}`]);
    const transcriptionEnabled = result[`transcription_${tabId}`] || false;
    
    if (transcriptionEnabled) {
      // Enable transcription
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'toggle-transcription',
          target: 'offscreen',
          data: {
            tabId: tabId,
            enabled: true
          }
        });
      }, 1000);
    }

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
      console.log('[Service Worker] Cleaning up old audio state for tab:', tabId);
      tabAudioStates.delete(tabId);
    }
  }
  
  for (const [tabId, transcription] of tabTranscriptions.entries()) {
    if (now - transcription.lastUpdate > maxAge) {
      console.log('[Service Worker] Cleaning up old transcription for tab:', tabId);
      tabTranscriptions.delete(tabId);
    }
  }
}, 10000);