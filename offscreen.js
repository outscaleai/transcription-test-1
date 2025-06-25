// Google Meet Audio Monitor Offscreen Document
const activeStreams = new Map();
const audioAnalysers = new Map();

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target === 'offscreen') {
    switch (message.type) {
      case 'start-audio-monitoring':
        await startAudioMonitoring(message.data);
        break;
      case 'stop-audio-monitoring':
        stopAudioMonitoring(message.data.tabId);
        break;
    }
  }
});

async function startAudioMonitoring({ streamId, tabId }) {
  try {
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
      video: false // Only audio monitoring
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
      source
    });

    // Start monitoring audio levels
    monitorAudioLevel(tabId);

  } catch (error) {
    console.error('Failed to start audio monitoring:', error);
  }
}

function monitorAudioLevel(tabId) {
  const analyserData = audioAnalysers.get(tabId);
  if (!analyserData) return;

  const { analyser, dataArray } = analyserData;

  const checkAudioLevel = () => {
    if (!audioAnalysers.has(tabId)) return; // Stop if monitoring was stopped

    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average audio level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    
    // Determine if there's significant audio activity
    const hasAudio = average > 10; // Threshold for audio detection
    const audioLevel = average / 255; // Normalize to 0-1

    // Send audio state to service worker
    chrome.runtime.sendMessage({
      type: 'offscreen-audio-detected',
      tabId: tabId,
      hasAudio: hasAudio,
      audioLevel: audioLevel
    });

    // Continue monitoring
    setTimeout(checkAudioLevel, 100); // Check every 100ms
  };

  checkAudioLevel();
}

function stopAudioMonitoring(tabId) {
  // Stop stream
  const stream = activeStreams.get(tabId);
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    activeStreams.delete(tabId);
  }

  // Clean up audio analysis
  const analyserData = audioAnalysers.get(tabId);
  if (analyserData) {
    analyserData.audioContext.close();
    audioAnalysers.delete(tabId);
  }
}

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
  for (const tabId of activeStreams.keys()) {
    stopAudioMonitoring(tabId);
  }
});