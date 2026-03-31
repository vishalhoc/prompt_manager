const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const APP_TITLE = "Prompt Manager";
const DEFAULT_EXPORT_FOLDER_NAME = APP_TITLE.replace(/\s+/g, "");
const BACKUP_FOLDER_NAME = "PromptManagerBackup";
const BACKUP_FILE_NAME = "prompt-manager-backup.json";
const SECTION_LABELS = {
  backend: "BACKEND FILES",
  website: "WEBSITE FILES",
  android: "ANDROID APP FILES"
};
const AVAILABLE_FILE_TYPES = [
  ".py",
  ".js",
  ".ts",
  ".html",
  ".css",
  ".kt",
  ".kts",
  ".java",
  ".xml",
  ".json",
  ".toml",
  ".prop",
  ".gradle",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".properties",
  ".swift",
  ".sql"
];
const AVAILABLE_FILE_TYPE_SET = new Set(AVAILABLE_FILE_TYPES);
const DEFAULT_SECTION_FILE_TYPES = {
  backend: [".py", ".js", ".ts", ".json", ".sql", ".md", ".txt", ".yml", ".yaml", ".properties"],
  website: [".html", ".css", ".js", ".ts", ".json", ".md", ".txt", ".yml", ".yaml"],
  android: [".kt", ".kts", ".java", ".xml", ".gradle", ".json", ".toml", ".prop", ".md", ".txt", ".yml", ".yaml", ".properties"]
};
const IGNORED_DIRS = new Set([
  ".git",
  ".idea",
  ".gradle",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "venv",
  ".venv",
  "__pycache__",
  ".next"
]);

let mainWindow;

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "prompt";
}

function sanitizePromptName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim();
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function normalizePath(targetPath) {
  return path.normalize(targetPath);
}

function uniqueNormalizedPaths(paths = []) {
  const seen = new Set();
  const result = [];
  for (const value of paths) {
    if (!value) {
      continue;
    }
    const normalized = normalizePath(value);
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function defaultPromptDb() {
  return {
    prompts: [],
    systemInstructions: [],
    templates: []
  };
}

function defaultSettings() {
  const { defaultExportDir } = getStorePaths();
  return {
    exportDir: defaultExportDir,
    backupDir: getStorePaths().defaultBackupDir,
    autoRefreshPreview: true,
    autoPullBeforeBuild: false,
    theme: "dark",
    sectionFileTypes: { ...DEFAULT_SECTION_FILE_TYPES }
  };
}

function getStorePaths() {
  const userDataDir = app.getPath("userData");
  const appDataDir = path.join(userDataDir, "data");
  const promptsDbPath = path.join(appDataDir, "prompts.json");
  const settingsPath = path.join(appDataDir, "settings.json");
  const promptSnapshotsDir = path.join(appDataDir, "snapshots");
  const documentsDir = app.getPath("documents");
  const defaultExportDir = path.join(documentsDir, DEFAULT_EXPORT_FOLDER_NAME);
  const defaultBackupDir = path.join(documentsDir, BACKUP_FOLDER_NAME);
  const backupDir = defaultBackupDir;
  const backupPath = path.join(defaultBackupDir, BACKUP_FILE_NAME);
  return {
    appDataDir,
    promptsDbPath,
    settingsPath,
    promptSnapshotsDir,
    defaultExportDir,
    defaultBackupDir,
    backupDir,
    backupPath
  };
}

function getBackupPathForSettings(settings) {
  const { defaultBackupDir } = getStorePaths();
  const backupDir = normalizePath(settings.backupDir || defaultBackupDir);
  return {
    backupDir,
    backupPath: path.join(backupDir, BACKUP_FILE_NAME)
  };
}

function normalizeSectionFileTypes(sectionFileTypes = {}) {
  const next = {};
  for (const sectionKey of Object.keys(SECTION_LABELS)) {
    const requested = Array.isArray(sectionFileTypes[sectionKey]) ? sectionFileTypes[sectionKey] : DEFAULT_SECTION_FILE_TYPES[sectionKey];
    const filtered = requested.filter((extension) => AVAILABLE_FILE_TYPE_SET.has(extension));
    next[sectionKey] = filtered.length ? Array.from(new Set(filtered)) : DEFAULT_SECTION_FILE_TYPES[sectionKey];
  }
  return next;
}

function normalizeLibraryItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.name && item.content)
    .map((item) => ({
      id: item.id || `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(item.name).trim(),
      content: String(item.content),
      updatedAt: item.updatedAt || new Date().toISOString(),
      createdAt: item.createdAt || item.updatedAt || new Date().toISOString()
    }));
}

function normalizePromptDbData(data = {}) {
  return {
    prompts: Array.isArray(data.prompts) ? data.prompts : [],
    systemInstructions: normalizeLibraryItems(data.systemInstructions),
    templates: normalizeLibraryItems(data.templates)
  };
}

function normalizeSettingsData(data = {}) {
  const defaults = defaultSettings();
  return {
    exportDir: normalizePath(data.exportDir || defaults.exportDir),
    backupDir: normalizePath(data.backupDir || defaults.backupDir),
    autoRefreshPreview: data.autoRefreshPreview !== false,
    autoPullBeforeBuild: Boolean(data.autoPullBeforeBuild),
    theme: data.theme === "light" ? "light" : "dark",
    sectionFileTypes: normalizeSectionFileTypes(data.sectionFileTypes || defaults.sectionFileTypes)
  };
}

function syncBackup() {
  const settings = readSettings(false);
  const { backupDir, backupPath } = getBackupPathForSettings(settings);
  fs.mkdirSync(backupDir, { recursive: true });
  const payload = {
    savedAt: new Date().toISOString(),
    promptsDb: readPromptDb(false),
    settings: readSettings(false)
  };
  fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2), "utf8");
}

function restoreBackupIfNeeded() {
  const { promptsDbPath, settingsPath, defaultBackupDir } = getStorePaths();
  const currentSettings = normalizeSettingsData(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
  const { backupPath } = getBackupPathForSettings(currentSettings.backupDir ? currentSettings : { backupDir: defaultBackupDir });
  if (!fs.existsSync(backupPath)) {
    return;
  }

  const rawBackup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const backupDb = normalizePromptDbData(rawBackup.promptsDb || {});
  const backupSettings = normalizeSettingsData(rawBackup.settings || {});
  const currentDb = normalizePromptDbData(JSON.parse(fs.readFileSync(promptsDbPath, "utf8")));
  const latestSettings = normalizeSettingsData(JSON.parse(fs.readFileSync(settingsPath, "utf8")));

  const shouldRestoreDb = currentDb.prompts.length === 0 && currentDb.systemInstructions.length === 0 && currentDb.templates.length === 0;
  const defaults = defaultSettings();
  const shouldRestoreSettings =
    latestSettings.exportDir === defaults.exportDir &&
    latestSettings.backupDir === defaults.backupDir &&
    latestSettings.theme === defaults.theme &&
    JSON.stringify(latestSettings.sectionFileTypes) === JSON.stringify(defaults.sectionFileTypes);

  if (shouldRestoreDb) {
    fs.writeFileSync(promptsDbPath, JSON.stringify(backupDb, null, 2), "utf8");
  }

  if (shouldRestoreSettings) {
    fs.writeFileSync(settingsPath, JSON.stringify(backupSettings, null, 2), "utf8");
  }
}

function forceRestoreFromBackup() {
  const { promptsDbPath, settingsPath } = getStorePaths();
  const { backupPath } = getBackupPathForSettings(readSettings(false));
  if (!fs.existsSync(backupPath)) {
    throw new Error("No backup file found.");
  }

  const rawBackup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  const backupDb = normalizePromptDbData(rawBackup.promptsDb || {});
  const backupSettings = normalizeSettingsData(rawBackup.settings || {});
  fs.writeFileSync(promptsDbPath, JSON.stringify(backupDb, null, 2), "utf8");
  fs.writeFileSync(settingsPath, JSON.stringify(backupSettings, null, 2), "utf8");
}

function ensureStore() {
  const { appDataDir, promptsDbPath, settingsPath, promptSnapshotsDir, defaultExportDir, defaultBackupDir } = getStorePaths();
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(promptSnapshotsDir, { recursive: true });
  fs.mkdirSync(defaultExportDir, { recursive: true });
  fs.mkdirSync(defaultBackupDir, { recursive: true });

  if (!fs.existsSync(promptsDbPath)) {
    fs.writeFileSync(promptsDbPath, JSON.stringify(defaultPromptDb(), null, 2), "utf8");
  }

  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, JSON.stringify(defaultSettings(), null, 2), "utf8");
  }

  restoreBackupIfNeeded();
}

function readPromptDb(ensure = true) {
  if (ensure) {
    ensureStore();
  }
  const { promptsDbPath } = getStorePaths();
  try {
    return normalizePromptDbData(JSON.parse(fs.readFileSync(promptsDbPath, "utf8")));
  } catch {
    return defaultPromptDb();
  }
}

function writePromptDb(data) {
  ensureStore();
  const { promptsDbPath } = getStorePaths();
  fs.writeFileSync(promptsDbPath, JSON.stringify(normalizePromptDbData(data), null, 2), "utf8");
  syncBackup();
}

function readSettings(ensure = true) {
  if (ensure) {
    ensureStore();
  }
  const { settingsPath } = getStorePaths();
  try {
    return normalizeSettingsData(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
  } catch {
    return defaultSettings();
  }
}

function writeSettings(data) {
  ensureStore();
  const { settingsPath } = getStorePaths();
  const normalized = normalizeSettingsData(data);
  fs.writeFileSync(settingsPath, JSON.stringify(normalized, null, 2), "utf8");
  fs.mkdirSync(normalized.exportDir, { recursive: true });
  fs.mkdirSync(normalized.backupDir, { recursive: true });
  syncBackup();
  return normalized;
}

function getExportDir() {
  const settings = readSettings();
  fs.mkdirSync(settings.exportDir, { recursive: true });
  return settings.exportDir;
}

function normalizeItems(items = []) {
  const seen = new Set();
  return items
    .filter((item) => item && item.path)
    .map((item) => ({
      id: item.id || `${item.type}:${item.path}`,
      type: item.type || "file",
      path: normalizePath(item.path)
    }))
    .filter((item) => {
      const key = `${item.type}:${item.path.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeSection(section = {}) {
  return {
    enabled: Boolean(section.enabled),
    roots: normalizeItems(section.roots || section.items || []),
    excludedPaths: uniqueNormalizedPaths(section.excludedPaths || [])
  };
}

function normalizePromptConfig(config = {}) {
  return {
    instructions: {
      enabled: Boolean(config.instructions?.enabled),
      text: config.instructions?.text || ""
    },
    systemInstructions: {
      enabled: Boolean(config.systemInstructions?.enabled),
      text: config.systemInstructions?.text || "",
      attachedIds: Array.isArray(config.systemInstructions?.attachedIds)
        ? Array.from(new Set(config.systemInstructions.attachedIds.map(String)))
        : []
    },
    backend: normalizeSection(config.backend),
    website: normalizeSection(config.website),
    android: normalizeSection(config.android)
  };
}

function pathStartsWith(targetPath, parentPath) {
  const normalizedTarget = normalizePath(targetPath).toLowerCase();
  const normalizedParent = normalizePath(parentPath).toLowerCase();
  return normalizedTarget === normalizedParent || normalizedTarget.startsWith(`${normalizedParent}${path.sep}`);
}

function isPathExcluded(targetPath, excludedPaths = []) {
  return excludedPaths.some((excludedPath) => pathStartsWith(targetPath, excludedPath));
}

function isAllowedFile(filePath, sectionKey) {
  const extension = path.extname(filePath).toLowerCase();
  const settings = readSettings();
  const allowedForSection = settings.sectionFileTypes[sectionKey] || DEFAULT_SECTION_FILE_TYPES[sectionKey];
  return allowedForSection.includes(extension);
}

function detectGitRoot(startPath) {
  if (!startPath) {
    return null;
  }

  let current = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? normalizePath(startPath)
    : path.dirname(normalizePath(startPath));

  while (true) {
    const gitMarker = path.join(current, ".git");
    if (fs.existsSync(gitMarker)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return `[Unable to read file: ${error.message}]`;
  }
}

function scanEntry(entryPath, sectionKey, excludedPaths, visitedDirs, rootPath) {
  const normalized = normalizePath(entryPath);
  if (!fs.existsSync(normalized)) {
    return null;
  }

  const stats = fs.statSync(normalized);
  const included = !isPathExcluded(normalized, excludedPaths);
  const relativePath = rootPath ? path.relative(rootPath, normalized) || path.basename(normalized) : path.basename(normalized);

  if (stats.isDirectory()) {
    const lower = normalized.toLowerCase();
    if (visitedDirs.has(lower)) {
      return null;
    }
    visitedDirs.add(lower);

    const node = {
      path: normalized,
      relativePath,
      name: path.basename(normalized),
      type: "folder",
      included,
      children: []
    };

    if (!included) {
      return {
        node,
        files: [],
        allFiles: [],
        allDirectories: [normalized]
      };
    }

    const entries = fs.readdirSync(normalized, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const childPath = path.join(normalized, entry.name);
      const childResult = scanEntry(childPath, sectionKey, excludedPaths, visitedDirs, rootPath);
      if (!childResult) {
        continue;
      }
      childResult.node.__scanMeta = childResult;
      node.children.push(childResult.node);
    }

    node.children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const files = [];
    const allFiles = [];
    const allDirectories = [normalized];
    for (const child of node.children) {
      const childMeta = child.__scanMeta;
      if (!childMeta) {
        continue;
      }
      files.push(...childMeta.files);
      allFiles.push(...childMeta.allFiles);
      allDirectories.push(...childMeta.allDirectories);
      delete child.__scanMeta;
    }

    return {
      node,
      files,
      allFiles,
      allDirectories
    };
  }

  if (!stats.isFile() || !isAllowedFile(normalized, sectionKey)) {
    return null;
  }

  const content = safeReadFile(normalized);
  return {
    node: {
      path: normalized,
      relativePath,
      name: path.basename(normalized),
      type: "file",
      included,
      children: []
    },
    files: included ? [{ path: normalized, content }] : [],
    allFiles: [normalized],
    allDirectories: []
  };
}

function stripInternalMeta(node) {
  return {
    path: node.path,
    relativePath: node.relativePath,
    name: node.name,
    type: node.type,
    included: node.included,
    children: (node.children || []).map(stripInternalMeta)
  };
}

function buildSectionData(sectionKey, section = {}) {
  const normalizedSection = normalizeSection(section);
  const missingPaths = [];
  const gitRepos = new Set();
  const treeRoots = [];
  const includedFiles = [];
  const allFiles = [];
  const allDirectories = [];
  const visitedDirs = new Set();

  for (const root of normalizedSection.roots) {
    if (!fs.existsSync(root.path)) {
      missingPaths.push(root.path);
      continue;
    }

    const gitRoot = detectGitRoot(root.path);
    if (gitRoot) {
      gitRepos.add(gitRoot);
    }

    const basePath = fs.statSync(root.path).isDirectory() ? root.path : path.dirname(root.path);
    const result = scanEntry(root.path, sectionKey, normalizedSection.excludedPaths, visitedDirs, basePath);
    if (!result) {
      continue;
    }

    treeRoots.push(result.node);
    includedFiles.push(...result.files);
    allFiles.push(...result.allFiles);
    allDirectories.push(...result.allDirectories);
  }

  const uniqueIncludedFiles = [];
  const fileSeen = new Set();
  for (const file of includedFiles) {
    const key = file.path.toLowerCase();
    if (!fileSeen.has(key)) {
      fileSeen.add(key);
      uniqueIncludedFiles.push(file);
    }
  }

  uniqueIncludedFiles.sort((a, b) => a.path.localeCompare(b.path));

  return {
    roots: normalizedSection.roots,
    excludedPaths: normalizedSection.excludedPaths,
    treeRoots: treeRoots.map(stripInternalMeta),
    fileCount: uniqueIncludedFiles.length,
    allFileCount: uniqueNormalizedPaths(allFiles).length,
    folderCount: uniqueNormalizedPaths(allDirectories).length,
    content: uniqueIncludedFiles.map((file) => `===== FILE: ${file.path} =====\n${file.content}`).join("\n\n"),
    missingPaths,
    gitRepos: Array.from(gitRepos).sort()
  };
}

function buildPromptPayload(config = {}) {
  const normalized = normalizePromptConfig(config);
  const db = readPromptDb();
  const attachedSystemInstructions = db.systemInstructions.filter((item) =>
    normalized.systemInstructions.attachedIds.includes(item.id)
  );

  const sections = [];
  const collected = {};

  if (normalized.instructions.enabled && normalized.instructions.text.trim()) {
    sections.push(`================ INSTRUCTIONS ================\n${normalized.instructions.text.trim()}`);
  }

  if (normalized.systemInstructions.enabled && normalized.systemInstructions.text.trim()) {
    sections.push(`================ SYSTEM INSTRUCTIONS ================\n${normalized.systemInstructions.text.trim()}`);
  }

  if (attachedSystemInstructions.length) {
    sections.push(
      `================ SAVED SYSTEM INSTRUCTIONS ================\n${attachedSystemInstructions.map((item) => `## ${item.name}\n${item.content}`).join("\n\n")}`
    );
  }

  for (const sectionKey of Object.keys(SECTION_LABELS)) {
    if (!normalized[sectionKey].enabled) {
      collected[sectionKey] = null;
      continue;
    }
    const data = buildSectionData(sectionKey, normalized[sectionKey]);
    collected[sectionKey] = data;
    sections.push(`================ ${SECTION_LABELS[sectionKey]} ================\n${data.content || "[No included files found]"}`);
  }

  const prompt = sections.join("\n\n").trim();
  const combinedText = [
    normalized.instructions.enabled ? normalized.instructions.text.trim() : "",
    normalized.systemInstructions.enabled ? normalized.systemInstructions.text.trim() : "",
    ...attachedSystemInstructions.map((item) => item.content),
    ...Object.keys(SECTION_LABELS).map((sectionKey) => collected[sectionKey]?.content || "")
  ].filter(Boolean).join("\n\n");

  return {
    prompt,
    stats: {
      characters: prompt.length,
      words: prompt.trim() ? prompt.trim().split(/\s+/).length : 0,
      estimatedTokens: estimateTokens(combinedText)
    },
    sections: collected,
    attachedSystemInstructions
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 780,
    backgroundColor: "#0d1117",
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function mapPromptSummary(prompt) {
  return {
    id: prompt.id,
    name: prompt.name,
    notes: prompt.notes || "",
    tags: prompt.tags || [],
    updatedAt: prompt.updatedAt,
    exportFileName: prompt.exportFileName || ""
  };
}

function execGit(args, options = {}) {
  return new Promise((resolve) => {
    execFile("git", args, options, (error, stdout, stderr) => {
      resolve({
        success: !error,
        stdout: (stdout || "").trim(),
        stderr: (stderr || "").trim(),
        error: error ? error.message : null
      });
    });
  });
}

async function execGitPull(repoPath) {
  const probe = await execGit(["-C", repoPath, "rev-parse", "--is-inside-work-tree"]);
  if (!probe.success || probe.stdout !== "true") {
    return {
      repoPath,
      success: false,
      output: probe.stderr || probe.stdout || "Path is not a Git working tree.",
      error: probe.error || "Git probe failed."
    };
  }

  const branch = await execGit(["-C", repoPath, "branch", "--show-current"]);
  const pull = await execGit(["-C", repoPath, "pull"]);
  return {
    repoPath,
    success: pull.success,
    branch: branch.stdout || "(detached)",
    output: [pull.stdout, pull.stderr].filter(Boolean).join("\n").trim() || (pull.success ? "Already up to date." : "Git pull failed."),
    error: pull.error
  };
}

function deriveRepoNameFromUrl(repoUrl) {
  const clean = repoUrl.trim().replace(/\/+$/, "");
  const name = clean.split("/").pop() || "repo";
  return name.replace(/\.git$/i, "") || "repo";
}

async function syncGitHubLink(repoUrl, targetDirectory) {
  const normalizedTarget = normalizePath(targetDirectory);
  fs.mkdirSync(normalizedTarget, { recursive: true });

  const existingRepo = detectGitRoot(normalizedTarget);
  if (existingRepo && existingRepo.toLowerCase() === normalizedTarget.toLowerCase()) {
    return execGitPull(normalizedTarget);
  }

  const contents = fs.readdirSync(normalizedTarget);
  if (contents.length > 0) {
    return {
      repoPath: normalizedTarget,
      success: false,
      output: "Selected folder is not empty and is not already a Git repository.",
      error: "Choose an empty folder or an existing repository."
    };
  }

  const clone = await execGit(["clone", repoUrl, "."], { cwd: normalizedTarget });
  const branch = await execGit(["-C", normalizedTarget, "branch", "--show-current"]);
  return {
    repoPath: normalizedTarget,
    success: clone.success,
    branch: branch.stdout || "(unknown)",
    output: [clone.stdout, clone.stderr].filter(Boolean).join("\n").trim() || (clone.success ? "Repository cloned successfully." : "Git clone failed."),
    error: clone.error
  };
}

function upsertLibraryItem(collection, itemInput) {
  const name = String(itemInput.name || "").trim();
  const content = String(itemInput.content || "");
  if (!name || !content.trim()) {
    throw new Error("Both name and content are required.");
  }

  const timestamp = new Date().toISOString();
  const item = {
    id: itemInput.id || `${slugify(name)}-${Date.now()}`,
    name,
    content,
    updatedAt: timestamp,
    createdAt: itemInput.createdAt || timestamp
  };

  const existingIndex = collection.findIndex((entry) => entry.id === item.id);
  if (existingIndex >= 0) {
    item.createdAt = collection[existingIndex].createdAt;
    collection[existingIndex] = item;
  } else {
    collection.push(item);
  }
  return item;
}

ipcMain.handle("dialog:pick-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select Files",
    properties: ["openFile", "multiSelections"],
    filters: [{
      name: "Code and text files",
      extensions: AVAILABLE_FILE_TYPES.map((extension) => extension.slice(1))
    }]
  });

  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("dialog:pick-directory", async (_event, label = "Select Folder", defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: label,
    defaultPath: defaultPath || undefined,
    properties: ["openDirectory", "createDirectory"]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("path:inspect", (_event, pathsToInspect = []) => {
  return pathsToInspect
    .filter(Boolean)
    .map((targetPath) => {
      const normalizedPath = normalizePath(targetPath);
      if (!fs.existsSync(normalizedPath)) {
        return {
          path: normalizedPath,
          exists: false,
          type: "missing"
        };
      }

      const stats = fs.statSync(normalizedPath);
      return {
        path: normalizedPath,
        exists: true,
        type: stats.isDirectory() ? "folder" : "file"
      };
    });
});

ipcMain.handle("settings:get", () => readSettings());

ipcMain.handle("settings:update", (_event, partialSettings = {}) => {
  const current = readSettings();
  return writeSettings({ ...current, ...partialSettings });
});

ipcMain.handle("settings:choose-export-dir", async () => {
  const current = readSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Export Folder",
    defaultPath: current.exportDir,
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return current;
  }

  return writeSettings({ ...current, exportDir: result.filePaths[0] });
});

ipcMain.handle("settings:choose-backup-dir", async () => {
  const current = readSettings();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Backup Folder",
    defaultPath: current.backupDir,
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return current;
  }

  return writeSettings({ ...current, backupDir: result.filePaths[0] });
});

ipcMain.handle("settings:reset-backup-dir", () => {
  const current = readSettings();
  const { defaultBackupDir } = getStorePaths();
  fs.mkdirSync(defaultBackupDir, { recursive: true });
  return writeSettings({ ...current, backupDir: defaultBackupDir });
});

ipcMain.handle("settings:reset-export-dir", () => {
  const current = readSettings();
  const { defaultExportDir } = getStorePaths();
  fs.mkdirSync(defaultExportDir, { recursive: true });
  return writeSettings({ ...current, exportDir: defaultExportDir });
});

ipcMain.handle("backup:status", () => {
  const settings = readSettings();
  const { backupPath, backupDir } = getBackupPathForSettings(settings);
  return {
    backupDir,
    backupPath,
    exists: fs.existsSync(backupPath)
  };
});

ipcMain.handle("backup:now", () => {
  syncBackup();
  const { backupPath } = getStorePaths();
  return { backupPath };
});

ipcMain.handle("backup:restore", () => {
  ensureStore();
  forceRestoreFromBackup();
  return {
    settings: readSettings(),
    library: {
      systemInstructions: readPromptDb().systemInstructions,
      templates: readPromptDb().templates
    }
  };
});

ipcMain.handle("library:bootstrap", () => {
  const db = readPromptDb();
  return {
    systemInstructions: db.systemInstructions,
    templates: db.templates
  };
});

ipcMain.handle("library:save-system-instruction", (_event, itemInput) => {
  const db = readPromptDb();
  const item = upsertLibraryItem(db.systemInstructions, itemInput);
  writePromptDb(db);
  return item;
});

ipcMain.handle("library:delete-system-instruction", (_event, id) => {
  const db = readPromptDb();
  db.systemInstructions = db.systemInstructions.filter((item) => item.id !== id);
  writePromptDb(db);
  return db.systemInstructions;
});

ipcMain.handle("library:save-template", (_event, itemInput) => {
  const db = readPromptDb();
  const item = upsertLibraryItem(db.templates, itemInput);
  writePromptDb(db);
  return item;
});

ipcMain.handle("library:delete-template", (_event, id) => {
  const db = readPromptDb();
  db.templates = db.templates.filter((item) => item.id !== id);
  writePromptDb(db);
  return db.templates;
});

ipcMain.handle("prompt:list", () => {
  const db = readPromptDb();
  return db.prompts.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(mapPromptSummary);
});

ipcMain.handle("prompt:load", (_event, promptId) => {
  const db = readPromptDb();
  const prompt = db.prompts.find((entry) => entry.id === promptId);
  if (!prompt) {
    throw new Error("Prompt not found.");
  }
  const normalizedPrompt = {
    ...prompt,
    config: normalizePromptConfig(prompt.config)
  };
  return {
    prompt: normalizedPrompt,
    livePreview: buildPromptPayload(normalizedPrompt.config)
  };
});

ipcMain.handle("prompt:preview", (_event, config) => buildPromptPayload(config));

ipcMain.handle("prompt:save", (_event, input) => {
  const db = readPromptDb();
  const promptId = input.id || `prompt-${Date.now()}`;
  const timestamp = new Date().toISOString();
  const sanitizedName = sanitizePromptName(input.name || "");

  if (!sanitizedName) {
    throw new Error("Prompt name is required.");
  }

  const config = normalizePromptConfig(input.config);
  const preview = buildPromptPayload(config);
  const fileBase = `${slugify(sanitizedName)}.txt`;
  const exportPath = path.join(getExportDir(), fileBase);
  const { promptSnapshotsDir } = getStorePaths();
  const snapshotPath = path.join(promptSnapshotsDir, `${promptId}.txt`);

  fs.writeFileSync(exportPath, preview.prompt, "utf8");
  fs.writeFileSync(snapshotPath, preview.prompt, "utf8");

  const record = {
    id: promptId,
    name: sanitizedName,
    notes: input.notes || "",
    tags: (input.tags || []).map((tag) => String(tag).trim()).filter(Boolean),
    updatedAt: timestamp,
    createdAt: input.createdAt || timestamp,
    exportFileName: fileBase,
    exportPath,
    snapshotPath,
    stats: preview.stats,
    config
  };

  const existingIndex = db.prompts.findIndex((entry) => entry.id === promptId);
  if (existingIndex >= 0) {
    record.createdAt = db.prompts[existingIndex].createdAt;
    db.prompts[existingIndex] = record;
  } else {
    db.prompts.push(record);
  }

  writePromptDb(db);
  return {
    prompt: record,
    preview,
    settings: readSettings()
  };
});

ipcMain.handle("prompt:delete", (_event, promptId) => {
  const db = readPromptDb();
  const existing = db.prompts.find((entry) => entry.id === promptId);
  if (!existing) {
    return { deleted: false };
  }
  db.prompts = db.prompts.filter((entry) => entry.id !== promptId);
  writePromptDb(db);
  if (existing.snapshotPath && fs.existsSync(existing.snapshotPath)) {
    fs.unlinkSync(existing.snapshotPath);
  }
  return { deleted: true };
});

ipcMain.handle("git:pull-section", async (_event, sectionKey, section) => {
  const normalizedSection = normalizeSection(section);
  const repoList = Array.from(new Set(
    normalizedSection.roots
      .map((root) => detectGitRoot(root.path))
      .filter(Boolean)
  )).sort();
  const results = await Promise.all(repoList.map((repoPath) => execGitPull(repoPath)));
  return {
    sectionKey,
    repoCount: repoList.length,
    results,
    preview: buildSectionData(sectionKey, normalizedSection)
  };
});

ipcMain.handle("git:sync-link", async (_event, repoUrl, targetDirectory) => {
  const result = await syncGitHubLink(repoUrl, targetDirectory);
  return {
    ...result,
    repoName: deriveRepoNameFromUrl(repoUrl)
  };
});

ipcMain.handle("app:meta", () => {
  ensureStore();
  const { promptsDbPath, backupPath } = getStorePaths();
  const settings = readSettings();
  const backup = getBackupPathForSettings(settings);
  return {
    promptsDbPath,
    backupPath: backup.backupPath,
    settings: readSettings(),
    availableFileTypes: AVAILABLE_FILE_TYPES,
    defaultSectionFileTypes: DEFAULT_SECTION_FILE_TYPES
  };
});

app.whenReady().then(() => {
  ensureStore();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
