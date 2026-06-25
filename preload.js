const { contextBridge, ipcRenderer } = require("electron");

/**
 * CONTEXT BRIDGE
 * This exposes a highly secure, restricted 'api' object to the frontend HTML/JS.
 * It strictly controls exactly what the dashboard is allowed to ask the backend server to do,
 * preventing any security vulnerabilities.
 */
contextBridge.exposeInMainWorld("api", {
  // Ask the background Node.js server for the latest file processing data
  getData: () => ipcRenderer.invoke("get-data"),

  // Read and update conversion settings such as column order and plant area
  getConfig: () => ipcRenderer.invoke("get-config"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  chooseFolder: () => ipcRenderer.invoke("choose-folder"),

  // Command the Windows OS to open the specific folder for a successful file
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),

  // Force the backend conversion engine to re-run a specific source file
  retrigger: (fileName) => ipcRenderer.invoke("retrigger-file", fileName),
});
