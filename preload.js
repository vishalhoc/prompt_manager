const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("promptManagerApi", {
  pickFiles: () => ipcRenderer.invoke("dialog:pick-files"),
  pickDirectory: (label, defaultPath) => ipcRenderer.invoke("dialog:pick-directory", label, defaultPath),
  inspectPaths: (paths) => ipcRenderer.invoke("path:inspect", paths),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings) => ipcRenderer.invoke("settings:update", settings),
  chooseExportDir: () => ipcRenderer.invoke("settings:choose-export-dir"),
  resetExportDir: () => ipcRenderer.invoke("settings:reset-export-dir"),
  chooseBackupDir: () => ipcRenderer.invoke("settings:choose-backup-dir"),
  resetBackupDir: () => ipcRenderer.invoke("settings:reset-backup-dir"),
  getBackupStatus: () => ipcRenderer.invoke("backup:status"),
  backupNow: () => ipcRenderer.invoke("backup:now"),
  restoreBackup: () => ipcRenderer.invoke("backup:restore"),
  getLibrary: () => ipcRenderer.invoke("library:bootstrap"),
  saveSystemInstruction: (item) => ipcRenderer.invoke("library:save-system-instruction", item),
  deleteSystemInstruction: (id) => ipcRenderer.invoke("library:delete-system-instruction", id),
  saveTemplate: (item) => ipcRenderer.invoke("library:save-template", item),
  deleteTemplate: (id) => ipcRenderer.invoke("library:delete-template", id),
  listPrompts: () => ipcRenderer.invoke("prompt:list"),
  loadPrompt: (id) => ipcRenderer.invoke("prompt:load", id),
  previewPrompt: (config) => ipcRenderer.invoke("prompt:preview", config),
  savePrompt: (payload) => ipcRenderer.invoke("prompt:save", payload),
  deletePrompt: (id) => ipcRenderer.invoke("prompt:delete", id),
  pullSection: (sectionKey, section) => ipcRenderer.invoke("git:pull-section", sectionKey, section),
  syncGitLink: (repoUrl, targetDirectory) => ipcRenderer.invoke("git:sync-link", repoUrl, targetDirectory),
  getMeta: () => ipcRenderer.invoke("app:meta")
});
