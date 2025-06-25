// Google Meet Audio Indicator Content Script
let isMonitoring = false;
let audioContext = null;
let microphoneStream = null;
let analyser = null;
let dataArray = null;

// Initialize when page loads
if (window.location.hostname === 'meet.google.com') {
  initializeMeetMonitoring();
}

function initializeMeetMonitoring() {
  // Notify service worker that we're on a Meet page
  chrome.runtime.sendMessage({
    type: 'meet-detected'
  });

  // Monitor for microphone and speaker activity
  startAudioMonitoring();
  
  // Monitor DOM changes for Meet UI updates
  observeMeetUI();
}

function startAudioMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;

  // Monitor microphone button state
  const checkMicrophoneState = () => {
    // Look for Google Meet's microphone button
    const micButton = document.querySelector('[data-tooltip*="microphone" i], [aria-label*="microphone" i], [data-tooltip*="mic" i], [aria-label*="mic" i]');
    const isMuted = micButton?.getAttribute('aria-pressed') === 'false' || 
                   micButton?.classList.contains('muted') ||
                   micButton?.querySelector('[data-tooltip*="unmute" i], [aria-label*="unmute" i]');
    
    const isSpeaking = !isMuted && micButton !== null;
    
    // Check for audio indicators in the UI
    const hasAudio = checkForAudioIndicators();
    
    chrome.runtime.sendMessage({
      type: 'audio-state-changed',
      hasAudio: hasAudio,
      isSpeaking: isSpeaking
    });
  };

  // Check microphone state periodically
  setInterval(checkMicrophoneState, 500);
  
  // Initial check
  checkMicrophoneState();
}

function checkForAudioIndicators() {
  // Look for visual audio indicators in Google Meet
  const audioIndicators = [
    // Speaking indicators
    '[data-speaking="true"]',
    '.speaking',
    '[aria-label*="speaking" i]',
    // Audio wave indicators
    '.audio-wave',
    '.sound-indicator',
    // Participant audio indicators
    '[data-audio-state="speaking"]',
    '.participant-speaking'
  ];

  for (const selector of audioIndicators) {
    if (document.querySelector(selector)) {
      return true;
    }
  }

  // Check for audio elements
  const audioElements = document.querySelectorAll('audio, video');
  for (const element of audioElements) {
    if (!element.paused && !element.muted && element.volume > 0) {
      return true;
    }
  }

  return false;
}

function observeMeetUI() {
  const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;
    
    mutations.forEach((mutation) => {
      // Check if microphone or audio-related elements changed
      if (mutation.type === 'attributes') {
        const target = mutation.target;
        if (target.matches && (
          target.matches('[data-tooltip*="microphone" i]') ||
          target.matches('[aria-label*="microphone" i]') ||
          target.matches('[data-speaking]') ||
          target.matches('.speaking')
        )) {
          shouldCheck = true;
        }
      } else if (mutation.type === 'childList') {
        // Check if audio-related elements were added/removed
        const hasAudioElements = Array.from(mutation.addedNodes).some(node => 
          node.nodeType === Node.ELEMENT_NODE && (
            node.matches && (
              node.matches('audio') ||
              node.matches('video') ||
              node.matches('[data-speaking]') ||
              node.matches('.speaking')
            )
          )
        );
        if (hasAudioElements) {
          shouldCheck = true;
        }
      }
    });

    if (shouldCheck) {
      // Debounce the check
      clearTimeout(window.meetAudioCheckTimeout);
      window.meetAudioCheckTimeout = setTimeout(() => {
        const hasAudio = checkForAudioIndicators();
        const micButton = document.querySelector('[data-tooltip*="microphone" i], [aria-label*="microphone" i]');
        const isMuted = micButton?.getAttribute('aria-pressed') === 'false';
        const isSpeaking = !isMuted && micButton !== null;
        
        chrome.runtime.sendMessage({
          type: 'audio-state-changed',
          hasAudio: hasAudio,
          isSpeaking: isSpeaking
        });
      }, 100);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-pressed', 'data-speaking', 'class', 'aria-label', 'data-tooltip']
  });
}

// Listen for page navigation within Meet
let currentUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    if (window.location.hostname === 'meet.google.com') {
      // Reinitialize on navigation
      setTimeout(initializeMeetMonitoring, 1000);
    }
  }
}, 1000);