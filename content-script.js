// Google Meet Audio Indicator Content Script with Debug Logging
let isMonitoring = false;
let debugMode = true; // Enable debug logging

// Initialize when page loads
if (window.location.hostname === 'meet.google.com') {
  console.log('[Meet Audio] Initializing on Google Meet page');
  initializeMeetMonitoring();
}

function initializeMeetMonitoring() {
  console.log('[Meet Audio] Starting Meet monitoring');
  
  // Notify service worker that we're on a Meet page
  chrome.runtime.sendMessage({
    type: 'meet-detected'
  }).catch(err => console.log('[Meet Audio] Error sending meet-detected:', err));

  // Wait for page to fully load before starting monitoring
  setTimeout(() => {
    startAudioMonitoring();
    observeMeetUI();
  }, 2000);
}

function startAudioMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;
  console.log('[Meet Audio] Starting audio monitoring');

  // Monitor microphone button state
  const checkMicrophoneState = () => {
    try {
      // Multiple selectors to find the microphone button
      const micSelectors = [
        '[data-tooltip*="microphone" i]',
        '[aria-label*="microphone" i]',
        '[data-tooltip*="mic" i]',
        '[aria-label*="mic" i]',
        '[data-is-muted]',
        'button[jsname*="BOHaEe"]',
        'div[data-tooltip*="Turn on microphone"]',
        'div[data-tooltip*="Turn off microphone"]',
        '[aria-label*="Turn on microphone"]',
        '[aria-label*="Turn off microphone"]',
        'button[aria-label*="microphone"]',
        'div[role="button"][aria-label*="microphone"]'
      ];

      let micButton = null;
      for (const selector of micSelectors) {
        micButton = document.querySelector(selector);
        if (micButton) {
          console.log('[Meet Audio] Found mic button with selector:', selector);
          break;
        }
      }

      if (!micButton) {
        console.log('[Meet Audio] No microphone button found, trying alternative approach');
        // Try to find buttons in the control bar
        const controlButtons = document.querySelectorAll('button, div[role="button"]');
        for (const button of controlButtons) {
          const ariaLabel = button.getAttribute('aria-label') || '';
          const tooltip = button.getAttribute('data-tooltip') || '';
          if (ariaLabel.toLowerCase().includes('microphone') || 
              ariaLabel.toLowerCase().includes('mic') ||
              tooltip.toLowerCase().includes('microphone') ||
              tooltip.toLowerCase().includes('mic')) {
            micButton = button;
            console.log('[Meet Audio] Found mic button via text search:', ariaLabel || tooltip);
            break;
          }
        }
      }

      let isMuted = true;
      let isSpeaking = false;

      if (micButton) {
        // Check various ways the button might indicate mute state
        const ariaPressed = micButton.getAttribute('aria-pressed');
        const ariaLabel = micButton.getAttribute('aria-label') || '';
        const tooltip = micButton.getAttribute('data-tooltip') || '';
        const isMutedAttr = micButton.getAttribute('data-is-muted');
        const classes = micButton.className;

        console.log('[Meet Audio] Mic button state:', {
          ariaPressed,
          ariaLabel,
          tooltip,
          isMutedAttr,
          classes
        });

        // Determine if muted based on various indicators
        isMuted = (
          ariaPressed === 'false' ||
          isMutedAttr === 'true' ||
          ariaLabel.toLowerCase().includes('turn on') ||
          ariaLabel.toLowerCase().includes('unmute') ||
          tooltip.toLowerCase().includes('turn on') ||
          tooltip.toLowerCase().includes('unmute') ||
          classes.includes('muted')
        );

        isSpeaking = !isMuted;
        console.log('[Meet Audio] Microphone state - isMuted:', isMuted, 'isSpeaking:', isSpeaking);
      } else {
        console.log('[Meet Audio] No microphone button found');
      }

      // Check for audio indicators in the UI
      const hasAudio = checkForAudioIndicators();
      
      console.log('[Meet Audio] Audio state:', { hasAudio, isSpeaking });

      chrome.runtime.sendMessage({
        type: 'audio-state-changed',
        hasAudio: hasAudio,
        isSpeaking: isSpeaking
      }).catch(err => console.log('[Meet Audio] Error sending audio state:', err));

    } catch (error) {
      console.error('[Meet Audio] Error in checkMicrophoneState:', error);
    }
  };

  // Check microphone state more frequently for better responsiveness
  setInterval(checkMicrophoneState, 1000);
  
  // Initial check after a delay
  setTimeout(checkMicrophoneState, 1000);
}

function checkForAudioIndicators() {
  try {
    console.log('[Meet Audio] Checking for audio indicators');

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
      '[jsname*="audio"]',
      // More specific Google Meet selectors
      '[data-participant-id] [data-volume-level]',
      '[data-self-name] [data-volume-level]'
    ];

    let foundAudioIndicator = false;

    for (const selector of audioIndicators) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        console.log('[Meet Audio] Found elements for selector:', selector, elements.length);
        // Check if any of these elements indicate active audio
        for (const element of elements) {
          if (element.style.display !== 'none' && 
              element.style.visibility !== 'hidden' &&
              !element.classList.contains('hidden')) {
            console.log('[Meet Audio] Active audio indicator found:', selector);
            foundAudioIndicator = true;
            break;
          }
        }
      }
    }

    // Check for audio/video elements that are playing
    const mediaElements = document.querySelectorAll('audio, video');
    console.log('[Meet Audio] Found media elements:', mediaElements.length);
    
    for (const element of mediaElements) {
      if (!element.paused && !element.muted && element.volume > 0) {
        console.log('[Meet Audio] Active media element found:', {
          paused: element.paused,
          muted: element.muted,
          volume: element.volume,
          currentTime: element.currentTime,
          readyState: element.readyState
        });
        
        if (element.currentTime > 0 && element.readyState > 2) {
          foundAudioIndicator = true;
          break;
        }
      }
    }

    // Check for participant containers with audio activity
    const participants = document.querySelectorAll('[data-participant-id], [data-self-name], [jsname]');
    console.log('[Meet Audio] Found participant elements:', participants.length);

    for (const participant of participants) {
      // Look for audio level indicators within participant containers
      const audioLevelIndicator = participant.querySelector('[data-volume-level], .audio-level, [style*="transform"], [style*="scale"]');
      if (audioLevelIndicator) {
        const style = window.getComputedStyle(audioLevelIndicator);
        console.log('[Meet Audio] Audio level indicator style:', style.transform);
        if (style.transform !== 'none' && style.transform !== 'scale(1)' && style.transform !== 'matrix(1, 0, 0, 1, 0, 0)') {
          console.log('[Meet Audio] Active audio level indicator found');
          foundAudioIndicator = true;
          break;
        }
      }
    }

    console.log('[Meet Audio] Audio indicators check result:', foundAudioIndicator);
    return foundAudioIndicator;

  } catch (error) {
    console.error('[Meet Audio] Error in checkForAudioIndicators:', error);
    return false;
  }
}

function observeMeetUI() {
  console.log('[Meet Audio] Setting up DOM observer');
  
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
          console.log('[Meet Audio] Relevant attribute change detected');
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
          console.log('[Meet Audio] Audio-related DOM changes detected');
        }
      }
    });

    if (shouldCheck) {
      // Debounce the check
      clearTimeout(window.meetAudioCheckTimeout);
      window.meetAudioCheckTimeout = setTimeout(() => {
        console.log('[Meet Audio] Triggered by DOM change');
        const hasAudio = checkForAudioIndicators();
        
        // Re-check microphone state
        const micButton = document.querySelector([
          '[data-tooltip*="microphone" i]',
          '[aria-label*="microphone" i]',
          '[data-is-muted]'
        ].join(', '));
        
        let isMuted = true;
        if (micButton) {
          const ariaPressed = micButton.getAttribute('aria-pressed');
          const ariaLabel = micButton.getAttribute('aria-label') || '';
          const isMutedAttr = micButton.getAttribute('data-is-muted');
          
          isMuted = (
            ariaPressed === 'false' ||
            isMutedAttr === 'true' ||
            ariaLabel.toLowerCase().includes('turn on') ||
            ariaLabel.toLowerCase().includes('unmute')
          );
        }
        
        const isSpeaking = !isMuted && micButton !== null;
        
        chrome.runtime.sendMessage({
          type: 'audio-state-changed',
          hasAudio: hasAudio,
          isSpeaking: isSpeaking
        }).catch(err => console.log('[Meet Audio] Error sending audio state:', err));
      }, 200);
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
    console.log('[Meet Audio] URL changed:', currentUrl);
    if (window.location.hostname === 'meet.google.com') {
      // Reinitialize on navigation
      setTimeout(initializeMeetMonitoring, 1000);
    }
  }
}, 1000);

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.location.hostname === 'meet.google.com') {
    console.log('[Meet Audio] Tab became visible, re-checking state');
    // Re-check audio state when tab becomes visible
    setTimeout(() => {
      const hasAudio = checkForAudioIndicators();
      const micButton = document.querySelector([
        '[data-tooltip*="microphone" i]',
        '[aria-label*="microphone" i]',
        '[data-is-muted]'
      ].join(', '));
      
      let isMuted = true;
      if (micButton) {
        const ariaPressed = micButton.getAttribute('aria-pressed');
        const ariaLabel = micButton.getAttribute('aria-label') || '';
        isMuted = (
          ariaPressed === 'false' ||
          ariaLabel.toLowerCase().includes('turn on')
        );
      }
      
      const isSpeaking = !isMuted && micButton !== null;
      
      chrome.runtime.sendMessage({
        type: 'audio-state-changed',
        hasAudio: hasAudio,
        isSpeaking: isSpeaking
      }).catch(err => console.log('[Meet Audio] Error sending audio state:', err));
    }, 500);
  }
});

// Add a manual debug function that can be called from console
window.debugMeetAudio = function() {
  console.log('=== MEET AUDIO DEBUG ===');
  
  // Find all buttons
  const allButtons = document.querySelectorAll('button, div[role="button"]');
  console.log('All buttons found:', allButtons.length);
  
  allButtons.forEach((btn, index) => {
    const ariaLabel = btn.getAttribute('aria-label') || '';
    const tooltip = btn.getAttribute('data-tooltip') || '';
    if (ariaLabel.toLowerCase().includes('mic') || tooltip.toLowerCase().includes('mic')) {
      console.log(`Button ${index}:`, {
        element: btn,
        ariaLabel,
        tooltip,
        ariaPressed: btn.getAttribute('aria-pressed'),
        classes: btn.className
      });
    }
  });
  
  // Find all media elements
  const mediaElements = document.querySelectorAll('audio, video');
  console.log('Media elements:', mediaElements.length);
  mediaElements.forEach((media, index) => {
    console.log(`Media ${index}:`, {
      element: media,
      paused: media.paused,
      muted: media.muted,
      volume: media.volume,
      currentTime: media.currentTime
    });
  });
  
  console.log('=== END DEBUG ===');
};

console.log('[Meet Audio] Content script loaded. Use debugMeetAudio() in console for manual debugging.');