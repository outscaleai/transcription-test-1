// Popup script for Google Meet Audio Indicator with Transcription
let currentTabId = null;
let transcriptionEnabled = false;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Popup] Loading popup');
  
  const statusIcon = document.getElementById('currentStatus');
  const statusText = document.getElementById('statusText');
  const transcriptionToggle = document.getElementById('transcriptionToggle');
  const transcriptionContent = document.getElementById('transcriptionContent');
  const debugButton = document.getElementById('debugButton');
  const clearTranscriptButton = document.getElementById('clearTranscriptButton');
  
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    console.log('[Popup] Current tab:', tab);
    
    if (!tab) {
      updateStatus('inactive', 'No active tab found');
      return;
    }
    
    currentTabId = tab.id;
    
    // Check if current tab is a Google Meet
    if (!tab.url || !tab.url.includes('meet.google.com')) {
      updateStatus('inactive', 'Not on a Google Meet page');
      transcriptionToggle.disabled = true;
      console.log('[Popup] Not on Meet page:', tab.url);
      return;
    }
    
    console.log('[Popup] On Meet page, getting audio state');
    
    // Enable transcription toggle for Meet pages
    transcriptionToggle.disabled = false;
    transcriptionToggle.classList.remove('disabled');
    
    // Get current audio state and transcription from service worker
    const response = await chrome.runtime.sendMessage({
      type: 'get-tab-audio-state',
      tabId: tab.id
    });
    
    console.log('[Popup] Audio state response:', response);
    
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
    
    // Update transcription display
    if (response && response.transcription) {
      updateTranscriptionDisplay(response.transcription);
    }
    
    // Check transcription state
    const transcriptionState = await chrome.storage.local.get([`transcription_${tab.id}`]);
    transcriptionEnabled = transcriptionState[`transcription_${tab.id}`] || false;
    updateTranscriptionToggle();
    
  } catch (error) {
    console.error('[Popup] Error in popup:', error);
    updateStatus('inactive', 'Error checking audio status');
  }
  
  // Set up event listeners
  transcriptionToggle.addEventListener('click', toggleTranscription);
  debugButton.addEventListener('click', debugStates);
  clearTranscriptButton.addEventListener('click', clearTranscript);
});

function updateStatus(type, text) {
  console.log('[Popup] Updating status:', type, text);
  
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

function updateTranscriptionToggle() {
  const transcriptionToggle = document.getElementById('transcriptionToggle');
  const transcriptionContent = document.getElementById('transcriptionContent');
  
  if (transcriptionEnabled) {
    transcriptionToggle.textContent = 'Disable';
    transcriptionToggle.style.backgroundColor = '#d32f2f';
    if (transcriptionContent.classList.contains('empty')) {
      transcriptionContent.innerHTML = 'Transcription enabled. Listening for speech...';
      transcriptionContent.classList.remove('empty');
    }
  } else {
    transcriptionToggle.textContent = 'Enable';
    transcriptionToggle.style.backgroundColor = '#1a73e8';
    transcriptionContent.innerHTML = 'Transcription disabled. Click "Enable" to start real-time speech-to-text.';
    transcriptionContent.classList.add('empty');
  }
}

async function toggleTranscription() {
  if (!currentTabId) return;
  
  transcriptionEnabled = !transcriptionEnabled;
  
  console.log('[Popup] Toggling transcription:', transcriptionEnabled);
  
  // Send message to service worker
  chrome.runtime.sendMessage({
    type: 'toggle-transcription',
    tabId: currentTabId,
    enabled: transcriptionEnabled
  });
  
  updateTranscriptionToggle();
}

function updateTranscriptionDisplay(transcriptionData) {
  const transcriptionContent = document.getElementById('transcriptionContent');
  
  if (!transcriptionData || (!transcriptionData.recentTranscripts?.length && !transcriptionData.currentInterim)) {
    if (transcriptionEnabled) {
      transcriptionContent.innerHTML = 'Transcription enabled. Listening for speech...';
      transcriptionContent.classList.remove('empty');
    }
    return;
  }
  
  let html = '';
  
  // Display recent final transcripts
  if (transcriptionData.recentTranscripts && transcriptionData.recentTranscripts.length > 0) {
    transcriptionData.recentTranscripts.forEach(transcript => {
      const time = new Date(transcript.timestamp).toLocaleTimeString();
      html += `
        <div class="transcript-item">
          <div class="transcript-time">${time}</div>
          <div class="transcript-text">${transcript.text}</div>
        </div>
      `;
    });
  }
  
  // Display current interim transcript
  if (transcriptionData.currentInterim) {
    html += `
      <div class="interim-transcript">
        ${transcriptionData.currentInterim}
      </div>
    `;
  }
  
  if (html) {
    transcriptionContent.innerHTML = html;
    transcriptionContent.classList.remove('empty');
    // Scroll to bottom
    transcriptionContent.scrollTop = transcriptionContent.scrollHeight;
  } else if (transcriptionEnabled) {
    transcriptionContent.innerHTML = 'Transcription enabled. Listening for speech...';
    transcriptionContent.classList.remove('empty');
  }
}

function clearTranscript() {
  const transcriptionContent = document.getElementById('transcriptionContent');
  if (transcriptionEnabled) {
    transcriptionContent.innerHTML = 'Transcription enabled. Listening for speech...';
    transcriptionContent.classList.remove('empty');
  } else {
    transcriptionContent.innerHTML = 'Transcription disabled. Click "Enable" to start real-time speech-to-text.';
    transcriptionContent.classList.add('empty');
  }
}

async function debugStates() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'debug-get-states' });
    console.log('Current audio states:', response.audioStates);
    console.log('Current transcriptions:', response.transcriptions);
    alert('Check console for current states');
  } catch (error) {
    console.error('Error getting debug states:', error);
  }
}

// Listen for real-time updates
chrome.runtime.onMessage.addListener((message) => {
  console.log('[Popup] Message received:', message);
  
  if (message.type === 'popup-update-status') {
    if (message.tabId === currentTabId) {
      if (message.isSpeaking) {
        updateStatus('speaking', 'You are speaking (microphone active)');
      } else if (message.hasAudio) {
        updateStatus('listening', 'Audio detected in meeting');
      } else {
        updateStatus('inactive', 'No audio activity detected');
      }
    }
  } else if (message.type === 'popup-transcription-update') {
    if (message.tabId === currentTabId) {
      updateTranscriptionDisplay({
        recentTranscripts: message.recentTranscripts,
        currentInterim: message.interimTranscript
      });
    }
  }
});