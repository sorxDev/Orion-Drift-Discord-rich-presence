// Preload
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('a2', {
  getConfig:          ()  => ipcRenderer.invoke('get-config'),
  saveApiKey:         (k) => ipcRenderer.invoke('save-api-key', k),
  clearApiKey:        ()  => ipcRenderer.invoke('clear-api-key'),
  selectStation:      (s) => ipcRenderer.invoke('select-station', s),
  togglePresence:     (e) => ipcRenderer.invoke('toggle-presence', e),
  getPresenceState:   ()  => ipcRenderer.invoke('get-presence-state'),
  updatePresenceData: (s) => ipcRenderer.invoke('update-presence-data', s),
  onDiscordStatus: (cb) => ipcRenderer.on('discord-status', (_, data) => cb(data)),
});
