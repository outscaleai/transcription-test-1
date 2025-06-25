// Google Meet Audio Monitor Offscreen Document with Speech Recognition
const activeStreams = new Map();
const audioAnalysers = new Map();
const speechRecognizers = new Map();
const transcriptionStates = new Map();

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target === 'offscreen') {
    switch (message.type) {
      case 'start-audio-monitoring':
        await startAudioMonitoring(message.data);
        break;
      case 'stop-audio-monitoring':
        stopAudioMonitoring(message.data.tabId);
        break;
      case 'toggle-transcription':
        toggleTranscription(message.data.tabId, message.data.enabled);
        break;
      case 'get-transcription-state':
        return { enabled: transcriptionStates.get(message.data.tabId) || false };
    }
  }
});

async function startAudioMonitoring({ streamId, tabId }) {
  try {
    console.log('[Offscreen] Starting audio monitoring for tab:', tabId);
    
    // Stop existing monitoring for this tab
    if (activeStreams.has(tabId)) {
      stopAudioMonitoring(tabId);
    }

    // Get media stream
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    activeStreams.set(tabId, stream);

    // Set up audio analysis
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    audioAnalysers.set(tabId, {
      analyser,
      dataArray,
      audioContext,
      source,
      stream
    });

    // Start monitoring audio levels
    monitorAudioLevel(tabId);

    // Initialize speech recognition if supported
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      initializeSpeechRecognition(tabId, stream);
    } else {
      console.warn('[Offscreen] Speech recognition not supported in this browser');
    }

  } catch (error) {
    console.error('[Offscreen] Failed to start audio monitoring:', error);
  }
}

function initializeSpeechRecognition(tabId, stream) {
  try {
    console.log('[Offscreen] Initializing speech recognition for tab:', tabId);
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    // Configure speech recognition
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    
    let isRecognizing = false;
    let lastTranscript = '';
    let transcriptBuffer = [];
    
    recognition.onstart = () => {
      console.log('[Offscreen] Speech recognition started for tab:', tabId);
      isRecognizing = true;
    };
    
    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        
        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }
      
      // Only send updates if there's new content
      if (finalTranscript || interimTranscript !== lastTranscript) {
        lastTranscript = interimTranscript;
        
        // Add final transcript to buffer
        if (finalTranscript.trim()) {
          transcriptBuffer.push({
            text: finalTranscript.trim(),
            timestamp: Date.now(),
            isFinal: true
          });
          
          // Keep only last 50 entries to prevent memory buildup
          if (transcriptBuffer.length > 50) {
            transcriptBuffer = transcriptBuffer.slice(-50);
          }
        }
        
        // Send transcription update
        chrome.runtime.sendMessage({
          type: 'transcription-update',
          tabId: tabId,
          finalTranscript: finalTranscript.trim(),
          interimTranscript: interimTranscript.trim(),
          recentTranscripts: transcriptBuffer.slice(-5) // Send last 5 entries
        }).catch(err => console.log('[Offscreen] Error sending transcription:', err));
      }
    };
    
    recognition.onerror = (event) => {
      console.error('[Offscreen] Speech recognition error:', event.error);
      
      // Restart recognition on certain errors
      if (event.error === 'network' || event.error === 'audio-capture') {
        setTimeout(() => {
          if (transcriptionStates.get(tabId) && !isRecognizing) {
            try {
              recognition.start();
            } catch (e) {
              console.log('[Offscreen] Could not restart recognition:', e);
            }
          }
        }, 1000);
      }
    };
    
    recognition.onend = () => {
      console.log('[Offscreen] Speech recognition ended for tab:', tabId);
      isRecognizing = false;
      
      // Restart if transcription is still enabled
      if (transcriptionStates.get(tabId)) {
        setTimeout(() => {
          try {
            recognition.start();
          } catch (e) {
            console.log('[Offscreen] Could not restart recognition:', e);
          }
        }, 100);
      }
    };
    
    speechRecognizers.set(tabId, {
      recognition,
      isRecognizing: () => isRecognizing,
      transcriptBuffer
    });
    
  } catch (error) {
    console.error('[Offscreen] Failed to initialize speech recognition:', error);
  }
}

function toggleTranscription(tabId, enabled) {
  console.log('[Offscreen] Toggling transcription for tab:', tabId, 'enabled:', enabled);
  
  transcriptionStates.set(tabId, enabled);
  const recognizer = speechRecognizers.get(tabId);
  
  if (!recognizer) {
    console.warn('[Offscreen] No speech recognizer found for tab:', tabId);
    return;
  }
  
  try {
    if (enabled && !recognizer.isRecognizing()) {
      recognizer.recognition.start();
      console.log('[Offscreen] Started transcription for tab:', tabId);
    } else if (!enabled && recognizer.isRecognizing()) {
      recognizer.recognition.stop();
      console.log('[Offscreen] Stopped transcription for tab:', tabId);
    }
  } catch (error) {
    console.error('[Offscreen] Error toggling transcription:', error);
  }
}

function monitorAudioLevel(tabId) {
  const analyserData = audioAnalysers.get(tabId);
  if (!analyserData) return;

  const { analyser, dataArray } = analyserData;

  const checkAudioLevel = () => {
    if (!audioAnalysers.has(tabId)) return;

    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average audio level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    
    // Determine if there's significant audio activity
    const hasAudio = average > 10;
    const audioLevel = average / 255;

    // Send audio state to service worker
    chrome.runtime.sendMessage({
      type: 'offscreen-audio-detected',
      tabId: tabId,
      hasAudio: hasAudio,
      audioLevel: audioLevel
    }).catch(err => console.log('[Offscreen] Error sending audio state:', err));

    // Continue monitoring
    setTimeout(checkAudioLevel, 100);
  };

  checkAudioLevel();
}

function stopAudioMonitoring(tabId) {
  console.log('[Offscreen] Stopping audio monitoring for tab:', tabId);
  
  // Stop speech recognition
  const recognizer = speechRecognizers.get(tabId);
  if (recognizer) {
    try {
      recognizer.recognition.stop();
    } catch (e) {
      console.log('[Offscreen] Error stopping recognition:', e);
    }
    speechRecognizers.delete(tabId);
  }
  
  // Stop transcription state
  transcriptionStates.delete(tabId);
  
  // Stop stream
  const stream = activeStreams.get(tabId);
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    activeStreams.delete(tabId);
  }

  // Clean up audio analysis
  const analyserData = audioAnalysers.get(tabId);
  if (analyserData) {
    try {
      analyserData.audioContext.close();
    } catch (e) {
      console.log('[Offscreen] Error closing audio context:', e);
    }
    audioAnalysers.delete(tabId);
  }
}

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
  for (const tabId of activeStreams.keys()) {
    stopAudioMonitoring(tabId);
  }
});