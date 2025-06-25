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
    // Look for Google Meet's microphone button with multiple selectors
    const micButton = document.querySelector([
      '[data-tooltip*="microphone" i]',
      '[aria-label*="microphone" i]',
      '[data-tooltip*="mic" i]',
      '[aria-label*="mic" i]',
      '[data-is-muted]',
      'button[jsname*="BOHaEe"]', // Google Meet specific
      'div[data-tooltip*="Turn on microphone"]',
      'div[data-tooltip*="Turn off microphone"]'
    ].join(', '));
    
    // Check if microphone is muted based on various indicators
    const isMuted = micButton && (
      micButton.getAttribute('aria-pressed') === 'false' ||
      micButton.getAttribute('data-is-muted') === 'true' ||
      micButton.classList.contains('muted') ||
      micButton.querySelector('[data-tooltip*="Turn on microphone" i]') ||
      micButton.querySelector('svg path[d*="M19"]') // Muted mic icon path
    );
    
    const isSpeaking = !isMuted && micButton !== null;
    
    // Check for audio indicators in the UI
    const hasAudio = checkForAudioIndicators();
    
    chrome.runtime.sendMessage({
      type: 'audio-state-changed',
      hasAudio: hasAudio,
      isSpeaking: isSpeaking
    });
  };

  // Check microphone state more frequently for better responsiveness
  setInterval(checkMicrophoneState, 250);
  
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
    '.participant-speaking',
    // Google Meet specific selectors
    '[data-self-name][data-initial-volume]',
    'div[data-participant-id][data-volume-level]',
    // Look for animated audio bars
    '.audio-red5-inbound-rtp-audio-jitter',
    '[jsname*="audio"]'
  ];

  for (const selector of audioIndicators) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      // Check if any of these elements indicate active audio
      for (const element of elements) {
        if (element.style.display !== 'none' && 
            element.style.visibility !== 'hidden' &&
            !element.classList.contains('hidden')) {
          return true;
        }
      }
    }
  }

  // Check for audio elements that are playing
  const audioElements = document.querySelectorAll('audio, video');
  for (const element of audioElements) {
    if (!element.paused && !element.muted && element.volume > 0) {
      // Additional check to see if it's actually producing audio
      if (element.currentTime > 0 && element.readyState > 2) {
        return true;
      }
    }
  }

  // Check for participant video elements with audio indicators
  const participantElements = document.querySelectorAll('[data-participant-id], [data-self-name]');
  for (const participant of participantElements) {
    // Look for audio level indicators within participant containers
    const audioLevelIndicator = participant.querySelector('[data-volume-level], .audio-level, [style*="transform: scale"]');
    if (audioLevelIndicator) {
      const style = window.getComputedStyle(audioLevelIndicator);
      if (style.transform !== 'none' && style.transform !== 'scale(1)') {
        return true;
      }
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
          target.matches('.speaking') ||
          target.matches('[data-is-muted]') ||
          target.matches('[data-volume-level]')
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
              node.matches('.speaking') ||
              node.matches('[data-participant-id]') ||
              node.matches('[data-volume-level]')
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
        const micButton = document.querySelector([
          '[data-tooltip*="microphone" i]',
          '[aria-label*="microphone" i]',
          '[data-is-muted]'
        ].join(', '));
        
        const isMuted = micButton && (
          micButton.getAttribute('aria-pressed') === 'false' ||
          micButton.getAttribute('data-is-muted') === 'true' ||
          micButton.classList.contains('muted')
        );
        
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
    attributeFilter: ['aria-pressed', 'data-speaking', 'class', 'aria-label', 'data-tooltip', 'data-is-muted', 'data-volume-level', 'style']
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

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.location.hostname === 'meet.google.com') {
    // Re-check audio state when tab becomes visible
    setTimeout(() => {
      const hasAudio = checkForAudioIndicators();
      const micButton = document.querySelector([
        '[data-tooltip*="microphone" i]',
        '[aria-label*="microphone" i]',
        '[data-is-muted]'
      ].join(', '));
      
      const isMuted = micButton && (
        micButton.getAttribute('aria-pressed') === 'false' ||
        micButton.getAttribute('data-is-muted') === 'true'
      );
      
      const isSpeaking = !isMuted && micButton !== null;
      
      chrome.runtime.sendMessage({
        type: 'audio-state-changed',
        hasAudio: hasAudio,
        isSpeaking: isSpeaking
      });
    }, 500);
  }
});