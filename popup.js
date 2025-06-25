// Popup script for Google Meet Audio Indicator
document.addEventListener('DOMContentLoaded', async () => {
  const statusIcon = document.getElementById('currentStatus');
  const statusText = document.getElementById('statusText');
  
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      updateStatus('inactive', 'No active tab found');
      return;
    }
    
    // Check if current tab is a Google Meet
    if (!tab.url || !tab.url.includes('meet.google.com')) {
      updateStatus('inactive', 'Not on a Google Meet page');
      return;
    }
    
    // Get current audio state from service worker
    const response = await chrome.runtime.sendMessage({
      type: 'get-tab-audio-state',
      tabId: tab.id
    });
    
    if (response && response.state) {
      const state = response.state;
      if (state.isSpeaking) {
        updateStatus('speaking', 'You are speaking (microphone active)');
      } else if (state.hasAudio || state.hasTabAudio) {
        updateStatus('listening', 'Audio detected in meeting');
      } else {
        updateStatus('inactive', 'No audio activity detected');
      }
    } else {
      updateStatus('inactive', 'Monitoring Google Meet audio...');
    }
    
  } catch (error) {
    console.error('Error in popup:', error);
    updateStatus('inactive', 'Error checking audio status');
  }
});

function updateStatus(type, text) {
  const statusIcon = document.getElementById('currentStatus');
  const statusText = document.getElementById('statusText');
  
  // Remove existing classes
  statusIcon.className = 'status-icon';
  
  // Add appropriate class and content
  switch (type) {
    case 'speaking':
      statusIcon.classList.add('speaking');
      statusIcon.textContent = 'MIC';
      break;
    case 'listening':
      statusIcon.classList.add('listening');
      statusIcon.textContent = '♪';
      break;
    default:
      statusIcon.classList.add('inactive');
      statusIcon.textContent = '○';
  }
  
  statusText.textContent = text;
}

// Listen for real-time updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'popup-update-status') {
    if (message.isSpeaking) {
      updateStatus('speaking', 'You are speaking (microphone active)');
    } else if (message.hasAudio) {
      updateStatus('listening', 'Audio detected in meeting');
    } else {
      updateStatus('inactive', 'No audio activity detected');
    }
  }
});