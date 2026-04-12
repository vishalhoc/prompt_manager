const DEFAULT_BRIDGE_URL = "http://127.0.0.1:32123";
const STORAGE_DEFAULTS = {
  pmBridgeUrl: DEFAULT_BRIDGE_URL,
  pmSoundAlertEnabled: true,
  pmRefreshBeforePaste: true,
  pmGitBeforePaste: true,
  pmAutoSendAfterPaste: false,
  pmFloatingPanelEnabled: true
};

const els = {
  statusText: document.getElementById("statusText"),
  siteText: document.getElementById("siteText"),
  pageStateText: document.getElementById("pageStateText"),
  draftStatsText: document.getElementById("draftStatsText"),
  responseStatsText: document.getElementById("responseStatsText"),
  promptStatsText: document.getElementById("promptStatsText"),
  bridgeText: document.getElementById("bridgeText"),
  promptSearchInput: document.getElementById("promptSearchInput"),
  promptSelect: document.getElementById("promptSelect"),
  saveDraftBtn: document.getElementById("saveDraftBtn"),
  saveResponseBtn: document.getElementById("saveResponseBtn"),
  pastePromptBtn: document.getElementById("pastePromptBtn"),
  pasteSendPromptBtn: document.getElementById("pasteSendPromptBtn"),
  refreshPromptsBtn: document.getElementById("refreshPromptsBtn"),
  refreshPageBtn: document.getElementById("refreshPageBtn"),
  testSoundBtn: document.getElementById("testSoundBtn"),
  soundAlertToggle: document.getElementById("soundAlertToggle"),
  refreshBeforePasteToggle: document.getElementById("refreshBeforePasteToggle"),
  gitBeforePasteToggle: document.getElementById("gitBeforePasteToggle"),
  autoSendToggle: document.getElementById("autoSendToggle"),
  floatingPanelToggle: document.getElementById("floatingPanelToggle"),
  bridgeUrlInput: document.getElementById("bridgeUrlInput"),
  aiStudioToolsPanel: document.getElementById("aiStudioToolsPanel"),
  aiStudioStateText: document.getElementById("aiStudioStateText"),
  focusPromptBtn: document.getElementById("focusPromptBtn"),
  runSettingsBtn: document.getElementById("runSettingsBtn"),
  toggleStreamBtn: document.getElementById("toggleStreamBtn")
};

let activeTabId = null;
let currentPageInfo = null;
let savedPrompts = [];
let filteredPrompts = [];
let bridgeUrl = DEFAULT_BRIDGE_URL;
let extensionSettings = { ...STORAGE_DEFAULTS };

function estimateStats(text) {
  const value = String(text || "");
  return {
    characters: value.length,
    words: value.trim() ? value.trim().split(/\s+/).length : 0,
    estimatedTokens: Math.max(1, Math.ceil(value.length / 4))
  };
}

function formatStats(stats) {
  return `${stats.characters.toLocaleString()} chars • ${stats.words.toLocaleString()} words • ${stats.estimatedTokens.toLocaleString()} est. tokens`;
}

async function bridgeFetch(path, options = {}) {
  const response = await fetch(`${bridgeUrl}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Bridge request failed (${response.status})`);
  }
  return response.status === 204 ? {} : response.json();
}

async function debugLog(event, details = {}, level = "info") {
  try {
    await bridgeFetch("/debug/log", {
      method: "POST",
      body: JSON.stringify({
        source: "popup",
        level,
        event,
        site: currentPageInfo?.site || "",
        url: currentPageInfo?.url || "",
        details
      })
    });
  } catch {
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id || null;
  return tab;
}

async function sendToContent(action, payload = {}) {
  if (!activeTabId) {
    throw new Error("No active tab found.");
  }
  return chrome.tabs.sendMessage(activeTabId, { action, ...payload });
}

function updateBridgeStatusText(message) {
  els.bridgeText.textContent = message;
}

async function refreshBridgeStatus() {
  try {
    await bridgeFetch("/health");
    updateBridgeStatusText(`Bridge: connected at ${bridgeUrl}`);
    return true;
  } catch (error) {
    updateBridgeStatusText(`Bridge: ${error.message}`);
    return false;
  }
}

async function syncContentSettings() {
  if (!activeTabId) {
    return;
  }
  try {
    await sendToContent("pm:update-settings", {
      soundAlertEnabled: extensionSettings.pmSoundAlertEnabled,
      floatingPanelEnabled: extensionSettings.pmFloatingPanelEnabled
    });
  } catch {
  }
}

async function refreshPageStatus() {
  try {
    const tab = await getActiveTab();
    if (!tab?.url) {
      throw new Error("No active page available.");
    }
    currentPageInfo = await sendToContent("pm:get-status");
    els.statusText.textContent = currentPageInfo?.supported
      ? `Connected to ${currentPageInfo.site}.`
      : "Current tab is not a supported ChatGPT, Codex, Claude, Gemini, or AI Studio page.";
    els.siteText.textContent = currentPageInfo?.supported
      ? `${currentPageInfo.site} • ${tab.title || "Untitled page"}`
      : tab.url;
    if (els.pageStateText) {
      els.pageStateText.textContent = currentPageInfo?.supported
        ? currentPageInfo?.pendingResponse
          ? "AI response is still in progress."
          : "Ready. No active response detected right now."
        : "Open a supported AI page in the current tab.";
    }
    els.draftStatsText.textContent = currentPageInfo?.draft
      ? `Current draft: ${formatStats(currentPageInfo.stats)}`
      : "No typed prompt detected in the current page.";
    els.responseStatsText.textContent = currentPageInfo?.latestResponse
      ? `Latest response: ${formatStats(currentPageInfo.responseStats)}`
      : "Latest response usage will appear here.";
    const aiStudioPromptPage = currentPageInfo?.site === "Google AI Studio";
    els.aiStudioToolsPanel.hidden = !aiStudioPromptPage;
    if (aiStudioPromptPage) {
      els.aiStudioStateText.textContent = currentPageInfo?.isAiStudioPromptPage
        ? `AI Studio prompt page detected.${currentPageInfo?.pendingResponse ? " Waiting for a response right now." : ""}`
        : "Google AI Studio detected. Open a prompt page to use the helper actions.";
    }
    await syncContentSettings();
  } catch (error) {
    currentPageInfo = null;
    els.statusText.textContent = `Page check failed: ${error.message}`;
    els.siteText.textContent = "Open ChatGPT, Claude, Gemini, or AI Studio in the current tab first.";
    if (els.pageStateText) {
      els.pageStateText.textContent = "Current page state is unavailable.";
    }
    els.draftStatsText.textContent = "Draft usage will appear here.";
    els.responseStatsText.textContent = "Latest response usage will appear here.";
    els.aiStudioToolsPanel.hidden = true;
  }
}

async function runPageAction(action, successMessage, fallbackMessage) {
  try {
    const result = await sendToContent(action);
    if (result?.ok === false) {
      throw new Error(result.error || fallbackMessage);
    }
    els.statusText.textContent = successMessage;
    await refreshPageStatus();
  } catch (error) {
    els.statusText.textContent = `${fallbackMessage}: ${error.message}`;
  }
}

async function testAlertSound() {
  try {
    await debugLog("popup-test-alert-start");
    try {
      await bridgeFetch("/alert", {
        method: "POST",
        body: JSON.stringify({
          source: "popup",
          site: currentPageInfo?.site || "",
          url: currentPageInfo?.url || "",
          title: currentPageInfo?.pageTitle || ""
        })
      });
      await debugLog("popup-native-alert-ok");
    } catch {
      await debugLog("popup-native-alert-failed");
    }
    await chrome.runtime.sendMessage({ action: "pm:play-alert-sound" });
    await debugLog("popup-runtime-alert-ok");
    try {
      if (activeTabId) {
        await sendToContent("pm:test-alert");
        await debugLog("popup-content-test-alert-ok");
      }
    } catch {
      await debugLog("popup-content-test-alert-failed");
    }
    els.statusText.textContent = "Played the alert sound test.";
  } catch (error) {
    await debugLog("popup-test-alert-error", { error: error.message }, "error");
    els.statusText.textContent = `Sound test failed: ${error.message}`;
  }
}

async function refreshPrompts() {
  try {
    const payload = await bridgeFetch("/prompts");
    savedPrompts = payload.prompts || [];
    renderPromptOptions();
  } catch (error) {
    savedPrompts = [];
    filteredPrompts = [];
    els.promptSelect.innerHTML = `<option value="">Bridge unavailable</option>`;
    els.promptStatsText.textContent = error.message;
  }
}

function renderPromptOptions() {
  const query = String(els.promptSearchInput?.value || "").trim().toLowerCase();
  filteredPrompts = savedPrompts.filter((prompt) => {
    if (!query) {
      return true;
    }
    return `${prompt.name} ${prompt.notes || ""} ${(prompt.tags || []).join(" ")}`.toLowerCase().includes(query);
  });
  const currentValue = els.promptSelect.value;
  els.promptSelect.innerHTML = `<option value="">Choose a saved prompt</option>`;
  filteredPrompts.forEach((prompt) => {
    els.promptSelect.add(new Option(prompt.name, prompt.id));
  });
  if ([...els.promptSelect.options].some((option) => option.value === currentValue)) {
    els.promptSelect.value = currentValue;
  }
  if (!filteredPrompts.length) {
    els.promptStatsText.textContent = query
      ? `No saved prompts match "${query}".`
      : "No saved prompts were found.";
    return;
  }
  updateSelectedPromptStats();
}

function updateSelectedPromptStats() {
  const prompt = savedPrompts.find((entry) => entry.id === els.promptSelect.value);
  if (!prompt) {
    els.promptStatsText.textContent = `${filteredPrompts.length.toLocaleString()} saved prompt${filteredPrompts.length === 1 ? "" : "s"} ready to paste.`;
    return;
  }
  const tags = (prompt.tags || []).length ? ` • ${prompt.tags.join(", ")}` : "";
  els.promptStatsText.textContent = `${new Date(prompt.updatedAt).toLocaleString()}${tags}`;
}

async function saveCapture(kind) {
  try {
    const action = kind === "response" ? "pm:capture-response" : "pm:capture-draft";
    const page = await sendToContent(action);
    let text = kind === "response" ? page?.response : page?.draft;
    if (kind === "response" && !text) {
      const fallback = await sendToContent("pm:get-status");
      text = fallback?.latestResponse || "";
    }
    if (!text) {
      throw new Error(`No ${kind === "response" ? "response" : "typed prompt"} found in the current page.`);
    }
    const payload = {
      title: `${page.pageTitle || page.site} ${kind}`,
      pageTitle: page.pageTitle,
      sourceUrl: page.url,
      site: page.site,
      text
    };
    await bridgeFetch("/captures", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    els.statusText.textContent = kind === "response"
      ? "Latest AI response saved to Prompt Manager."
      : "Current typed prompt saved to Prompt Manager.";
    await refreshPageStatus();
  } catch (error) {
    els.statusText.textContent = `Save failed: ${error.message}`;
  }
}

async function getSelectedPromptPayload() {
  const promptId = els.promptSelect.value;
  if (!promptId) {
    throw new Error("Choose a saved prompt first.");
  }

  const query = new URLSearchParams();
  if (extensionSettings.pmRefreshBeforePaste) {
    query.set("refresh", "1");
  }
  if (extensionSettings.pmGitBeforePaste) {
    query.set("git", "1");
    query.set("refresh", "1");
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return bridgeFetch(`/prompts/${encodeURIComponent(promptId)}${suffix}`);
}

async function pasteSelectedPrompt(sendAfterPaste) {
  try {
    const payload = await getSelectedPromptPayload();
    const result = await sendToContent(sendAfterPaste ? "pm:paste-and-send" : "pm:paste-text", { text: payload.prompt });
    if (result?.ok === false) {
      throw new Error(result.error || "Could not paste into the current page.");
    }
    const gitSummary = (payload.gitResults || []).length
      ? ` Git refreshed ${payload.gitResults.length} repo${payload.gitResults.length === 1 ? "" : "s"} first.`
      : "";
    els.statusText.textContent = `${sendAfterPaste ? "Pasted and sent" : "Pasted"} "${payload.name}".${gitSummary}`;
    els.promptStatsText.textContent = `Selected prompt: ${formatStats(payload.stats)}`;
  } catch (error) {
    els.statusText.textContent = `${sendAfterPaste ? "Paste + send" : "Paste"} failed: ${error.message}`;
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_DEFAULTS);
  extensionSettings = { ...STORAGE_DEFAULTS, ...stored };
  bridgeUrl = (extensionSettings.pmBridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
  els.bridgeUrlInput.value = bridgeUrl;
  els.soundAlertToggle.checked = extensionSettings.pmSoundAlertEnabled;
  els.refreshBeforePasteToggle.checked = extensionSettings.pmRefreshBeforePaste;
  els.gitBeforePasteToggle.checked = extensionSettings.pmGitBeforePaste;
  els.autoSendToggle.checked = extensionSettings.pmAutoSendAfterPaste;
  els.floatingPanelToggle.checked = extensionSettings.pmFloatingPanelEnabled;
}

async function persistSetting(key, value) {
  extensionSettings[key] = value;
  await chrome.storage.sync.set({ [key]: value });
  await syncContentSettings();
}

function bindEvents() {
  els.refreshPageBtn.onclick = refreshPageStatus;
  els.refreshPromptsBtn.onclick = refreshPrompts;
  els.saveDraftBtn.onclick = () => saveCapture("draft");
  els.saveResponseBtn.onclick = () => saveCapture("response");
  els.testSoundBtn.onclick = testAlertSound;
  els.focusPromptBtn.onclick = () => runPageAction("pm:focus-input", "Focused the current prompt input.", "Focus prompt failed");
  els.runSettingsBtn.onclick = () => runPageAction("pm:aistudio-run-settings", "Toggled AI Studio Run settings.", "Run settings action failed");
  els.toggleStreamBtn.onclick = () => runPageAction("pm:aistudio-toggle-stream", "Toggled the AI Studio Stream control.", "Toggle Stream failed");
  els.pastePromptBtn.onclick = async () => {
    await pasteSelectedPrompt(extensionSettings.pmAutoSendAfterPaste);
  };
  els.pasteSendPromptBtn.onclick = async () => {
    await pasteSelectedPrompt(true);
  };
  els.promptSelect.onchange = updateSelectedPromptStats;
  els.promptSearchInput.oninput = renderPromptOptions;

  els.soundAlertToggle.onchange = () => persistSetting("pmSoundAlertEnabled", els.soundAlertToggle.checked);
  els.refreshBeforePasteToggle.onchange = () => persistSetting("pmRefreshBeforePaste", els.refreshBeforePasteToggle.checked);
  els.gitBeforePasteToggle.onchange = async () => {
    if (els.gitBeforePasteToggle.checked && !els.refreshBeforePasteToggle.checked) {
      els.refreshBeforePasteToggle.checked = true;
      await persistSetting("pmRefreshBeforePaste", true);
    }
    await persistSetting("pmGitBeforePaste", els.gitBeforePasteToggle.checked);
  };
  els.autoSendToggle.onchange = async () => {
    await persistSetting("pmAutoSendAfterPaste", els.autoSendToggle.checked);
    els.pastePromptBtn.textContent = els.autoSendToggle.checked ? "Quick Action: Paste + Send" : "Quick Action: Paste";
  };
  els.floatingPanelToggle.onchange = () => persistSetting("pmFloatingPanelEnabled", els.floatingPanelToggle.checked);
  els.bridgeUrlInput.onchange = async () => {
    bridgeUrl = (els.bridgeUrlInput.value.trim() || DEFAULT_BRIDGE_URL).replace(/\/+$/, "");
    await persistSetting("pmBridgeUrl", bridgeUrl);
    await refreshBridgeStatus();
    await refreshPrompts();
  };
}

(async function init() {
  bindEvents();
  await loadSettings();
  await refreshBridgeStatus();
  await refreshPageStatus();
  await refreshPrompts();
  els.pastePromptBtn.textContent = extensionSettings.pmAutoSendAfterPaste ? "Quick Action: Paste + Send" : "Quick Action: Paste";
})();
