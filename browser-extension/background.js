const OFFSCREEN_URL = "offscreen.html";
const ALERT_NOTIFICATION_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230f172a'/%3E%3Cpath d='M18 20h28v6H24v12h18v6H24v10h-6z' fill='%2353d7ac'/%3E%3Ccircle cx='46' cy='46' r='8' fill='%23facc15'/%3E%3C/svg%3E";

async function debugLog(event, details = {}, level = "info") {
  try {
    const stored = await chrome.storage.sync.get({ pmBridgeUrl: "http://127.0.0.1:32123" });
    await fetch(`${String(stored.pmBridgeUrl || "http://127.0.0.1:32123").replace(/\/+$/, "")}/debug/log`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        source: "background",
        level,
        event,
        details
      })
    });
  } catch {
  }
}

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (contexts.length) {
    return;
  }
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Play completion sounds for Prompt Manager browser integration."
  });
  await debugLog("offscreen-document-created");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action === "pm:debug-log") {
    debugLog(message.event || "runtime-log", message.details || {}, message.level || "info");
    sendResponse({ ok: true });
    return true;
  }
  if (message?.action === "pm:play-alert-sound") {
    debugLog("background-play-alert-requested");
    ensureOffscreenDocument()
      .then(() => chrome.runtime.sendMessage({ action: "pm:offscreen-play-alert" }))
      .then(async () => {
        if (!chrome.notifications?.create) {
          await debugLog("background-notifications-api-missing");
          return;
        }
        try {
          await chrome.notifications.create(`pm-alert-${Date.now()}`, {
            type: "basic",
            iconUrl: ALERT_NOTIFICATION_ICON,
            title: "Prompt Manager",
            message: "AI response finished.",
            priority: 2
          });
          await debugLog("background-notification-created");
        } catch (error) {
          await debugLog("background-notification-skipped", { error: error.message }, "error");
        }
      })
      .then(() => {
        debugLog("background-play-alert-finished");
        sendResponse({ ok: true });
      })
      .catch((error) => {
        debugLog("background-play-alert-failed", { error: error.message }, "error");
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
  return false;
});
