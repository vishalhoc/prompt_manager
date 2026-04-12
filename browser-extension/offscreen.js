function playSingleBurst(context, startOffset = 0) {
  const tones = [
    { frequency: 880, start: 0, duration: 0.22, gain: 0.22, type: "square" },
    { frequency: 1175, start: 0.22, duration: 0.22, gain: 0.24, type: "square" },
    { frequency: 1568, start: 0.48, duration: 0.3, gain: 0.26, type: "triangle" },
    { frequency: 1760, start: 0.82, duration: 0.28, gain: 0.22, type: "triangle" }
  ];

  tones.forEach((tone) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.value = tone.frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime + startOffset + tone.start);
    gain.gain.exponentialRampToValueAtTime(tone.gain, context.currentTime + startOffset + tone.start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + startOffset + tone.start + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime + startOffset + tone.start);
    oscillator.stop(context.currentTime + startOffset + tone.start + tone.duration);
  });
}

function debugLog(event, details = {}, level = "info") {
  chrome.runtime.sendMessage({
    action: "pm:debug-log",
    event,
    level,
    details
  }, () => {
    void chrome.runtime.lastError;
  });
}

function playAlertSound() {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextCtor) {
    debugLog("offscreen-audio-context-missing");
    return;
  }
  const context = new AudioContextCtor();
  if (context.state === "suspended") {
    context.resume().catch(() => {
      debugLog("offscreen-audio-context-resume-failed");
    });
  }
  debugLog("offscreen-audio-context-created", { state: context.state });
  playSingleBurst(context, 0);
  playSingleBurst(context, 1.05);
  debugLog("offscreen-bursts-scheduled");

  setTimeout(() => {
    context.close().catch(() => {
      debugLog("offscreen-audio-context-close-failed");
    });
  }, 3200);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "pm:offscreen-play-alert") {
    debugLog("offscreen-play-alert-requested");
    playAlertSound();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
