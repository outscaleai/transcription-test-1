// Google Meet Audio Indicator Service Worker
let activeTabId = null;
let isMonitoring = false;
let offscreenDocumentCreated = false;

// Track audio states for different tabs
const tabAudioStates = new Map();

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  activeTabId = activeInfo.tabId;
  await updateIconForCurrentTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url?.includes('meet.google.com')) {
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
  tabAudioStates.delete(tabId);
  if (tabId === activeTabId) {
    activeTabId = null;
  }
});

// Listen for messages from content script and offscreen document
chrome.runtime.onMessage.addListener(async (message, sender) => {
  switch (message.type) {
    case 'meet-detected':
      if (sender.tab) {
        await startMonitoringTab(sender.tab.id);
      }
      break;
      
    case 'audio-state-changed':
      if (sender.tab) {
        tabAudioStates.set(sender.tab.id, {
          hasAudio: message.hasAudio,
          isSpeaking: message.isSpeaking,
          timestamp: Date.now()
        });
        await updateIconForTab(sender.tab.id);
      }
      break;
      
    case 'offscreen-audio-detected':
      if (message.tabId) {
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
  }
});

async function startMonitoringTab(tabId) {
  try {
    // Create offscreen document if needed
    if (!offscreenDocumentCreated) {
      const existingContexts = await chrome.runtime.getContexts({});
      const offscreenDocument = existingContexts.find(
        (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
      );

      if (!offscreenDocument) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['USER_MEDIA'],
          justification: 'Monitoring audio activity in Google Meet tabs'
        });
        offscreenDocumentCreated = true;
      }
    }

    // Get media stream for the tab
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    // Send stream to offscreen document for audio monitoring
    chrome.runtime.sendMessage({
      type: 'start-audio-monitoring',
      target: 'offscreen',
      data: { streamId, tabId }
    });

  } catch (error) {
    console.error('Failed to start monitoring:', error);
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

  if (state) {
    if (state.isSpeaking) {
      // User is speaking (microphone active)
      iconPath = 'icons/speaking.png';
      badgeText = 'MIC';
      badgeColor = '#4CAF50'; // Green
    } else if (state.hasTabAudio || state.hasAudio) {
      // Tab has audio (others speaking)
      iconPath = 'icons/listening.png';
      badgeText = 'AUDIO';
      badgeColor = '#2196F3'; // Blue
    }
  }

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
}

// Clean up old states periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30000; // 30 seconds
  
  for (const [tabId, state] of tabAudioStates.entries()) {
    if (now - state.timestamp > maxAge) {
      tabAudioStates.delete(tabId);
    }
  }
}, 10000);