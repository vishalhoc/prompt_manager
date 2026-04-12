(function () {
  const DEFAULT_SETTINGS = {
    pmSoundAlertEnabled: true,
    pmFloatingPanelEnabled: true,
    pmBridgeUrl: "http://127.0.0.1:32123"
  };
  const AI_STUDIO_CHIME_URL = "https://www.gstatic.com/aistudio/code-assist/chime.wav";
  const INPUT_SELECTORS = [
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "div.ProseMirror",
    "[data-testid='text-input']"
  ];
  const SEND_BUTTON_HINTS = /(send|run|submit|generate|up arrow|arrow up|start)/i;
  const STOP_BUTTON_HINTS = /(stop|cancel|stop generating|stop response|stop_circle)/i;
  const AI_STUDIO_RUN_BUTTON_HINTS = /(^|\b)(run|send|submit|generate|start)(\b|$)|keyboard_return|up arrow|arrow up/i;
  const AI_STUDIO_EXCLUDED_ACTION_HINTS = /\brun settings\b|structured outputs|temperature|media resolution|thinking level|advanced settings|system instructions|code execution|function calling|grounding|url context/i;
  const RESPONSE_SELECTORS = [
    "[data-turn-role='model']",
    "[data-message-author-role='assistant']",
    "[data-message-author-role='model']",
    "[data-is-streaming='false']",
    "[data-testid*='conversation-turn']",
    "[data-testid*='message']",
    "[class*='message']",
    "[class*='response']",
    "article",
    "main section",
    "main div",
    ".response-content",
    ".markdown",
    ".prose"
  ];

  const state = {
    bridgeUrl: DEFAULT_SETTINGS.pmBridgeUrl,
    soundAlertEnabled: true,
    floatingPanelEnabled: true,
    pendingResponse: false,
    generationActive: false,
    lastMutationAt: 0,
    lastResponseSnapshot: "",
    lastResponseStableAt: 0,
    lastAlertedResponse: "",
    lastKnownResponse: "",
    lastCompletedResponse: "",
    baselineResponse: "",
    baselineConversation: "",
    aiStudioSawStopButton: false,
    aiStudioLastIntentAt: 0,
    aiStudioIntentDraft: "",
    aiStudioIntentBaselineResponse: "",
    aiStudioPassiveResponse: "",
    lastCompletionAt: 0,
    alertBurstTimers: [],
    audioContext: null,
    lastPromptStats: estimateStats(""),
    panelOpen: false,
    panelPrompts: [],
    widgetMounted: false
  };

  function getSiteLabel() {
    const host = location.hostname;
    const url = location.href.toLowerCase();
    const title = document.title.toLowerCase();
    if (host.includes("aistudio.google.com")) {
      return "Google AI Studio";
    }
    if (host.includes("gemini.google.com")) {
      return "Gemini";
    }
    if (host.includes("claude.ai")) {
      return "Claude";
    }
    if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
      if (url.includes("/codex") || title.includes("codex")) {
        return "Codex";
      }
      return "ChatGPT";
    }
    return "Unsupported";
  }

  function isAiStudioPromptPage() {
    return getSiteLabel() === "Google AI Studio" && /\/prompts\//.test(location.pathname);
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function extractElementText(element) {
    if (!element) {
      return "";
    }
    if ("value" in element && typeof element.value === "string") {
      return element.value;
    }
    return (element.innerText || element.textContent || "").trim();
  }

  function getComposedPath(event) {
    if (!event) {
      return [];
    }
    if (typeof event.composedPath === "function") {
      return event.composedPath();
    }
    return event.path || [];
  }

  function getElementActionLabel(element) {
    if (!element) {
      return "";
    }
    const fragments = [
      element.innerText,
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("aria-description"),
      element.getAttribute?.("data-testid")
    ];
    const iconFragments = Array.from(element.querySelectorAll("mat-icon, .material-icons, .google-symbols, [data-icon]"))
      .map((node) => extractElementText(node))
      .filter(Boolean);
    return [...fragments, ...iconFragments]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isInsidePromptManagerUi(element) {
    return Boolean(element?.closest?.("#pm-floating-root, #prompt-manager-toast"));
  }

  function isLikelyInputElement(element) {
    if (!element) {
      return false;
    }
    if (INPUT_SELECTORS.some((selector) => element.matches?.(selector))) {
      return true;
    }
    return Boolean(element.closest?.("form, footer, [role='textbox'], [contenteditable='true']"));
  }

  function estimateStats(text) {
    const value = String(text || "");
    return {
      characters: value.length,
      words: value.trim() ? value.trim().split(/\s+/).length : 0,
      estimatedTokens: Math.max(1, Math.ceil(value.length / 4))
    };
  }

  function formatStats(stats) {
    return `${stats.characters.toLocaleString()} chars • ${stats.words.toLocaleString()} words • ${stats.estimatedTokens.toLocaleString()} tok`;
  }

  function bridgeFetch(path, options = {}) {
    return fetch(`${state.bridgeUrl}${path}`, {
      headers: {
        "Content-Type": "application/json"
      },
      ...options
    }).then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Bridge request failed (${response.status})`);
      }
      return response.status === 204 ? {} : response.json();
    });
  }

  function logDebug(event, details = {}, level = "info") {
    bridgeFetch("/debug/log", {
      method: "POST",
      body: JSON.stringify({
        source: "content",
        level,
        event,
        site: getSiteLabel(),
        url: location.href,
        details
      })
    }).catch(() => {
    });
  }

  function requestNativeAlert() {
    bridgeFetch("/alert", {
      method: "POST",
      body: JSON.stringify({
        source: "content",
        site: getSiteLabel(),
        url: location.href,
        title: document.title
      })
    }).then(() => {
      logDebug("native-alert-bridge-ok");
    }).catch((error) => {
      logDebug("native-alert-bridge-failed", { error: error.message }, "error");
    });
  }

  function ensureAudioContext() {
    try {
      if (state.audioContext && state.audioContext.state !== "closed") {
        if (state.audioContext.state === "suspended") {
          state.audioContext.resume().catch(() => {
          });
        }
        return state.audioContext;
      }
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        return null;
      }
      state.audioContext = new AudioContextCtor();
      if (state.audioContext.state === "suspended") {
        state.audioContext.resume().catch(() => {
        });
      }
      return state.audioContext;
    } catch {
      return null;
    }
  }

  function primeAudioContext() {
    const context = ensureAudioContext();
    if (!context) {
      return;
    }
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 440;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.02);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.02);
    } catch {
    }
  }

  function findPromptInput() {
    const active = document.activeElement;
    if (active && INPUT_SELECTORS.some((selector) => active.matches?.(selector)) && isVisible(active)) {
      return active;
    }

    const candidates = INPUT_SELECTORS
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => isVisible(element));

    candidates.sort((a, b) => {
      const aScore = extractElementText(a).length + (a.getBoundingClientRect().width * a.getBoundingClientRect().height);
      const bScore = extractElementText(b).length + (b.getBoundingClientRect().width * b.getBoundingClientRect().height);
      return bScore - aScore;
    });

    return candidates[0] || null;
  }

  function getPromptDraftFromNode(node) {
    if (!node || typeof node !== "object") {
      return "";
    }
    const direct = extractElementText(node);
    if (direct.trim()) {
      return direct.trim();
    }
    if (typeof node.querySelector === "function") {
      for (const selector of INPUT_SELECTORS) {
        const nested = node.querySelector(selector);
        const value = extractElementText(nested);
        if (value.trim()) {
          return value.trim();
        }
      }
    }
    return "";
  }

  function capturePromptDraft(target = null) {
    const sources = [];
    if (target) {
      sources.push(target);
      if (typeof target.closest === "function") {
        sources.push(target.closest("[data-testid='main-prompt-container']"));
        sources.push(target.closest("form"));
      }
    }
    const promptInput = findPromptInput();
    if (promptInput) {
      sources.push(promptInput);
      if (typeof promptInput.closest === "function") {
        sources.push(promptInput.closest("[data-testid='main-prompt-container']"));
        sources.push(promptInput.closest("form"));
      }
    }
    sources.push(getAiStudioPromptRegion());
    for (const source of sources.filter(Boolean)) {
      const value = getPromptDraftFromNode(source);
      if (value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  function setPromptInputText(text) {
    const target = findPromptInput();
    if (!target) {
      throw new Error("No prompt input found on this page.");
    }

    target.focus();
    if ("value" in target) {
      target.value = text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    target.textContent = text;
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function collectVisibleButtons(scope = document) {
    return Array.from(scope.querySelectorAll("button, [role='button'], ms-button"))
      .filter((button) => isVisible(button) && button.getAttribute("aria-disabled") !== "true" && !button.disabled && !isInsidePromptManagerUi(button));
  }

  function getAiStudioPromptRegion() {
    const promptInput = findPromptInput();
    const candidates = [
      promptInput?.closest?.("[data-testid='main-prompt-container']"),
      promptInput?.closest?.(".prompt-input-container"),
      promptInput?.closest?.(".prompt-input-area"),
      document.querySelector("[data-testid='main-prompt-container']"),
      promptInput?.closest?.("form"),
      promptInput?.parentElement,
      document.querySelector("footer"),
      document.querySelector("main")
    ].filter(Boolean);

    return candidates.find((element) => isVisible(element)) || null;
  }

  function findAiStudioActionButton(matchRegex, excludeRegex = null) {
    const promptRegion = getAiStudioPromptRegion();
    const scopes = [
      promptRegion,
      promptRegion?.parentElement,
      document.querySelector("footer"),
      document.querySelector("main"),
      document.body
    ].filter(Boolean);
    const seen = new Set();
    const candidates = [];

    scopes.forEach((scope) => {
      collectVisibleButtons(scope).forEach((button) => {
        if (seen.has(button)) {
          return;
        }
        seen.add(button);
        const label = getElementActionLabel(button);
        if (!label || (excludeRegex && excludeRegex.test(label)) || !matchRegex.test(label)) {
          return;
        }
        const rect = button.getBoundingClientRect();
        const inPromptRegion = Boolean(promptRegion && promptRegion.contains(button));
        const bottomBias = rect.top >= window.innerHeight * 0.55 ? 1200 : 0;
        const promptBias = inPromptRegion ? 2000 : 0;
        const visibleBias = rect.bottom <= window.innerHeight + 8 ? 200 : 0;
        const proximityBias = promptRegion
          ? Math.max(0, 600 - Math.abs(rect.top - promptRegion.getBoundingClientRect().top))
          : 0;
        candidates.push({
          button,
          score: promptBias + bottomBias + visibleBias + proximityBias
        });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.button || null;
  }

  function findAiStudioRunButton() {
    return findAiStudioActionButton(AI_STUDIO_RUN_BUTTON_HINTS, AI_STUDIO_EXCLUDED_ACTION_HINTS);
  }

  function findAiStudioStopButton() {
    return findAiStudioActionButton(STOP_BUTTON_HINTS);
  }

  function findSendButton() {
    if (isAiStudioPromptPage()) {
      return findAiStudioRunButton();
    }
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((button) => isVisible(button) && button.getAttribute("aria-disabled") !== "true" && !button.disabled);
    return buttons.find((button) => {
      const label = getElementActionLabel(button);
      return SEND_BUTTON_HINTS.test(label);
    }) || null;
  }

  function clickSendButton() {
    const button = findSendButton();
    if (!button) {
      throw new Error("Could not find a send button on this page.");
    }
    button.click();
  }

  function isPromptInputEventTarget(target) {
    if (!target) {
      return false;
    }
    const promptInput = findPromptInput();
    if (promptInput && (target === promptInput || promptInput.contains?.(target))) {
      return true;
    }
    return isLikelyInputElement(target);
  }

  function shouldArmPendingFromKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey) {
      return false;
    }
    if (isAiStudioPromptPage()) {
      if (!event.ctrlKey && !event.metaKey) {
        return false;
      }
      if (isInsidePromptManagerUi(event.target)) {
        return false;
      }
      return true;
    }
    if (!isPromptInputEventTarget(event.target)) {
      return false;
    }
    return !event.ctrlKey && !event.metaKey;
  }

  function findVisibleAction(regex) {
    const selectors = [
      "button",
      "[role='button']",
      "[tabindex]",
      "label",
      "summary",
      ".mdc-switch",
      ".mat-mdc-slide-toggle",
      ".mat-mdc-button-touch-target"
    ];
    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => isVisible(element) && !isInsidePromptManagerUi(element));
    return candidates.find((element) => {
      const label = [
        element.innerText,
        element.textContent,
        element.getAttribute?.("aria-label"),
        element.getAttribute?.("title")
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return regex.test(label);
    }) || null;
  }

  function isGeneratingNow() {
    if (isAiStudioPromptPage()) {
      return Boolean(findAiStudioStopButton());
    }
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter((button) => isVisible(button));
    return buttons.some((button) => {
      const label = getElementActionLabel(button);
      return STOP_BUTTON_HINTS.test(label);
    });
  }

  function collectResponseCandidates() {
    const seen = new Set();
    const nodes = RESPONSE_SELECTORS
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => {
        if (!element || !isVisible(element) || isInsidePromptManagerUi(element) || isLikelyInputElement(element)) {
          return false;
        }
        const text = extractElementText(element);
        if (text.length < 40) {
          return false;
        }
        const key = `${element.tagName}:${text.slice(0, 120)}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });

    return nodes.map((element) => {
      const text = extractElementText(element);
      const rect = element.getBoundingClientRect();
      const lowerBias = Math.max(0, rect.top);
      const score = text.length + lowerBias;
      return {
        element,
        text,
        score
      };
    });
  }

  function fallbackConversationText() {
    const blocks = Array.from(document.querySelectorAll("main p, main li, main pre, main code, main h1, main h2, main h3, main h4, main blockquote"))
      .filter((element) => isVisible(element) && !isInsidePromptManagerUi(element) && !isLikelyInputElement(element))
      .map((element) => extractElementText(element))
      .filter((text) => text.length > 20);
    const joined = blocks.join("\n").trim();
    return joined.length > 80 ? joined : "";
  }

  function getConversationSnapshot() {
    if (isAiStudioPromptPage()) {
      const root = document.querySelector("main") || document.querySelector("app-root") || document.body;
      const text = (root?.innerText || "").trim();
      return text
        .replace(/\bGoogle AI Studio\b/g, "")
        .replace(/\bRun settings\b/g, "")
        .replace(/\bStream\b/g, "")
        .replace(/\bModel\b/g, "")
        .replace(/\bTools\b/g, "")
        .replace(/\bInsert assets\b/g, "")
        .replace(/\bCompare\b/g, "")
        .replace(/\bToken count\b/g, "")
        .replace(/\bSafety settings\b/g, "")
        .replace(/\bHistory\b/g, "")
        .replace(/\bGet code\b/g, "")
        .replace(/\bShare\b/g, "")
        .replace(/\bSave\b/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    return fallbackConversationText();
  }

  function extractSuffixDelta(previousText, currentText) {
    const before = String(previousText || "").trim();
    const after = String(currentText || "").trim();
    if (!after) {
      return "";
    }
    if (!before) {
      return after;
    }
    if (after.startsWith(before)) {
      return after.slice(before.length).trim();
    }
    let prefixLength = 0;
    const limit = Math.min(before.length, after.length);
    while (prefixLength < limit && before[prefixLength] === after[prefixLength]) {
      prefixLength += 1;
    }
    return after.slice(prefixLength).trim();
  }

  function isAiStudioTimestampLine(line) {
    return /^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(String(line || "").replace(/\u202f/g, " ").trim());
  }

  function isAiStudioNoiseLine(line) {
    const value = String(line || "").replace(/\u202f/g, " ").trim();
    if (!value) {
      return true;
    }
    if (/^\d{1,3}(,\d{3})*\s+tokens$/i.test(value)) {
      return true;
    }
    if (/^User(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?$/i.test(value)) {
      return true;
    }
    if (isAiStudioTimestampLine(value)) {
      return true;
    }
    if (/^Google AI models may make mistakes, so double-check outputs\.?$/i.test(value)) {
      return true;
    }
    if (/^Use Arrow Up and Arrow Down to select a turn, Enter to jump to it, and Escape to return to the chat\.?$/i.test(value)) {
      return true;
    }
    return [
      "Thoughts",
      "Expand to view model thoughts",
      "chevron_right",
      "edit",
      "more_vert",
      "thumb_up",
      "thumb_down",
      "info",
      "widgets",
      "mic",
      "add_circle",
      "Run",
      "Ctrl",
      "keyboard_return",
      "code",
      "reset_settings",
      "close",
      "share",
      "compare_arrows",
      "design_services",
      "expand_more",
      "trending_flat",
      "arrow_outward",
      "search",
      "notifications",
      "key",
      "settings",
      "menu_open",
      "Structured outputs",
      "Grounding with Google Search",
      "Grounding with Google Maps",
      "Function calling",
      "Code execution",
      "URL context",
      "Advanced settings",
      "System instructions",
      "Temperature",
      "Media resolution",
      "Thinking level",
      "Default",
      "No API Key"
    ].includes(value);
  }

  function isAiStudioUserMarker(line) {
    return /^User(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?$/i.test(String(line || "").replace(/\u202f/g, " ").trim());
  }

  function trimAiStudioFooter(lines) {
    const footerPatterns = [
      /^Google AI models may make mistakes, so double-check outputs\.?$/i,
      /^Use Arrow Up and Arrow Down to select a turn, Enter to jump to it, and Escape to return to the chat\.?$/i
    ];
    let cutIndex = lines.length;
    for (let index = 0; index < lines.length; index += 1) {
      const line = String(lines[index] || "").replace(/\u202f/g, " ").trim();
      if (footerPatterns.some((pattern) => pattern.test(line))) {
        cutIndex = index;
        break;
      }
    }
    return lines.slice(0, cutIndex);
  }

  function extractLatestAiStudioResponseFromText(text) {
    const value = String(text || "").replace(/\r/g, "");
    if (!value.trim()) {
      return "";
    }
    const footerMarkers = [
      "\nGemini ",
      "\nSystem instructions",
      "\nTemperature",
      "\nAdvanced settings",
      "\nStructured outputs",
      "\nNo API Key"
    ];
    let cutText = value;
    footerMarkers.forEach((marker) => {
      const index = cutText.indexOf(marker);
      if (index > 0) {
        cutText = cutText.slice(0, index);
      }
    });
    const lines = trimAiStudioFooter(cutText
      .split("\n")
      .map((line) => line.replace(/\u202f/g, " ").trim())
      .filter(Boolean));
    if (!lines.length) {
      return "";
    }

    let lastUserIndex = -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (isAiStudioUserMarker(lines[index])) {
        lastUserIndex = index;
        break;
      }
    }

    let startIndex = 0;
    if (lastUserIndex >= 0) {
      let assistantTimestampIndex = -1;
      for (let index = lastUserIndex + 1; index < lines.length; index += 1) {
        if (isAiStudioTimestampLine(lines[index])) {
          assistantTimestampIndex = index;
          break;
        }
      }
      startIndex = assistantTimestampIndex >= 0 ? assistantTimestampIndex + 1 : lastUserIndex + 1;
    } else {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (isAiStudioTimestampLine(lines[index])) {
          startIndex = index + 1;
          break;
        }
      }
    }

    const responseLines = [];
    for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (isAiStudioUserMarker(line)) {
        responseLines.length = 0;
        continue;
      }
      if (isAiStudioNoiseLine(line)) {
        continue;
      }
      responseLines.push(line);
    }

    const result = responseLines.join("\n").trim();
    if (!result) {
      return "";
    }
    if (result.length < 3) {
      return "";
    }
    return result;
  }

  function getLatestResponseText() {
    if (isAiStudioPromptPage()) {
      const conversation = getConversationSnapshot();
      const latestTurn = extractLatestAiStudioResponseFromText(conversation);
      if (state.pendingResponse && state.baselineConversation) {
        const delta = extractSuffixDelta(state.baselineConversation, conversation);
        const latestDeltaTurn = extractLatestAiStudioResponseFromText(delta);
        if (latestDeltaTurn.length >= 3) {
          state.lastKnownResponse = latestDeltaTurn;
          return latestDeltaTurn;
        }
      }
      if (latestTurn.length >= 3) {
        state.lastKnownResponse = latestTurn;
        return latestTurn;
      }
    }
    const candidates = collectResponseCandidates().sort((a, b) => a.score - b.score);
    const best = candidates.at(-1)?.text || "";
    if (best.length >= 40) {
      state.lastKnownResponse = best;
      return best;
    }
    const fallback = fallbackConversationText();
    if (fallback.length >= 20) {
      state.lastKnownResponse = fallback;
      return fallback;
    }
    return state.lastKnownResponse || "";
  }

  function clearAlertBurstTimers() {
    state.alertBurstTimers.forEach((timerId) => window.clearTimeout(timerId));
    state.alertBurstTimers = [];
  }

  function playLoudAlert() {
    logDebug("play-loud-alert-start", {
      aiStudioPromptPage: isAiStudioPromptPage(),
      hasAudioContext: Boolean(state.audioContext)
    });
    if (isAiStudioPromptPage()) {
      try {
        const audio = new Audio(AI_STUDIO_CHIME_URL);
        audio.volume = 1;
        audio.play().catch(() => {
          logDebug("ai-studio-chime-play-rejected");
        });
      } catch {
        logDebug("ai-studio-chime-play-threw");
      }
    }
    const context = ensureAudioContext();
    if (context) {
      try {
        const tones = [
          { frequency: 880, start: 0, duration: 0.2, gain: 0.18, type: "square" },
          { frequency: 1175, start: 0.22, duration: 0.22, gain: 0.2, type: "square" },
          { frequency: 1568, start: 0.5, duration: 0.28, gain: 0.22, type: "triangle" },
          { frequency: 1760, start: 0.82, duration: 0.22, gain: 0.18, type: "triangle" }
        ];
        tones.forEach((tone) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = tone.type;
          oscillator.frequency.value = tone.frequency;
          gain.gain.setValueAtTime(0.0001, context.currentTime + tone.start);
          gain.gain.exponentialRampToValueAtTime(tone.gain, context.currentTime + tone.start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + tone.start + tone.duration);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(context.currentTime + tone.start);
          oscillator.stop(context.currentTime + tone.start + tone.duration);
        });
        logDebug("audio-context-burst-scheduled", { state: context.state });
      } catch {
        logDebug("audio-context-burst-failed", {}, "error");
      }
    } else {
      logDebug("audio-context-unavailable");
    }
    chrome.runtime.sendMessage({ action: "pm:play-alert-sound" }, () => {
      if (chrome.runtime.lastError) {
        logDebug("runtime-play-alert-failed", { error: chrome.runtime.lastError.message }, "error");
        return;
      }
      logDebug("runtime-play-alert-sent");
    });
  }

  function playAlertBurst() {
    clearAlertBurstTimers();
    logDebug("play-alert-burst");
    requestNativeAlert();
    const burstOffsets = [0, 900, 1800];
    burstOffsets.forEach((offset) => {
      const timerId = window.setTimeout(() => {
        playLoudAlert();
      }, offset);
      state.alertBurstTimers.push(timerId);
    });
  }

  function showToast(message, accent = "#53d7ac") {
    const existing = document.getElementById("prompt-manager-toast");
    if (existing) {
      existing.remove();
    }
    const toast = document.createElement("div");
    toast.id = "prompt-manager-toast";
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      padding: "12px 14px",
      borderRadius: "14px",
      background: "rgba(11,18,32,0.96)",
      color: "#edf3ff",
      fontSize: "12px",
      lineHeight: "1.4",
      border: `1px solid ${accent}`,
      boxShadow: "0 16px 38px rgba(0,0,0,0.28)"
    });
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 5000);
  }

  function captureDraftStatus() {
    const draft = extractElementText(findPromptInput());
    const latestResponse = state.lastCompletedResponse || getLatestResponseText();
    return {
      supported: getSiteLabel() !== "Unsupported",
      site: getSiteLabel(),
      url: location.href,
      pageTitle: document.title,
      draft,
      stats: estimateStats(draft),
      latestResponse,
      responseStats: estimateStats(latestResponse),
      isAiStudioPromptPage: isAiStudioPromptPage(),
      pendingResponse: state.pendingResponse
    };
  }

  function markResponsePending(options = {}) {
    const reason = options.reason || "unknown";
    const draft = String(options.draftText || capturePromptDraft(options.target || null) || state.aiStudioIntentDraft || "").trim();
    if (!draft && !isAiStudioPromptPage()) {
      logDebug("mark-response-pending-skipped-no-draft", { reason });
      return;
    }
    logDebug("mark-response-pending", {
      draftLength: draft.length,
      aiStudioPromptPage: isAiStudioPromptPage(),
      reason,
      usedIntentDraft: Boolean(!options.draftText && state.aiStudioIntentDraft)
    });
    primeAudioContext();
    state.pendingResponse = true;
    state.generationActive = true;
    state.lastMutationAt = Date.now();
    state.lastResponseSnapshot = "";
    state.lastResponseStableAt = Date.now();
    state.baselineConversation = getConversationSnapshot();
    state.baselineResponse = isAiStudioPromptPage()
      ? extractLatestAiStudioResponseFromText(state.baselineConversation)
      : getLatestResponseText();
    state.lastKnownResponse = state.baselineResponse || state.lastKnownResponse;
    state.lastCompletedResponse = "";
    state.aiStudioSawStopButton = false;
    state.lastPromptStats = estimateStats(draft);
    state.aiStudioPassiveResponse = state.baselineResponse || state.aiStudioPassiveResponse;
    clearAlertBurstTimers();
  }

  function registerAiStudioSendIntent(reason, target = null, extra = {}) {
    if (!isAiStudioPromptPage()) {
      return;
    }
    const draft = capturePromptDraft(target);
    state.aiStudioLastIntentAt = Date.now();
    state.aiStudioIntentDraft = draft;
    state.aiStudioIntentBaselineResponse = getLatestResponseText() || state.lastCompletedResponse || state.lastKnownResponse || "";
    logDebug("ai-studio-send-intent", {
      reason,
      draftLength: draft.length,
      baselineResponseLength: state.aiStudioIntentBaselineResponse.length,
      ...extra
    });
  }

  function maybeAutoArmAiStudio(responseText, stopButtonVisible) {
    if (!isAiStudioPromptPage() || state.pendingResponse) {
      return;
    }
    const now = Date.now();
    if (state.lastCompletionAt && now - state.lastCompletionAt < 8000) {
      return;
    }
    const recentIntent = state.aiStudioLastIntentAt && now - state.aiStudioLastIntentAt < 30000;
    const currentResponse = String(responseText || "");
    const baseline = state.aiStudioIntentBaselineResponse || state.aiStudioPassiveResponse || state.lastCompletedResponse || "";
    const responseChanged = Boolean(currentResponse) && currentResponse !== baseline;
    const duplicateResponse = currentResponse && currentResponse === state.lastAlertedResponse;

    if (duplicateResponse) {
      return;
    }

    if (stopButtonVisible && recentIntent) {
      markResponsePending({
        draftText: state.aiStudioIntentDraft,
        reason: "ai-studio-stop-visible"
      });
      return;
    }

    if (recentIntent && responseChanged) {
      markResponsePending({
        draftText: state.aiStudioIntentDraft,
        reason: "ai-studio-response-changed"
      });
    }
  }

  function focusPromptInput() {
    const input = findPromptInput();
    if (!input) {
      throw new Error("No prompt input found on this page.");
    }
    input.focus();
    return true;
  }

  function toggleAiStudioRunSettings() {
    if (getSiteLabel() !== "Google AI Studio") {
      throw new Error("Open Google AI Studio first.");
    }
    const action = findVisibleAction(/\brun settings\b/i);
    if (!action) {
      throw new Error("Could not find a visible Run settings control on this page.");
    }
    action.click();
    return true;
  }

  function toggleAiStudioStream() {
    if (getSiteLabel() !== "Google AI Studio") {
      throw new Error("Open Google AI Studio first.");
    }
    const action = findVisibleAction(/\bstream\b/i);
    if (!action) {
      throw new Error("Could not find a visible Stream control on this page.");
    }
    action.click();
    return true;
  }

  async function syncSettingsFromStorage() {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    state.soundAlertEnabled = stored.pmSoundAlertEnabled !== false;
    state.floatingPanelEnabled = stored.pmFloatingPanelEnabled !== false;
    state.bridgeUrl = String(stored.pmBridgeUrl || DEFAULT_SETTINGS.pmBridgeUrl).replace(/\/+$/, "");
    mountWidget();
  }

  function buildWidget() {
    const root = document.createElement("div");
    root.id = "pm-floating-root";
    root.innerHTML = `
      <button type="button" id="pm-floating-toggle">Prompt Manager</button>
      <div id="pm-floating-panel" style="display:none">
        <div id="pm-floating-head">
          <strong>Prompt Manager</strong>
          <button type="button" id="pm-panel-close">x</button>
        </div>
        <p id="pm-panel-site">${getSiteLabel()}</p>
        <select id="pm-panel-select">
          <option value="">Choose saved prompt</option>
        </select>
        <div id="pm-panel-actions">
          <button type="button" id="pm-panel-paste">Paste</button>
          <button type="button" id="pm-panel-paste-send">Paste + Send</button>
          <button type="button" id="pm-panel-save">Save Draft</button>
          <button type="button" id="pm-panel-refresh">Reload</button>
        </div>
        <p id="pm-panel-status">Ready.</p>
      </div>
    `;
    document.body.appendChild(root);

    const style = document.createElement("style");
    style.id = "pm-floating-style";
    style.textContent = `
      #pm-floating-root {
        position: fixed;
        right: 18px;
        top: 120px;
        z-index: 2147483646;
        font-family: "Segoe UI", Tahoma, sans-serif;
      }
      #pm-floating-toggle,
      #pm-floating-panel button,
      #pm-floating-panel select {
        font: inherit;
      }
      #pm-floating-toggle {
        border: 0;
        padding: 10px 12px;
        border-radius: 999px;
        background: #53d7ac;
        color: #062116;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 14px 34px rgba(0,0,0,0.24);
      }
      #pm-floating-panel {
        width: 280px;
        margin-top: 10px;
        padding: 12px;
        border-radius: 18px;
        background: rgba(11,18,32,0.97);
        color: #edf3ff;
        border: 1px solid rgba(145,174,215,0.16);
        box-shadow: 0 22px 52px rgba(0,0,0,0.3);
      }
      #pm-floating-head,
      #pm-panel-actions {
        display: flex;
        gap: 8px;
        justify-content: space-between;
        align-items: center;
      }
      #pm-panel-head {
        margin-bottom: 8px;
      }
      #pm-panel-site,
      #pm-panel-status {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.4;
        color: #9eb0cb;
      }
      #pm-panel-select {
        width: 100%;
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid rgba(145,174,215,0.16);
        background: #0d1524;
        color: #edf3ff;
      }
      #pm-panel-actions {
        margin-top: 10px;
        flex-wrap: wrap;
      }
      #pm-floating-panel button {
        border: 1px solid rgba(145,174,215,0.16);
        background: transparent;
        color: #edf3ff;
        padding: 8px 10px;
        border-radius: 10px;
        cursor: pointer;
      }
      #pm-panel-paste,
      #pm-panel-paste-send {
        background: rgba(83,215,172,0.18);
      }
    `;
    document.documentElement.appendChild(style);

    root.querySelector("#pm-floating-toggle").onclick = async () => {
      state.panelOpen = !state.panelOpen;
      root.querySelector("#pm-floating-panel").style.display = state.panelOpen ? "block" : "none";
      if (state.panelOpen) {
        await loadPromptOptionsIntoPanel();
      }
    };
    root.querySelector("#pm-panel-close").onclick = () => {
      state.panelOpen = false;
      root.querySelector("#pm-floating-panel").style.display = "none";
    };
    root.querySelector("#pm-panel-refresh").onclick = async () => {
      await loadPromptOptionsIntoPanel();
      updatePanelStatus("Prompt list refreshed.");
    };
    root.querySelector("#pm-panel-save").onclick = async () => {
      try {
        const payload = captureDraftStatus();
        if (!payload.draft) {
          throw new Error("No typed prompt found.");
        }
        await bridgeFetch("/captures", {
          method: "POST",
          body: JSON.stringify({
            title: `${payload.pageTitle || payload.site} draft`,
            pageTitle: payload.pageTitle,
            sourceUrl: payload.url,
            site: payload.site,
            text: payload.draft
          })
        });
        updatePanelStatus("Current draft saved to Prompt Manager.");
      } catch (error) {
        updatePanelStatus(error.message);
      }
    };
    root.querySelector("#pm-panel-paste").onclick = async () => {
      await pasteSelectedPanelPrompt(false);
    };
    root.querySelector("#pm-panel-paste-send").onclick = async () => {
      await pasteSelectedPanelPrompt(true);
    };
  }

  function updatePanelStatus(message) {
    const node = document.getElementById("pm-panel-status");
    if (node) {
      node.textContent = message;
    }
  }

  async function loadPromptOptionsIntoPanel() {
    const panel = document.getElementById("pm-panel-select");
    if (!panel) {
      return;
    }
    try {
      const payload = await bridgeFetch("/prompts");
      state.panelPrompts = payload.prompts || [];
      const current = panel.value;
      panel.innerHTML = `<option value="">Choose saved prompt</option>`;
      state.panelPrompts.forEach((prompt) => {
        panel.add(new Option(prompt.name, prompt.id));
      });
      if ([...panel.options].some((option) => option.value === current)) {
        panel.value = current;
      }
    } catch (error) {
      updatePanelStatus(`Bridge error: ${error.message}`);
    }
  }

  async function pasteSelectedPanelPrompt(sendAfterPaste) {
    const panel = document.getElementById("pm-panel-select");
    const promptId = panel?.value;
    if (!promptId) {
      updatePanelStatus("Choose a saved prompt first.");
      return;
    }
    try {
      const payload = await bridgeFetch(`/prompts/${encodeURIComponent(promptId)}?refresh=1&git=1`);
      setPromptInputText(payload.prompt);
      if (sendAfterPaste) {
        clickSendButton();
      }
      updatePanelStatus(`${sendAfterPaste ? "Pasted and sent" : "Pasted"} "${payload.name}".`);
      showToast(`Prompt Manager inserted "${payload.name}" into ${getSiteLabel()}.`);
    } catch (error) {
      updatePanelStatus(error.message);
    }
  }

  function mountWidget() {
    const existingRoot = document.getElementById("pm-floating-root");
    const existingStyle = document.getElementById("pm-floating-style");
    if (!state.floatingPanelEnabled) {
      existingRoot?.remove();
      existingStyle?.remove();
      state.widgetMounted = false;
      return;
    }
    if (state.widgetMounted && existingRoot) {
      const site = document.getElementById("pm-panel-site");
      if (site) {
        site.textContent = getSiteLabel();
      }
      return;
    }
    buildWidget();
    state.widgetMounted = true;
  }

  function installSpaHooks() {
    const wrap = (methodName) => {
      const original = history[methodName];
      if (typeof original !== "function" || original.__pmWrapped) {
        return;
      }
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        window.setTimeout(() => {
          if (state.floatingPanelEnabled) {
            mountWidget();
          }
        }, 400);
        return result;
      };
      wrapped.__pmWrapped = true;
      history[methodName] = wrapped;
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", () => {
      window.setTimeout(() => {
        if (state.floatingPanelEnabled) {
          mountWidget();
        }
      }, 400);
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }
    if (changes.pmSoundAlertEnabled) {
      state.soundAlertEnabled = changes.pmSoundAlertEnabled.newValue !== false;
    }
    if (changes.pmFloatingPanelEnabled) {
      state.floatingPanelEnabled = changes.pmFloatingPanelEnabled.newValue !== false;
      mountWidget();
    }
    if (changes.pmBridgeUrl) {
      state.bridgeUrl = String(changes.pmBridgeUrl.newValue || DEFAULT_SETTINGS.pmBridgeUrl).replace(/\/+$/, "");
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "pm:get-status") {
      sendResponse(captureDraftStatus());
      return true;
    }

    if (message.action === "pm:capture-draft") {
      sendResponse(captureDraftStatus());
      return true;
    }

    if (message.action === "pm:capture-response") {
      const response = getLatestResponseText();
      sendResponse({
        supported: getSiteLabel() !== "Unsupported",
        site: getSiteLabel(),
        url: location.href,
        pageTitle: document.title,
        response: response || state.lastCompletedResponse || state.lastResponseSnapshot || state.lastKnownResponse || "",
        responseStats: estimateStats(response || state.lastCompletedResponse || state.lastResponseSnapshot || state.lastKnownResponse || ""),
        found: Boolean(response || state.lastCompletedResponse || state.lastResponseSnapshot || state.lastKnownResponse)
      });
      return true;
    }

    if (message.action === "pm:test-alert") {
      logDebug("content-test-alert-requested");
      playAlertBurst();
      sendResponse({ ok: true });
      return true;
    }

    if (message.action === "pm:focus-input") {
      try {
        focusPromptInput();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message.action === "pm:aistudio-run-settings") {
      try {
        toggleAiStudioRunSettings();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message.action === "pm:aistudio-toggle-stream") {
      try {
        toggleAiStudioStream();
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message.action === "pm:paste-text") {
      try {
        setPromptInputText(String(message.text || ""));
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message.action === "pm:paste-and-send") {
      try {
        setPromptInputText(String(message.text || ""));
        window.setTimeout(() => {
          try {
            markResponsePending();
            clickSendButton();
          } catch {
          }
        }, 120);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
      return true;
    }

    if (message.action === "pm:update-settings") {
      if (typeof message.soundAlertEnabled === "boolean") {
        state.soundAlertEnabled = message.soundAlertEnabled;
      }
      if (typeof message.floatingPanelEnabled === "boolean") {
        state.floatingPanelEnabled = message.floatingPanelEnabled;
        mountWidget();
      }
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  document.addEventListener("keydown", (event) => {
    primeAudioContext();
    if (event.altKey && !event.shiftKey && event.key.toLowerCase() === "p") {
      const root = document.getElementById("pm-floating-root");
      if (root) {
        const toggle = root.querySelector("#pm-floating-toggle");
        toggle?.click();
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (shouldArmPendingFromKeydown(event)) {
      if (isAiStudioPromptPage()) {
        const path = getComposedPath(event);
        const target = path.find((node) => node && typeof node === "object" && node.nodeType === Node.ELEMENT_NODE) || event.target;
        registerAiStudioSendIntent("keydown", target, {
          key: event.key,
          ctrlKey: Boolean(event.ctrlKey),
          metaKey: Boolean(event.metaKey)
        });
        window.setTimeout(() => markResponsePending({
          draftText: state.aiStudioIntentDraft,
          reason: "keydown-ctrl-enter",
          target
        }), 20);
      } else {
        const target = event.target;
        const draftText = capturePromptDraft(target);
        window.setTimeout(() => markResponsePending({
          draftText,
          reason: "keydown-enter",
          target
        }), 20);
      }
    }
  }, true);

  document.addEventListener("click", (event) => {
    primeAudioContext();
    const button = event.target?.closest?.("button, [role='button'], ms-button");
    if (!button) {
      return;
    }
    if (isAiStudioPromptPage()) {
      const runButton = findAiStudioRunButton();
      if (runButton && (button === runButton || runButton.contains?.(button) || button.contains?.(runButton))) {
        registerAiStudioSendIntent("click", runButton, {
          label: getElementActionLabel(runButton)
        });
        window.setTimeout(() => markResponsePending({
          draftText: state.aiStudioIntentDraft,
          reason: "click-run-button",
          target: runButton
        }), 40);
      }
      return;
    }
    const label = getElementActionLabel(button);
    if (SEND_BUTTON_HINTS.test(label)) {
      const draftText = capturePromptDraft(button);
      window.setTimeout(() => markResponsePending({
        draftText,
        reason: "click-send-button",
        target: button
      }), 40);
    }
  }, true);

  const observer = new MutationObserver(() => {
    if (!state.pendingResponse) {
      return;
    }
    state.lastMutationAt = Date.now();
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });

  window.setInterval(() => {
    const responseText = getLatestResponseText();
    if (isAiStudioPromptPage()) {
      const stopButton = findAiStudioStopButton();
      maybeAutoArmAiStudio(responseText, Boolean(stopButton));
    }
    if (!state.pendingResponse) {
      if (isAiStudioPromptPage() && responseText) {
        state.aiStudioPassiveResponse = responseText;
      }
      return;
    }
    if (responseText && responseText !== state.lastResponseSnapshot) {
      state.lastResponseSnapshot = responseText;
      state.lastResponseStableAt = Date.now();
    }
    const currentBest = state.lastResponseSnapshot || responseText || state.lastKnownResponse || "";
    const responseChanged = currentBest && currentBest !== state.baselineResponse;
    const aiStudioPage = isAiStudioPromptPage();
    if (aiStudioPage) {
      const stopButton = findAiStudioStopButton();
      if (stopButton) {
        state.aiStudioSawStopButton = true;
      }
      state.generationActive = Boolean(stopButton);
    } else {
      state.generationActive = isGeneratingNow();
    }
    const idleFromDom = Date.now() - state.lastMutationAt;
    const idleFromText = Date.now() - state.lastResponseStableAt;
    if (!responseChanged) {
      return;
    }
    if (state.generationActive) {
      return;
    }
    const minDomIdle = aiStudioPage ? 1800 : 1500;
    const minTextIdle = aiStudioPage ? 2200 : 1500;
    if (idleFromDom < minDomIdle || idleFromText < minTextIdle) {
      return;
    }
    if (aiStudioPage) {
      const runButtonVisible = Boolean(findAiStudioRunButton());
      if (!runButtonVisible && !state.aiStudioSawStopButton && idleFromDom < 3200) {
        return;
      }
    }
    state.pendingResponse = false;
    const finalResponseText = currentBest;
    const responseStats = estimateStats(finalResponseText);
    const promptStats = state.lastPromptStats || estimateStats("");
    const minResponseLength = aiStudioPage ? 6 : 20;
    if (!finalResponseText || finalResponseText.length < minResponseLength) {
      return;
    }
    state.lastKnownResponse = finalResponseText;
    state.lastCompletedResponse = finalResponseText;
    state.aiStudioPassiveResponse = finalResponseText;
    state.lastCompletionAt = Date.now();
    state.aiStudioLastIntentAt = 0;
    state.aiStudioIntentDraft = "";
    state.aiStudioIntentBaselineResponse = finalResponseText;
    if (finalResponseText === state.lastAlertedResponse) {
      logDebug("completion-detected-duplicate-response", {
        responseLength: finalResponseText.length
      });
      return;
    }
    state.lastAlertedResponse = finalResponseText;
    logDebug("completion-detected", {
      aiStudioPage,
      responseLength: finalResponseText.length,
      idleFromDom,
      idleFromText,
      runButtonVisible: aiStudioPage ? Boolean(findAiStudioRunButton()) : null,
      sawStopButton: state.aiStudioSawStopButton
    });
    if (state.soundAlertEnabled) {
      playAlertBurst();
    }
    showToast(`Response finished. Prompt ~${promptStats.estimatedTokens} tok, response ~${responseStats.estimatedTokens} tok.`, "#53d7ac");
  }, 1000);

  window.setInterval(() => {
    if (state.floatingPanelEnabled) {
      mountWidget();
    }
  }, 2500);

  installSpaHooks();
  syncSettingsFromStorage().catch(() => {
  });
  state.aiStudioPassiveResponse = isAiStudioPromptPage() ? getLatestResponseText() : "";
  logDebug("content-script-initialized", {
    site: getSiteLabel(),
    aiStudioPromptPage: isAiStudioPromptPage()
  });
})();
