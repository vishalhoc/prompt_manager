const BUILTIN_TEMPLATES = [
  ["builtin-debug", "Debug analysis", "You are a senior software engineer.\nAnalyze the provided code and identify likely bugs, broken flows, and risky edge cases.\nExplain the issue clearly, point to the related files, and suggest the smallest safe fix."],
  ["builtin-review", "Code review", "You are reviewing this code like a strict but helpful senior engineer.\nFocus on bugs, regressions, fragile logic, and missing validation.\nList concrete findings first, then suggest improvements."],
  ["builtin-refactor", "Refactor plan", "You are a senior engineer helping me refactor this project.\nRecommend cleaner structure, smaller modules, and better naming without changing behavior unless clearly needed.\nShow practical refactoring steps and a safe order to make them."],
  ["builtin-architecture", "Architecture analysis", "You are a software architect.\nReview the provided system structure and explain design strengths, risks, scaling limits, and maintainability concerns.\nSuggest an improved architecture in a practical way."],
  ["builtin-feature", "Feature build", "You are a senior product engineer.\nUse the provided code to design and implement the requested feature in the smallest coherent way.\nCall out dependencies, affected files, and edge cases before proposing changes."],
  ["builtin-bugfix", "Bug fix walkthrough", "You are a debugging specialist.\nRead the instructions and code carefully, infer the root cause, and explain the exact fix.\nPrefer focused code changes, mention regression risks, and include validation steps."],
  ["builtin-security", "Security review", "You are a security-focused senior engineer.\nReview the code for authentication flaws, injection risks, secrets exposure, insecure storage, unsafe networking, and privilege issues.\nRank findings by severity and recommend practical remediations."],
  ["builtin-performance", "Performance optimization", "You are a performance engineer.\nInspect the code and identify slow paths, unnecessary work, rendering bottlenecks, blocking I/O, and wasteful queries.\nSuggest improvements with likely impact and implementation cost."],
  ["builtin-testing", "Testing strategy", "You are a senior engineer helping me improve test coverage.\nIdentify the most important scenarios, weak areas, and regressions that need automated tests.\nSuggest practical unit, integration, and end-to-end tests based on the code provided."],
  ["builtin-docs", "Documentation writer", "You are a technical writer with strong engineering understanding.\nExplain the codebase, flows, APIs, and setup steps in clear documentation.\nWrite concise, useful documentation that a teammate can act on immediately."]
].map(([id, label, content]) => ({ id, label, content }));

const KEYS = ["backend", "website", "android"];
const state = {
  currentPromptId: null,
  createdAt: null,
  prompts: [],
  settings: { exportDir: "", autoRefreshPreview: true, autoPullBeforeBuild: false, theme: "dark", sectionFileTypes: { backend: [], website: [], android: [] } },
  meta: { availableFileTypes: [], defaultSectionFileTypes: {}, builtInFileTypeSet: new Set(), browserBridgeUrl: "", browserExtensionPath: "" },
  library: { browserCaptures: [], templates: [], systemInstructions: [] },
  debugLogs: [],
  attachedSystemInstructionIds: [],
  collapsedNodes: Object.fromEntries(KEYS.map((k) => [k, []])),
  sections: Object.fromEntries(KEYS.map((k) => [k, { roots: [], excludedPaths: [], preview: null, gitLog: "No Git action yet." }]))
};

const id = (value) => document.getElementById(value);
const els = {
  appShell: id("appShell"), promptName: id("promptName"), promptTags: id("promptTags"), promptNotes: id("promptNotes"),
  instructionsEnabled: id("instructionsEnabled"), instructionsText: id("instructionsText"), templateSelect: id("templateSelect"),
  templateNameInput: id("templateNameInput"),
  saveTemplateBtn: id("saveTemplateBtn"), deleteTemplateBtn: id("deleteTemplateBtn"),
  systemInstructionsEnabled: id("systemInstructionsEnabled"), systemInstructionsText: id("systemInstructionsText"),
  systemInstructionNameInput: id("systemInstructionNameInput"),
  systemInstructionSelectMain: id("systemInstructionSelectMain"), saveSystemInstructionBtnMain: id("saveSystemInstructionBtnMain"),
  loadSystemInstructionBtn: id("loadSystemInstructionBtn"), attachSystemInstructionBtnMain: id("attachSystemInstructionBtnMain"),
  deleteSystemInstructionBtnMain: id("deleteSystemInstructionBtnMain"), attachedSystemInstructionsMain: id("attachedSystemInstructionsMain"),
  savedPromptList: id("savedPromptList"), browserCaptureList: id("browserCaptureList"), refreshBrowserCapturesBtn: id("refreshBrowserCapturesBtn"), searchInput: id("searchInput"),
  buildBtn: id("buildBtn"), refreshAllBtn: id("refreshAllBtn"), pullAllBtn: id("pullAllBtn"), copyBtn: id("copyBtn"),
  duplicateBtn: id("duplicateBtn"), saveBtn: id("saveBtn"), deleteBtn: id("deleteBtn"), newPromptBtn: id("newPromptBtn"), toggleSidebarBtn: id("toggleSidebarBtn"),
  themeToggleBtn: id("themeToggleBtn"), settingsBtn: id("settingsBtn"), closeSettingsBtn: id("closeSettingsBtn"),
  settingsModal: id("settingsModal"), chooseExportBtn: id("chooseExportBtn"), resetExportBtn: id("resetExportBtn"),
  chooseBackupBtn: id("chooseBackupBtn"), resetBackupBtn: id("resetBackupBtn"),
  autoRefreshToggle: id("autoRefreshToggle"), autoPullToggle: id("autoPullToggle"), backupNowBtn: id("backupNowBtn"),
  restoreBackupBtn: id("restoreBackupBtn"), backupStatusText: id("backupStatusText"), backupFolderText: id("backupFolderText"), storageText: id("storageText"),
  browserBridgeEnabled: id("browserBridgeEnabled"), browserBridgePort: id("browserBridgePort"), browserBridgeText: id("browserBridgeText"),
  browserExtensionPathText: id("browserExtensionPathText"), saveBrowserBridgeBtn: id("saveBrowserBridgeBtn"), openExtensionFolderBtn: id("openExtensionFolderBtn"),
  openDebugConsoleBtn: id("openDebugConsoleBtn"), debugModal: id("debugModal"), closeDebugModalBtn: id("closeDebugModalBtn"),
  refreshDebugLogsBtn: id("refreshDebugLogsBtn"), clearDebugLogsBtn: id("clearDebugLogsBtn"), copyDebugLogsBtn: id("copyDebugLogsBtn"),
  exportDebugLogsBtn: id("exportDebugLogsBtn"), testDebugAlertBtn: id("testDebugAlertBtn"), debugSummaryText: id("debugSummaryText"), debugLogConsole: id("debugLogConsole"),
  fileTypeSettings: id("fileTypeSettings"), promptPreview: id("promptPreview"), charCount: id("charCount"),
  wordCount: id("wordCount"), tokenCount: id("tokenCount"), statusBar: id("statusBar"),
  backendEnabled: id("backendEnabled"), websiteEnabled: id("websiteEnabled"), androidEnabled: id("androidEnabled")
};

const enabledEl = (k) => els[`${k}Enabled`];
const treeEl = (k) => id(`${k}Tree`);
const statsEl = (k) => id(`${k}Stats`);
const gitLabelEl = (k) => id(`${k}GitLabel`);
const sourcesEl = (k) => id(`${k}Sources`);
const gitLogEl = (k) => id(`${k}GitLog`);
const dropEl = (k) => id(`${k}DropZone`);

const setStatus = (m) => { els.statusBar.textContent = m; };
const section = (k) => state.sections[k];
const item = (type, path) => ({ id: `${type}:${path}`, type, path });
const normalizeExtension = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith(".") ? raw : `.${raw}`;
};
const isValidExtension = (value) => /^\.[a-z0-9][a-z0-9._-]*$/i.test(value);
const config = () => ({
  instructions: { enabled: els.instructionsEnabled.checked, text: els.instructionsText.value },
  systemInstructions: { enabled: els.systemInstructionsEnabled.checked, text: els.systemInstructionsText.value, attachedIds: state.attachedSystemInstructionIds },
  backend: { enabled: els.backendEnabled.checked, roots: state.sections.backend.roots, excludedPaths: state.sections.backend.excludedPaths },
  website: { enabled: els.websiteEnabled.checked, roots: state.sections.website.roots, excludedPaths: state.sections.website.excludedPaths },
  android: { enabled: els.androidEnabled.checked, roots: state.sections.android.roots, excludedPaths: state.sections.android.excludedPaths }
});

function applyTheme() {
  document.body.setAttribute("data-theme", state.settings.theme === "light" ? "light" : "dark");
  els.themeToggleBtn.textContent = state.settings.theme === "light" ? "Dark Theme" : "Light Theme";
}

function renderStorage() {
  els.storageText.textContent = `Current export folder: ${state.settings.exportDir || "Not set"}`;
  if (els.backupFolderText) {
    els.backupFolderText.textContent = `Current backup folder: ${state.settings.backupDir || "Not set"}`;
  }
  els.autoRefreshToggle.checked = state.settings.autoRefreshPreview !== false;
  els.autoPullToggle.checked = !!state.settings.autoPullBeforeBuild;
  if (els.browserBridgeEnabled) {
    els.browserBridgeEnabled.checked = state.settings.browserBridge?.enabled !== false;
  }
  if (els.browserBridgePort) {
    els.browserBridgePort.value = state.settings.browserBridge?.port || "";
  }
  if (els.browserBridgeText) {
    els.browserBridgeText.textContent = `Local bridge URL: ${state.meta.browserBridgeUrl || "Not available"}`;
  }
  if (els.browserExtensionPathText) {
    els.browserExtensionPathText.textContent = `Extension folder: ${state.meta.browserExtensionPath || "Not available"}`;
  }
}

function formatDebugValue(value) {
  if (value == null || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function appendDebugLogEntry(entry, options = {}) {
  if (!entry?.id) {
    return;
  }
  if (state.debugLogs.some((item) => item.id === entry.id)) {
    return;
  }
  if (options.toFront !== false) {
    state.debugLogs.unshift(entry);
  } else {
    state.debugLogs.push(entry);
  }
  state.debugLogs = state.debugLogs.slice(0, 600);
}

function renderDebugConsole() {
  if (!els.debugLogConsole) {
    return;
  }
  if (!state.debugLogs.length) {
    els.debugLogConsole.textContent = "No debug logs yet.";
    if (els.debugSummaryText) {
      els.debugSummaryText.value = "No debug events yet";
    }
    return;
  }
  const lines = state.debugLogs
    .slice()
    .reverse()
    .map((entry) => {
      const header = `[${new Date(entry.timestamp || Date.now()).toLocaleString()}] ${String(entry.level || "info").toUpperCase()} ${entry.source || "extension"} :: ${entry.event || "log"}`;
      const siteLine = [entry.site, entry.url].filter(Boolean).join(" | ");
      const messageLine = entry.message || "";
      const detailText = formatDebugValue(entry.details);
      return [header, siteLine, messageLine, detailText].filter(Boolean).join("\n");
    });
  els.debugLogConsole.textContent = lines.join("\n\n--------------------------------------------------\n\n");
  const latest = state.debugLogs[0];
  if (els.debugSummaryText) {
    els.debugSummaryText.value = latest
      ? `${latest.source || "extension"} • ${latest.event || "log"} • ${new Date(latest.timestamp || Date.now()).toLocaleTimeString()}`
      : "No debug events yet";
  }
}

async function refreshDebugLogs() {
  state.debugLogs = await window.promptManagerApi.listExtensionDebugLogs();
  renderDebugConsole();
}

async function refreshBackupStatus() {
  const backup = await window.promptManagerApi.getBackupStatus();
  els.backupStatusText.textContent = backup.exists ? `Backup file: ${backup.backupPath}` : `No backup file found yet. Expected path: ${backup.backupPath}`;
}

function renderSources(k) {
  const box = sourcesEl(k), s = section(k);
  box.innerHTML = "";
  if (!s.roots.length) { box.innerHTML = `<p class="muted">No folders or files selected.</p>`; return; }
  s.roots.forEach((root) => {
    const chip = document.createElement("div");
    chip.className = "source-chip";
    chip.innerHTML = `<div class="meta"><span class="chip-type">${root.type}</span><strong>${root.path.split(/[\\/]/).pop() || root.path}</strong><p>${root.path}</p></div>`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "chip-remove";
    removeBtn.textContent = "x";
    removeBtn.onclick = async () => { removeRoot(k, root.id); await autoRefreshAfterChange(); };
    chip.appendChild(removeBtn);
    box.appendChild(chip);
  });
}

function addItems(k, items) {
  const s = section(k);
  const seen = new Set(s.roots.map((root) => `${root.type}:${root.path.toLowerCase()}`));
  items.forEach((entry) => {
    const key = `${entry.type}:${entry.path.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      s.roots.push(entry);
    }
  });
  renderSources(k);
  renderSectionMeta(k);
}

function clearSection(k) {
  state.sections[k] = { roots: [], excludedPaths: [], preview: null, gitLog: "No Git action yet." };
  state.collapsedNodes[k] = [];
  renderSources(k);
  renderSectionTree(k);
  renderSectionMeta(k);
}

function renderSectionMeta(k) {
  const s = section(k), p = s.preview;
  statsEl(k).textContent = p ? `${p.fileCount} included files / ${p.folderCount} folders` : (s.roots.length ? `${s.roots.length} source root${s.roots.length === 1 ? "" : "s"} selected` : "No sources selected");
  gitLabelEl(k).textContent = p ? (p.gitRepos.length ? `${p.gitRepos.length} Git repo${p.gitRepos.length === 1 ? "" : "s"} detected` : "No Git repo detected") : "";
  gitLogEl(k).textContent = s.gitLog || "No Git action yet.";
}

function treeNode(k, node, depth = 0) {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = `tree-row${node.included ? "" : " excluded"}`;
  row.style.marginLeft = `${depth * 12}px`;
  const isRoot = section(k).roots.some((root) => root.path.toLowerCase() === node.path.toLowerCase());
  const collapsed = state.collapsedNodes[k].includes(node.path);
  row.innerHTML = `<div class="tree-title">${node.children?.length ? `<button type="button" class="tree-toggle">${collapsed ? "+" : "-"}</button>` : `<span class="tree-toggle placeholder">.</span>`}<span class="tree-badge">${isRoot ? "root" : node.type}</span><div class="tree-text"><strong>${node.name}</strong><p>${node.path}</p></div></div>`;
  const btn = document.createElement("button");
  btn.className = "tree-action";
  btn.textContent = node.included ? "Exclude" : "Include";
  btn.onclick = async () => { toggleExcluded(k, node.path); await refreshPreview(); };
  row.appendChild(btn);
  wrap.appendChild(row);
  if (node.children?.length) {
    const children = document.createElement("div");
    children.className = `tree-children${collapsed ? " collapsed" : ""}`;
    node.children.forEach((child) => children.appendChild(treeNode(k, child, depth + 1)));
    wrap.appendChild(children);
    row.querySelector(".tree-toggle").onclick = () => {
      const list = state.collapsedNodes[k];
      const index = list.indexOf(node.path);
      if (index >= 0) list.splice(index, 1);
      else list.push(node.path);
      renderSectionTree(k);
    };
  }
  return wrap;
}

function renderSectionTree(k) {
  const box = treeEl(k), s = section(k);
  box.innerHTML = "";
  if (!s.roots.length) { box.innerHTML = `<p class="tree-empty">Add a folder, subfolder, files, or a GitHub link to start building this section.</p>`; return; }
  if (!s.preview?.treeRoots?.length) { box.innerHTML = `<p class="tree-empty">Refresh preview to inspect folders and exclude individual files or subfolders.</p>`; return; }
  s.preview.treeRoots.forEach((node) => box.appendChild(treeNode(k, node)));
}

function collectFolderPaths(nodes = [], bucket = []) {
  nodes.forEach((node) => {
    if (node.type === "folder") {
      bucket.push(node.path);
    }
    collectFolderPaths(node.children || [], bucket);
  });
  return bucket;
}

function renderTemplateSelect() {
  const current = els.templateSelect.value;
  els.templateSelect.innerHTML = `<option value="">Choose template</option>`;
  BUILTIN_TEMPLATES.forEach((t) => els.templateSelect.add(new Option(t.label, `builtin:${t.id}`)));
  state.library.templates.forEach((t) => els.templateSelect.add(new Option(`${t.name} (Saved)`, `saved:${t.id}`)));
  if ([...els.templateSelect.options].some((o) => o.value === current)) els.templateSelect.value = current;
}

function renderSystemInstructionLibrary() {
  const current = els.systemInstructionSelectMain.value;
  els.systemInstructionSelectMain.innerHTML = `<option value="">Choose saved system instruction</option>`;
  state.library.systemInstructions.forEach((t) => els.systemInstructionSelectMain.add(new Option(t.name, t.id)));
  if ([...els.systemInstructionSelectMain.options].some((o) => o.value === current)) els.systemInstructionSelectMain.value = current;

  const renderAttached = (box) => {
    box.innerHTML = "";
    if (!state.attachedSystemInstructionIds.length) {
      box.innerHTML = `<p class="muted">No saved system instruction attached to this prompt.</p>`;
      return;
    }
    state.attachedSystemInstructionIds.forEach((idValue) => {
      const saved = state.library.systemInstructions.find((entry) => entry.id === idValue);
      if (!saved) return;
      const chip = document.createElement("div");
      chip.className = "source-chip";
      chip.innerHTML = `<div class="meta"><span class="chip-type">system</span><strong>${saved.name}</strong><p>${saved.content.slice(0, 120)}${saved.content.length > 120 ? "..." : ""}</p></div>`;
      const removeBtn = document.createElement("button");
      removeBtn.className = "chip-remove";
      removeBtn.textContent = "x";
      removeBtn.onclick = async () => { state.attachedSystemInstructionIds = state.attachedSystemInstructionIds.filter((entry) => entry !== idValue); renderSystemInstructionLibrary(); await autoRefreshAfterChange(); };
      chip.appendChild(removeBtn);
      box.appendChild(chip);
    });
  };
  renderAttached(els.attachedSystemInstructionsMain);
}

function renderFileTypeSettings() {
  const box = els.fileTypeSettings;
  box.innerHTML = "";
  KEYS.forEach((k) => {
    const group = document.createElement("div");
    group.className = "file-type-group";
    group.innerHTML = `<h3>${k[0].toUpperCase()}${k.slice(1)} File Types</h3>`;
    const toolbar = document.createElement("div");
    toolbar.className = "file-type-toolbar";
    toolbar.innerHTML = `
      <button type="button" class="ghost-button" data-filetype-tool="all" data-filetype-section="${k}">Select All</button>
      <button type="button" class="ghost-button" data-filetype-tool="default" data-filetype-section="${k}">Use Defaults</button>
      <span class="muted small-text">Built-in and custom extensions both work here.</span>
    `;
    const grid = document.createElement("div");
    grid.className = "file-type-grid";
    const selected = new Set(state.settings.sectionFileTypes[k] || []);
    state.meta.availableFileTypes.forEach((ext) => {
      const label = document.createElement("label");
      label.className = "file-type-chip";
      label.innerHTML = `<input type="checkbox" data-filetype-section="${k}" value="${ext}" ${selected.has(ext) ? "checked" : ""} /><span>${ext}</span>`;
      grid.appendChild(label);
    });
    const customTypes = (state.settings.sectionFileTypes[k] || []).filter((ext) => !state.meta.builtInFileTypeSet.has(ext));
    const customRow = document.createElement("div");
    customRow.className = "custom-type-row";
    customRow.innerHTML = `
      <input type="text" class="inline-input" id="customExtInput-${k}" placeholder="Add custom extension like .jsx or .proto" />
      <button type="button" class="action-button" data-custom-ext-add="${k}">Add Extension</button>
    `;
    const customList = document.createElement("div");
    customList.className = "custom-type-list";
    customList.innerHTML = customTypes.length
      ? customTypes.map((ext) => `<span class="custom-type-chip">${ext}<button type="button" data-custom-ext-remove="${k}" data-extension="${ext}">x</button></span>`).join("")
      : `<p class="muted">No custom extensions added for ${k}.</p>`;
    group.appendChild(toolbar);
    group.appendChild(grid);
    group.appendChild(customRow);
    group.appendChild(customList);
    box.appendChild(group);
  });
  box.querySelectorAll("[data-filetype-section]").forEach((checkbox) => {
    checkbox.onchange = async (event) => {
      const k = event.target.dataset.filetypeSection;
      const next = { ...state.settings.sectionFileTypes };
      const current = new Set(next[k] || []);
      event.target.checked ? current.add(event.target.value) : current.delete(event.target.value);
      next[k] = Array.from(current).sort();
      state.settings = await window.promptManagerApi.updateSettings({ sectionFileTypes: next });
      renderStorage();
      renderFileTypeSettings();
      await autoRefreshAfterChange();
    };
  });
  box.querySelectorAll("[data-filetype-tool]").forEach((button) => {
    button.onclick = async () => {
      const k = button.dataset.filetypeSection;
      const next = { ...state.settings.sectionFileTypes };
      const customTypes = (next[k] || []).filter((ext) => !state.meta.builtInFileTypeSet.has(ext));
      if (button.dataset.filetypeTool === "all") {
        next[k] = Array.from(new Set([...state.meta.availableFileTypes, ...customTypes])).sort();
      } else {
        next[k] = Array.from(new Set([...(state.meta.defaultSectionFileTypes[k] || []), ...customTypes])).sort();
      }
      state.settings = await window.promptManagerApi.updateSettings({ sectionFileTypes: next });
      renderStorage();
      renderFileTypeSettings();
      await autoRefreshAfterChange();
    };
  });
  box.querySelectorAll("[data-custom-ext-add]").forEach((button) => {
    button.onclick = async () => {
      const k = button.dataset.customExtAdd;
      const input = id(`customExtInput-${k}`);
      const extension = normalizeExtension(input.value);
      if (!isValidExtension(extension)) {
        setStatus(`Use a valid extension like .jsx, .tsx, .proto, or .conf for ${k}.`);
        return;
      }
      const next = { ...state.settings.sectionFileTypes };
      next[k] = Array.from(new Set([...(next[k] || []), extension])).sort();
      state.settings = await window.promptManagerApi.updateSettings({ sectionFileTypes: next });
      input.value = "";
      renderStorage();
      renderFileTypeSettings();
      await autoRefreshAfterChange();
      setStatus(`Added ${extension} to ${k} file types.`);
    };
  });
  box.querySelectorAll("[data-custom-ext-remove]").forEach((button) => {
    button.onclick = async () => {
      const k = button.dataset.customExtRemove;
      const extension = button.dataset.extension;
      const next = { ...state.settings.sectionFileTypes };
      next[k] = (next[k] || []).filter((ext) => ext !== extension);
      state.settings = await window.promptManagerApi.updateSettings({ sectionFileTypes: next });
      renderStorage();
      renderFileTypeSettings();
      await autoRefreshAfterChange();
      setStatus(`Removed ${extension} from ${k} file types.`);
    };
  });
}

function applyPreview(preview) {
  KEYS.forEach((k) => {
    state.sections[k].preview = preview.sections[k] || null;
    renderSectionMeta(k);
    renderSectionTree(k);
  });
  els.promptPreview.value = preview.prompt || "";
  els.charCount.textContent = preview.stats.characters.toLocaleString();
  els.wordCount.textContent = preview.stats.words.toLocaleString();
  els.tokenCount.textContent = preview.stats.estimatedTokens.toLocaleString();
  const warnings = KEYS.flatMap((k) => (preview.sections[k]?.missingPaths || []).map((entry) => `Missing ${k} path: ${entry}`));
  setStatus(warnings.length ? warnings.join(" | ") : "Preview updated from the latest selected files.");
}

async function refreshPreview(options = {}) {
  if (!options.skipAutoPull && state.settings.autoPullBeforeBuild) await pullAllSections({ silentIfNoRepos: true });
  const preview = await window.promptManagerApi.previewPrompt(config());
  applyPreview(preview);
  return preview;
}

async function autoRefreshAfterChange() {
  if (state.settings.autoRefreshPreview) await refreshPreview({ skipAutoPull: true });
  else setStatus("Source changed. Build preview when you want to refresh the prompt.");
}

function promptCardMarkup(prompt) {
  const tags = (prompt.tags || []).join(", ");
  return `<strong>${prompt.name}</strong><p>${prompt.notes || "No notes yet."}</p><p class="muted">${tags || "No tags"} • ${new Date(prompt.updatedAt).toLocaleString()}</p>`;
}

function makeDuplicatePromptName(name) {
  const trimmed = String(name || "").trim() || "Untitled Prompt";
  return /\(copy(?: \d+)?\)$/i.test(trimmed) ? `${trimmed} copy` : `${trimmed} (Copy)`;
}

function renderPromptList() {
  const q = els.searchInput.value.trim().toLowerCase();
  els.savedPromptList.innerHTML = "";
  const prompts = state.prompts.filter((p) => !q || `${p.name} ${p.notes || ""} ${(p.tags || []).join(" ")}`.toLowerCase().includes(q));
  if (!prompts.length) { els.savedPromptList.innerHTML = `<p class="muted">No saved prompts match your search.</p>`; return; }
  prompts.forEach((prompt) => {
    const card = document.createElement("div");
    card.className = `saved-item${state.currentPromptId === prompt.id ? " active" : ""}`;
    card.innerHTML = `${promptCardMarkup(prompt)}<div class="compact-actions" style="margin-top:10px"><button type="button" class="action-button" data-load-id="${prompt.id}">Edit</button><button type="button" class="ghost-button" data-duplicate-id="${prompt.id}">Duplicate</button><button type="button" class="ghost-button danger" data-delete-id="${prompt.id}">Delete</button></div>`;
    card.querySelector("[data-load-id]").onclick = async () => {
      const loaded = await window.promptManagerApi.loadPrompt(prompt.id);
      fillFormFromPrompt(loaded.prompt, loaded.livePreview);
      setStatus(`Loaded "${loaded.prompt.name}" with the latest files from disk.`);
    };
    card.querySelector("[data-duplicate-id]").onclick = async () => {
      const loaded = await window.promptManagerApi.loadPrompt(prompt.id);
      fillFormFromPrompt(loaded.prompt, loaded.livePreview);
      state.currentPromptId = null;
      state.createdAt = null;
      els.promptName.value = makeDuplicatePromptName(loaded.prompt.name);
      renderPromptList();
      setStatus(`Prepared a duplicate of "${loaded.prompt.name}". Save it with the new name when ready.`);
    };
    card.querySelector("[data-delete-id]").onclick = async () => {
      const deleted = await window.promptManagerApi.deletePrompt(prompt.id);
      if (deleted.deleted) {
        if (state.currentPromptId === prompt.id) resetForm();
        await refreshPromptList();
        setStatus(`Deleted "${prompt.name}".`);
      }
    };
    els.savedPromptList.appendChild(card);
  });
}

function renderBrowserCaptures() {
  const box = els.browserCaptureList;
  box.innerHTML = "";
  if (!state.library.browserCaptures.length) {
    box.innerHTML = `<p class="muted">No browser captures yet. Use the Chrome extension on Gemini or AI Studio to save the current typed prompt.</p>`;
    return;
  }

  state.library.browserCaptures.forEach((capture) => {
    const card = document.createElement("div");
    card.className = "saved-item";
    const label = capture.site || "browser";
    const usage = capture.stats?.estimatedTokens ? `${capture.stats.estimatedTokens.toLocaleString()} est. tokens` : "No usage";
    card.innerHTML = `
      <strong>${capture.title || "Browser prompt"}</strong>
      <p>${capture.pageTitle || capture.sourceUrl || "Captured from browser"}</p>
      <p class="muted">${label} • ${usage} • ${new Date(capture.updatedAt).toLocaleString()}</p>
      <div class="compact-actions" style="margin-top:10px">
        <button type="button" class="action-button" data-capture-use="${capture.id}">Use In Instructions</button>
        <button type="button" class="ghost-button" data-capture-system="${capture.id}">Use In System</button>
        <button type="button" class="ghost-button" data-capture-copy="${capture.id}">Copy</button>
        <button type="button" class="ghost-button danger" data-capture-delete="${capture.id}">Delete</button>
      </div>
    `;
    card.querySelector("[data-capture-use]").onclick = async () => {
      els.instructionsEnabled.checked = true;
      els.instructionsText.value = capture.text;
      if (!els.promptName.value.trim()) {
        els.promptName.value = capture.title || "Browser prompt";
      }
      await autoRefreshAfterChange();
      setStatus(`Loaded browser capture "${capture.title}" into Instructions.`);
    };
    card.querySelector("[data-capture-copy]").onclick = async () => {
      await navigator.clipboard.writeText(capture.text || "");
      setStatus(`Copied browser capture "${capture.title}" to clipboard.`);
    };
    card.querySelector("[data-capture-system]").onclick = async () => {
      els.systemInstructionsEnabled.checked = true;
      els.systemInstructionsText.value = capture.text;
      els.systemInstructionNameInput.value = capture.title || "Browser capture";
      await autoRefreshAfterChange();
      setStatus(`Loaded browser capture "${capture.title}" into System Instructions.`);
    };
    card.querySelector("[data-capture-delete]").onclick = async () => {
      state.library.browserCaptures = await window.promptManagerApi.deleteBrowserCapture(capture.id);
      renderBrowserCaptures();
      setStatus(`Deleted browser capture "${capture.title}".`);
    };
    box.appendChild(card);
  });
}

function fillFormFromPrompt(prompt, preview) {
  state.currentPromptId = prompt.id;
  state.createdAt = prompt.createdAt;
  els.promptName.value = prompt.name;
  els.promptTags.value = (prompt.tags || []).join(", ");
  els.promptNotes.value = prompt.notes || "";
  els.instructionsEnabled.checked = !!prompt.config.instructions.enabled;
  els.instructionsText.value = prompt.config.instructions.text || "";
  els.systemInstructionsEnabled.checked = !!prompt.config.systemInstructions?.enabled;
  els.systemInstructionsText.value = prompt.config.systemInstructions?.text || "";
  state.attachedSystemInstructionIds = prompt.config.systemInstructions?.attachedIds || [];
  KEYS.forEach((k) => {
    enabledEl(k).checked = !!prompt.config[k].enabled;
    state.sections[k].roots = prompt.config[k].roots || [];
    state.sections[k].excludedPaths = prompt.config[k].excludedPaths || [];
    renderSources(k);
  });
  renderSystemInstructionLibrary();
  applyPreview(preview);
  renderPromptList();
}

function resetForm() {
  state.currentPromptId = null;
  state.createdAt = null;
  els.promptName.value = "";
  els.promptTags.value = "";
  els.promptNotes.value = "";
  els.instructionsEnabled.checked = true;
  els.instructionsText.value = "";
  els.systemInstructionsEnabled.checked = true;
  els.systemInstructionsText.value = "";
  KEYS.forEach((k) => {
    enabledEl(k).checked = true;
    state.sections[k] = { roots: [], excludedPaths: [], preview: null, gitLog: "No Git action yet." };
    state.collapsedNodes[k] = [];
    renderSources(k);
    renderSectionTree(k);
    renderSectionMeta(k);
  });
  state.attachedSystemInstructionIds = [];
  renderSystemInstructionLibrary();
  els.promptPreview.value = "";
  els.charCount.textContent = "0";
  els.wordCount.textContent = "0";
  els.tokenCount.textContent = "0";
  setStatus("Ready for a new prompt.");
  renderPromptList();
}

async function refreshPromptList() {
  state.prompts = await window.promptManagerApi.listPrompts();
  renderPromptList();
}

async function refreshLibraries() {
  state.library = await window.promptManagerApi.getLibrary();
  renderTemplateSelect();
  renderSystemInstructionLibrary();
  renderBrowserCaptures();
}

function removeRoot(k, rootId) {
  const s = section(k);
  const removed = s.roots.find((entry) => entry.id === rootId);
  s.roots = s.roots.filter((entry) => entry.id !== rootId);
  if (removed) {
    s.excludedPaths = s.excludedPaths.filter((entry) => {
      const lowerEntry = entry.toLowerCase();
      const lowerRoot = removed.path.toLowerCase();
      return lowerEntry !== lowerRoot && !lowerEntry.startsWith(`${lowerRoot}\\`);
    });
  }
  s.preview = null;
  renderSources(k);
  renderSectionTree(k);
}

function toggleExcluded(k, targetPath) {
  const s = section(k);
  const index = s.excludedPaths.findIndex((entry) => entry.toLowerCase() === targetPath.toLowerCase());
  if (index >= 0) s.excludedPaths.splice(index, 1);
  else s.excludedPaths.push(targetPath);
}

async function runGitPullForSection(k, options = {}) {
  if (!enabledEl(k).checked) return { repoCount: 0, results: [] };
  const s = section(k);
  if (!s.roots.length) {
    if (!options.silentIfNoRepos) {
      s.gitLog = "No sources selected, so there is nothing to pull.";
      renderSectionMeta(k);
      setStatus(`No ${k} sources selected for Git pull.`);
    }
    return { repoCount: 0, results: [] };
  }
  setStatus(`Running Git pull for ${k}...`);
  const result = await window.promptManagerApi.pullSection(k, { enabled: enabledEl(k).checked, roots: s.roots, excludedPaths: s.excludedPaths });
  if (!result.repoCount) {
    if (!options.silentIfNoRepos) {
      s.gitLog = "No Git repositories were detected from the selected roots.";
      renderSectionMeta(k);
      setStatus(`No Git repository found in ${k}.`);
    }
    return result;
  }
  s.preview = result.preview;
  s.gitLog = result.results.map((entry) => [`Repo: ${entry.repoPath}`, `Branch: ${entry.branch || "(unknown)"}`, `Status: ${entry.success ? "Success" : "Failed"}`, entry.output || entry.error || "No output"].join("\n")).join("\n\n--------------------\n\n");
  renderSectionMeta(k);
  renderSectionTree(k);
  setStatus(`Git pull finished for ${k}.`);
  return result;
}

async function pullAllSections(options = {}) {
  let repoCount = 0;
  for (const k of KEYS) {
    const result = await runGitPullForSection(k, { silentIfNoRepos: true });
    repoCount += result.repoCount || 0;
  }
  if (!repoCount && !options.silentIfNoRepos) setStatus("No Git repositories were detected in enabled sections.");
}

async function syncGitHubLink(k) {
  const repoUrl = window.prompt("Paste the GitHub repository URL:");
  if (!repoUrl) return;
  const directory = await window.promptManagerApi.pickDirectory("Choose empty folder or existing repo folder");
  if (!directory) return;
  setStatus(`Syncing ${repoUrl} into ${directory}...`);
  const result = await window.promptManagerApi.syncGitLink(repoUrl, directory);
  const s = section(k);
  s.gitLog = [`Repo: ${result.repoPath}`, `Branch: ${result.branch || "(unknown)"}`, `Status: ${result.success ? "Success" : "Failed"}`, result.output || result.error || "No output"].join("\n");
  renderSectionMeta(k);
  if (result.success) {
    addItems(k, [item("folder", directory)]);
    await autoRefreshAfterChange();
    setStatus(`GitHub repository synced into ${k}.`);
  } else {
    setStatus(`GitHub sync failed for ${k}.`);
  }
}

async function pickSources(k, action) {
  try {
    const preferred = section(k).roots[0]?.path;
    setStatus(`${action} started for ${k}...`);
    if (action === "files") {
      const files = await window.promptManagerApi.pickFiles();
      addItems(k, files.map((entry) => item("file", entry)));
    }
    if (action === "folder") {
      const folder = await window.promptManagerApi.pickDirectory("Select Folder", preferred);
      if (folder) addItems(k, [item("folder", folder)]);
    }
    if (action === "subfolder") {
      const folder = await window.promptManagerApi.pickDirectory("Select Subfolder", preferred);
      if (folder) addItems(k, [item("subfolder", folder)]);
    }
    if (action === "git-link") { await syncGitHubLink(k); return; }
    if (action === "clear") clearSection(k);
    if (action === "refresh") { await refreshPreview({ skipAutoPull: true }); return; }
    if (action === "git") { await runGitPullForSection(k); return; }
    await autoRefreshAfterChange();
  } catch (error) {
    setStatus(`Failed to ${action} for ${k}: ${error.message}`);
    const s = section(k);
    s.gitLog = `Action failed: ${error.message}`;
    renderSectionMeta(k);
  }
}

async function copyPrompt() {
  if (!els.promptPreview.value.trim()) await refreshPreview();
  await navigator.clipboard.writeText(els.promptPreview.value);
  setStatus("Prompt copied to clipboard.");
}

async function duplicateCurrentPrompt() {
  if (!els.promptName.value.trim() && !state.currentPromptId) {
    setStatus("Load or build a prompt first, then duplicate it.");
    return;
  }
  if (!els.promptPreview.value.trim()) {
    await refreshPreview({ skipAutoPull: true });
  }
  state.currentPromptId = null;
  state.createdAt = null;
  els.promptName.value = makeDuplicatePromptName(els.promptName.value);
  renderPromptList();
  setStatus("This prompt is now detached from the original. Save it as a new prompt when ready.");
}

async function savePrompt() {
  const name = els.promptName.value.trim();
  if (!name) { setStatus("Prompt name is required before saving."); return; }
  const payload = { id: state.currentPromptId, createdAt: state.createdAt, name, notes: els.promptNotes.value.trim(), tags: els.promptTags.value.split(",").map((t) => t.trim()).filter(Boolean), config: config() };
  const result = await window.promptManagerApi.savePrompt(payload);
  state.settings = result.settings || state.settings;
  renderStorage();
  fillFormFromPrompt(result.prompt, result.preview);
  await refreshPromptList();
  await refreshBackupStatus();
  setStatus(`Saved "${result.prompt.name}" and exported the latest prompt text.`);
}

async function deletePrompt() {
  if (!state.currentPromptId) { setStatus("Load a saved prompt first if you want to delete it."); return; }
  const deleted = await window.promptManagerApi.deletePrompt(state.currentPromptId);
  if (deleted.deleted) { resetForm(); await refreshPromptList(); setStatus("Saved prompt deleted."); }
}

async function saveCurrentAsTemplate() {
  const content = els.instructionsText.value.trim();
  if (!content) { setStatus("Write some instruction text before saving a template."); return; }
  const name = els.templateNameInput.value.trim();
  if (!name) { setStatus("Enter a template name before saving."); return; }
  await window.promptManagerApi.saveTemplate({ name, content });
  await refreshLibraries();
  els.templateNameInput.value = "";
  setStatus(`Saved "${name}" as a reusable template.`);
}

async function deleteSelectedTemplate() {
  if (!els.templateSelect.value.startsWith("saved:")) { setStatus("Select a saved custom template first."); return; }
  await window.promptManagerApi.deleteTemplate(els.templateSelect.value.replace("saved:", ""));
  await refreshLibraries();
  els.templateSelect.value = "";
  setStatus("Saved template deleted.");
}

async function saveCurrentAsSystemInstruction() {
  const content = els.systemInstructionsText.value.trim();
  if (!content) { setStatus("Write some instruction text before saving a system instruction."); return; }
  const name = els.systemInstructionNameInput.value.trim();
  if (!name) { setStatus("Enter a system instruction name before saving."); return; }
  const saved = await window.promptManagerApi.saveSystemInstruction({ name, content });
  await refreshLibraries();
  els.systemInstructionSelectMain.value = saved.id;
  els.systemInstructionNameInput.value = "";
  setStatus(`Saved "${name}" as a reusable system instruction.`);
}

async function deleteSelectedSystemInstruction() {
  const idValue = els.systemInstructionSelectMain.value;
  if (!idValue) { setStatus("Select a saved system instruction first."); return; }
  await window.promptManagerApi.deleteSystemInstruction(idValue);
  state.attachedSystemInstructionIds = state.attachedSystemInstructionIds.filter((entry) => entry !== idValue);
  await refreshLibraries();
  await autoRefreshAfterChange();
  setStatus("Saved system instruction deleted.");
}

async function attachSelectedSystemInstruction() {
  const idValue = els.systemInstructionSelectMain.value;
  if (!idValue) { setStatus("Choose a saved system instruction first."); return; }
  if (!state.attachedSystemInstructionIds.includes(idValue)) state.attachedSystemInstructionIds.push(idValue);
  renderSystemInstructionLibrary();
  await autoRefreshAfterChange();
  setStatus("System instruction attached to this prompt.");
}

function loadSelectedSystemInstructionIntoEditor() {
  const idValue = els.systemInstructionSelectMain.value;
  if (!idValue) {
    setStatus("Choose a saved system instruction first.");
    return;
  }
  const saved = state.library.systemInstructions.find((entry) => entry.id === idValue);
  if (!saved) {
    setStatus("Saved system instruction not found.");
    return;
  }
  els.systemInstructionsText.value = saved.content;
  els.systemInstructionNameInput.value = saved.name;
  setStatus(`Loaded "${saved.name}" into the system instructions editor.`);
}

function handleTemplateSelection() {
  const value = els.templateSelect.value;
  if (!value) return;
  if (value.startsWith("builtin:")) {
    const template = BUILTIN_TEMPLATES.find((entry) => entry.id === value.replace("builtin:", ""));
    if (template) {
      els.instructionsText.value = template.content;
      setStatus(`Applied template "${template.label}".`);
    }
    return;
  }
  const template = state.library.templates.find((entry) => entry.id === value.replace("saved:", ""));
  if (template) {
    els.instructionsText.value = template.content;
    setStatus(`Applied saved template "${template.name}".`);
  }
}

function wireDropZone(k) {
  const zone = dropEl(k);
  zone.ondragover = (event) => { event.preventDefault(); zone.classList.add("drag-over"); };
  zone.ondragleave = () => zone.classList.remove("drag-over");
  zone.ondrop = (event) => {
    event.preventDefault();
    zone.classList.remove("drag-over");
    const rawPaths = Array.from(event.dataTransfer.files || []).map((file) => file.path).filter(Boolean);
    window.promptManagerApi.inspectPaths(rawPaths).then(async (entries) => {
      const items = entries.filter((entry) => entry.exists).map((entry) => item(entry.type, entry.path));
      addItems(k, items);
      setStatus(`Added ${items.length} source${items.length === 1 ? "" : "s"} to ${k}.`);
      await autoRefreshAfterChange();
    }).catch((error) => setStatus(`Could not inspect dropped items: ${error.message}`));
  };
}

function bindEvents() {
  document.querySelectorAll("[data-section][data-action]").forEach((button) => {
    button.onclick = async () => { await pickSources(button.dataset.section, button.dataset.action); };
  });

  els.templateSelect.onchange = handleTemplateSelection;
  els.saveTemplateBtn.onclick = saveCurrentAsTemplate;
  els.deleteTemplateBtn.onclick = deleteSelectedTemplate;
  els.saveSystemInstructionBtnMain.onclick = saveCurrentAsSystemInstruction;
  els.attachSystemInstructionBtnMain.onclick = attachSelectedSystemInstruction;
  els.deleteSystemInstructionBtnMain.onclick = deleteSelectedSystemInstruction;
  els.loadSystemInstructionBtn.onclick = loadSelectedSystemInstructionIntoEditor;
  els.searchInput.oninput = renderPromptList;
  els.refreshBrowserCapturesBtn.onclick = async () => {
    state.library.browserCaptures = await window.promptManagerApi.listBrowserCaptures();
    renderBrowserCaptures();
    setStatus("Browser inbox refreshed.");
  };
  els.buildBtn.onclick = async () => { await refreshPreview(); };
  els.refreshAllBtn.onclick = async () => { await refreshPreview({ skipAutoPull: true }); };
  els.pullAllBtn.onclick = async () => { await pullAllSections(); await refreshPreview({ skipAutoPull: true }); };
  els.copyBtn.onclick = copyPrompt;
  els.duplicateBtn.onclick = duplicateCurrentPrompt;
  els.saveBtn.onclick = savePrompt;
  els.deleteBtn.onclick = deletePrompt;
  els.newPromptBtn.onclick = resetForm;
  els.toggleSidebarBtn.onclick = () => {
    els.appShell.classList.toggle("sidebar-collapsed");
    els.toggleSidebarBtn.textContent = els.appShell.classList.contains("sidebar-collapsed") ? "Show Sidebar" : "Hide Sidebar";
  };
  els.themeToggleBtn.onclick = async () => {
    state.settings = await window.promptManagerApi.updateSettings({ theme: state.settings.theme === "light" ? "dark" : "light" });
    applyTheme();
    renderStorage();
    setStatus(`Theme changed to ${state.settings.theme}.`);
  };
  els.settingsBtn.onclick = () => els.settingsModal.classList.remove("hidden");
  els.closeSettingsBtn.onclick = () => els.settingsModal.classList.add("hidden");
  document.querySelectorAll("[data-close-settings]").forEach((node) => { node.onclick = () => els.settingsModal.classList.add("hidden"); });
  if (els.openDebugConsoleBtn) {
    els.openDebugConsoleBtn.onclick = async () => {
      els.debugModal.classList.remove("hidden");
      await refreshDebugLogs();
      setStatus("Extension debug console opened.");
    };
  }
  if (els.closeDebugModalBtn) {
    els.closeDebugModalBtn.onclick = () => els.debugModal.classList.add("hidden");
  }
  document.querySelectorAll("[data-close-debug]").forEach((node) => {
    node.onclick = () => els.debugModal.classList.add("hidden");
  });
  if (els.refreshDebugLogsBtn) {
    els.refreshDebugLogsBtn.onclick = async () => {
      await refreshDebugLogs();
      setStatus("Extension debug logs refreshed.");
    };
  }
  if (els.clearDebugLogsBtn) {
    els.clearDebugLogsBtn.onclick = async () => {
      await window.promptManagerApi.clearExtensionDebugLogs();
      state.debugLogs = [];
      renderDebugConsole();
      setStatus("Extension debug logs cleared.");
    };
  }
  if (els.copyDebugLogsBtn) {
    els.copyDebugLogsBtn.onclick = async () => {
      await navigator.clipboard.writeText(els.debugLogConsole.textContent || "");
      setStatus("Extension debug logs copied to clipboard.");
    };
  }
  if (els.exportDebugLogsBtn) {
    els.exportDebugLogsBtn.onclick = async () => {
      const result = await window.promptManagerApi.exportExtensionDebugLogs();
      setStatus(`Debug logs exported to ${result.filePath}.`);
    };
  }
  if (els.testDebugAlertBtn) {
    els.testDebugAlertBtn.onclick = async () => {
      await window.promptManagerApi.testAlert();
      await refreshDebugLogs();
      setStatus("Manual alert test sent from Prompt Manager.");
    };
  }
  document.querySelectorAll("[data-tree-section][data-tree-action]").forEach((button) => {
    button.onclick = () => {
      const k = button.dataset.treeSection;
      const preview = state.sections[k].preview;
      if (!preview?.treeRoots?.length) {
        setStatus(`Build or refresh ${k} first so there is a folder tree to expand or collapse.`);
        return;
      }
      if (button.dataset.treeAction === "collapse") {
        state.collapsedNodes[k] = collectFolderPaths(preview.treeRoots);
      } else {
        state.collapsedNodes[k] = [];
      }
      renderSectionTree(k);
    };
  });
  els.chooseExportBtn.onclick = async () => { state.settings = await window.promptManagerApi.chooseExportDir(); renderStorage(); await refreshBackupStatus(); setStatus("Export folder updated."); };
  els.resetExportBtn.onclick = async () => { state.settings = await window.promptManagerApi.resetExportDir(); renderStorage(); await refreshBackupStatus(); setStatus("Export folder reset to default."); };
  els.chooseBackupBtn.onclick = async () => { state.settings = await window.promptManagerApi.chooseBackupDir(); renderStorage(); await refreshBackupStatus(); setStatus("Backup folder updated."); };
  els.resetBackupBtn.onclick = async () => { state.settings = await window.promptManagerApi.resetBackupDir(); renderStorage(); await refreshBackupStatus(); setStatus("Backup folder reset to default."); };
  els.saveBrowserBridgeBtn.onclick = async () => {
    const port = Number.parseInt(els.browserBridgePort.value, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setStatus("Browser bridge port must be between 1024 and 65535.");
      return;
    }
    state.settings = await window.promptManagerApi.updateSettings({
      browserBridge: {
        enabled: els.browserBridgeEnabled.checked,
        port
      }
    });
    const meta = await window.promptManagerApi.getMeta();
    state.meta.browserBridgeUrl = meta.browserBridgeUrl || "";
    state.meta.browserExtensionPath = meta.browserExtensionPath || "";
    renderStorage();
    setStatus("Browser integration settings saved.");
  };
  els.openExtensionFolderBtn.onclick = async () => {
    const result = await window.promptManagerApi.openPath(state.meta.browserExtensionPath);
    if (!result.success) {
      setStatus(`Could not open extension folder: ${result.error}`);
      return;
    }
    setStatus("Opened the Chrome extension folder.");
  };
  els.autoRefreshToggle.onchange = async () => { state.settings = await window.promptManagerApi.updateSettings({ autoRefreshPreview: els.autoRefreshToggle.checked }); renderStorage(); setStatus("Auto refresh setting updated."); };
  els.autoPullToggle.onchange = async () => { state.settings = await window.promptManagerApi.updateSettings({ autoPullBeforeBuild: els.autoPullToggle.checked }); renderStorage(); setStatus("Auto pull setting updated."); };
  els.backupNowBtn.onclick = async () => { const backup = await window.promptManagerApi.backupNow(); await refreshBackupStatus(); setStatus(`Backup saved to ${backup.backupPath}.`); };
  els.restoreBackupBtn.onclick = async () => {
    await window.promptManagerApi.restoreBackup();
    const meta = await window.promptManagerApi.getMeta();
    state.settings = meta.settings;
    state.meta.browserBridgeUrl = meta.browserBridgeUrl || "";
    state.meta.browserExtensionPath = meta.browserExtensionPath || "";
    renderStorage();
    renderFileTypeSettings();
    applyTheme();
    await refreshBackupStatus();
    await refreshLibraries();
    await refreshPromptList();
    resetForm();
    setStatus("Backup restored. Saved data and settings were refreshed.");
  };
  [els.promptName, els.promptTags, els.promptNotes, els.instructionsText, els.systemInstructionsText, els.instructionsEnabled, els.systemInstructionsEnabled, els.backendEnabled, els.websiteEnabled, els.androidEnabled].forEach((element) => {
    element.oninput = () => setStatus("Unsaved changes.");
    element.onchange = () => setStatus("Unsaved changes.");
  });
  KEYS.forEach((k) => wireDropZone(k));
}

async function init() {
  bindEvents();
  if (window.promptManagerApi.onExtensionDebugLog) {
    window.promptManagerApi.onExtensionDebugLog((entry) => {
      appendDebugLogEntry(entry);
      renderDebugConsole();
    });
  }
  KEYS.forEach((k) => { renderSources(k); renderSectionTree(k); renderSectionMeta(k); });
  const meta = await window.promptManagerApi.getMeta();
  state.meta.availableFileTypes = meta.availableFileTypes || [];
  state.meta.defaultSectionFileTypes = meta.defaultSectionFileTypes || {};
  state.meta.builtInFileTypeSet = new Set(meta.availableFileTypes || []);
  state.meta.browserBridgeUrl = meta.browserBridgeUrl || "";
  state.meta.browserExtensionPath = meta.browserExtensionPath || "";
  state.settings = meta.settings;
  renderStorage();
  renderFileTypeSettings();
  applyTheme();
  await refreshDebugLogs();
  await refreshBackupStatus();
  await refreshLibraries();
  await refreshPromptList();
  await refreshPreview({ skipAutoPull: true });
}

init().catch((error) => setStatus(`Failed to start app: ${error.message}`));
