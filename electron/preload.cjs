const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('conova', Object.freeze({ login: () => ipcRenderer.invoke('conova:login'), clearLogin: () => ipcRenderer.invoke('conova:clearLogin') }))
