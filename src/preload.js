const { contextBridge, ipcRenderer } = require('electron');

// Better debugging for exposed APIs
console.log('Setting up API bridge');

const apiMethods = {
  loadConfig: () => {
    console.log('loadConfig called');
    return ipcRenderer.invoke('load-config');
  },
  saveConfig: (config) => {
    console.log('saveConfig called with:', config);
    return ipcRenderer.invoke('save-config', config);
  },
  takePolaroid: (config) => {
    console.log('takePolaroid called');
    return ipcRenderer.invoke('take-polaroid', config);
  },
  connectObs: (config) => {
    console.log('connectObs called with:', config);
    return ipcRenderer.invoke('connect-obs', config);
  },
  testAnimation: (config) => {
    console.log('testAnimation called');
    return ipcRenderer.invoke('test-animation', config);
  },
  selectTemplate: () => {
    console.log('selectTemplate called');
    return ipcRenderer.invoke('select-template');
  },
  selectOutputFolder: () => {
    console.log('selectOutputFolder called');
    return ipcRenderer.invoke('select-output-folder');
  },
  debugConfig: () => {
    console.log('debugConfig called');
    return ipcRenderer.invoke('debug-config');
  },
  // Version and updates
  getAppVersion: () => {
    console.log('getAppVersion called');
    return ipcRenderer.invoke('get-app-version');
  },
  checkForUpdates: () => {
    console.log('checkForUpdates called');
    return ipcRenderer.invoke('check-for-updates');
  },
  downloadUpdate: () => {
    console.log('downloadUpdate called');
    return ipcRenderer.invoke('download-update');
  },
  onLog: (callback) => {
    console.log('Setting up log listener');
    return ipcRenderer.on('log', (event, message) => {
      console.log('Log received:', message);
      callback(message);
    });
  },
  // Update notification listener
  onUpdateAvailable: (callback) => {
    console.log('Setting up update notification listener');
    return ipcRenderer.on('update-available', (event, updateInfo) => {
      console.log('Update available:', updateInfo);
      callback(updateInfo);
    });
  }
};

contextBridge.exposeInMainWorld('api', apiMethods);
console.log('API bridge setup complete');