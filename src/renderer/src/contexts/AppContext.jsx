import React, { createContext, useState, useEffect } from 'react';
import ConfigService from '../services/ConfigService';
import ObsService from '../services/ObsService';

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [config, setConfig] = useState(null);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState(0);
  const [obsConnected, setObsConnected] = useState(false);
  const [sceneList, setSceneList] = useState([]);
  const [sourcesByScene, setSourcesByScene] = useState({});
  const [appVersion, setAppVersion] = useState('1.0.1'); // Default version
  const [updateInfo, setUpdateInfo] = useState(null);

  const loadConfigFromDisk = async () => {
    try {
      const cfg = await ConfigService.loadConfig();
      setConfig(cfg);
      window.api.onLog('Configuration loaded from disk');
      return cfg;
    } catch (err) {
      window.api.onLog(`Error loading config from disk: ${err.message}`);
      return null;
    }
  };
  
  const enhancedAutoConnect = async () => {
    try {
      window.api.onLog('Attempting enhanced auto-connect to OBS...');
      const result = await connectToObs();
      
      if (result.success) {
        window.api.onLog('Enhanced auto-connect successful!');
        return true;
      } else {
        window.api.onLog(`Enhanced auto-connect failed: ${result.error}`);
        return false;
      }
    } catch (error) {
      window.api.onLog(`Error in enhanced auto-connect: ${error.message}`);
      return false;
    }
  };

  useEffect(() => {
    window.api.onLog(msg => setLogs(prev => [...prev, msg]));
    
    window.api.onUpdateAvailable(info => {
      setUpdateInfo(info);
      window.api.onLog(`Update Available: Version ${info.newVersion} is available. Current version is ${info.currentVersion}.`);
    });
    
    window.api.getAppVersion()
      .then(response => {
        if (response && response.version) {
          setAppVersion(response.version);
          window.api.onLog(`Running IRLshots version ${response.version}`);
        }
      })
      .catch(err => window.api.onLog(`Error getting app version: ${err.message}`));
    const loadAndConnect = async () => {
      try {
        // Load configuration
        const cfg = await loadConfigFromDisk();
        
        if (!cfg) {
          window.api.onLog('Failed to load configuration');
          return;
        }
        
        // Check for auto-connect setting
        if (cfg.autoConnect) {
          window.api.onLog(`Auto-connect is enabled - will connect to OBS at ${cfg.obs?.host || 'localhost'}:${cfg.obs?.port || '4455'} after delay...`);
          
          // Wait for UI to be fully ready
          setTimeout(() => {
            // Use the enhanced auto-connect
            enhancedAutoConnect()
              .then(success => {
                if (!success) {
                  // If first attempt fails, try once more after a delay
                  window.api.onLog('First connection attempt failed. Trying again after a short delay...');
                  setTimeout(() => {
                    enhancedAutoConnect()
                      .then(retrySuccess => {
                        if (!retrySuccess) {
                          window.api.onLog('Auto-connect failed after retries. Please connect manually.');
                        }
                      })
                      .catch(err => window.api.onLog(`Auto-connect error: ${err.message}`));
                  }, 3000);
                }
              })
              .catch(err => {
                window.api.onLog(`Auto-connect error: ${err.message}`);
              });
          }, 2500);  // Slightly longer delay for better reliability
        } else {
          window.api.onLog('Auto-connect is disabled. Connect to OBS manually when ready.');
        }
      } catch (err) {
        window.api.onLog(`Error during startup: ${err.message}`);
      }
    };
    
    // Start the loading and connection process
    loadAndConnect();
    
    // No dependencies needed as this should only run once on mount
  }, []);

  // Function to update config using ConfigService
  const updateConfig = (path, value) => {
    const newConfig = ConfigService.updateConfigProperty(config, path, value);
    // Update state without automatically saving to disk
    setConfig(newConfig);
  };

  // Save config to disk using ConfigService
  const saveConfig = async (customConfig) => {
    try {
      // Use provided custom config or current state config
      const configToSave = customConfig || config;
      
      if (!configToSave) {
        window.api.onLog('Error: No configuration to save');
        return false;
      }
      
      console.log('Saving config with language:', configToSave.language);
      console.log('Saving outputFolder:', configToSave.outputFolder);
      
      // Save to disk
      const result = await window.api.saveConfig(configToSave);
      
      if (result) {
        window.api.onLog('Configuration saved successfully');
        
        // If custom config was provided, update the UI state to match
        if (customConfig && customConfig !== config) {
          setConfig(customConfig);
        }
        
        return true;
      } else {
        window.api.onLog('Error: Failed to save configuration');
        return false;
      }
    } catch (error) {
      window.api.onLog(`Error saving configuration: ${error.message}`);
      return false;
    }
  };
  
  // Function to reload configuration from disk and update UI
  const reloadConfig = async () => {
    window.api.onLog('Reloading configuration from disk...');
    return await loadConfigFromDisk();
  };

  // Function to handle OBS connection using ObsService
  const connectToObs = async () => {
    try {
      // Ensure we have a valid OBS configuration
      if (!config.obs || !config.obs.host) {
        window.api.onLog('Missing OBS configuration. Using default values.');
        // Set default values if missing
        updateConfig('obs', {
          host: 'localhost',
          port: 4455,
          password: ''
        });
      }
      
      const obsConfig = config.obs || {
        host: 'localhost',
        port: 4455,
        password: ''
      };
      
      window.api.onLog(`Connecting to OBS at ${obsConfig.host}:${obsConfig.port}`);
      const result = await ObsService.connectToObs(obsConfig);
      
      if (result.sources && result.sources.length) {
        // Structure sources by scene
        const sourceMap = {};
        const scenes = [];
        
        // Extract scenes and organize sources by scene
        result.scenes.forEach(scene => {
          const sceneName = scene.sceneName;
          scenes.push(sceneName);
          sourceMap[sceneName] = [];
        });
        
        // Process all sources
        result.sources.forEach(source => {
          // Add to appropriate scene
          if (source.scene && sourceMap[source.scene]) {
            sourceMap[source.scene].push(source);
          }
        });
        
        setSceneList(scenes);
        setSourcesByScene(sourceMap);
        setObsConnected(true);
        
        // Set first source as default if not already set
        if (!config.captureSource && result.sources.length > 0) {
          updateConfig('captureSource', result.sources[0].name);
        }
        
        window.api.onLog(`OBS connected. ${result.sources.length} sources loaded across ${scenes.length} scenes.`);
        return { success: true };
      } else {
        return { 
          success: false, 
          error: 'No sources found. Check if OBS is running with websocket enabled'
        };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  };

  // Function to take a polaroid using ObsService
  const takePolaroid = async () => {
    if (!obsConnected) return { success: false, error: "OBS not connected" };
    
    try {
      window.api.onLog('Taking polaroid...');
      const result = await window.api.takePolaroid(config);
      
      if (result.success) {
        window.api.onLog('Polaroid taken successfully');
        if (result.imagePath) {
          window.api.onLog(`Image saved to: ${result.imagePath}`);
        }
        return { success: true };
      } else {
        window.api.onLog('Error taking polaroid: ' + result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      window.api.onLog('Error taking polaroid: ' + error.message);
      return { success: false, error: error.message };
    }
  };

  // Function to test animation using ObsService
  const testAnimation = async () => {
    if (!obsConnected) return { success: false, error: "OBS not connected" };
    
    try {
      window.api.onLog('Testing animation...');
      const result = await window.api.testAnimation(config);
      
      if (result.success) {
        window.api.onLog('Animation test successful');
        return { success: true };
      } else {
        window.api.onLog('Animation test error: ' + result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      window.api.onLog('Animation test error: ' + error.message);
      return { success: false, error: error.message };
    }
  };

  const checkForUpdates = async () => {
    try {
      window.api.onLog('Manually checking for updates...');
      const result = await window.api.checkForUpdates();
      
      if (result.updateAvailable) {
        setUpdateInfo(result);
        window.api.onLog(`Update Available: Version ${result.latestVersion} is available. Current version is ${result.currentVersion}.`);
        return result;
      } else {
        window.api.onLog(`Up to Date: You're running the latest version (${appVersion}).`);
        return result;
      }
    } catch (error) {
      window.api.onLog(`Error checking for updates: ${error.message}`);
      return { updateAvailable: false, error: error.message };
    }
  };

  const downloadUpdate = async () => {
    try {
      window.api.onLog('Starting update download...');
      const result = await window.api.downloadUpdate();
      
      if (result.success) {
        window.api.onLog('Update Download Started: The download has started in your browser. Please follow the instructions to install the update.');
        return true;
      } else {
        window.api.onLog(`Update Download Failed: Could not download update: ${result.message}`);
        return false;
      }
    } catch (error) {
      window.api.onLog(`Error downloading update: ${error.message}`);
      return false;
    }
  };

  return config ? (
    <AppContext.Provider value={{
      config,
      logs,
      activeTab,
      setActiveTab,
      obsConnected,
      sceneList,
      sourcesByScene,
      appVersion,
      updateInfo,
      updateConfig,
      saveConfig,
      reloadConfig,
      connectToObs,
      takePolaroid,
      testAnimation,
      checkForUpdates,
      downloadUpdate
    }}>
      {children}
    </AppContext.Provider>
  ) : (
    <div className="flex items-center justify-center h-screen">
      <div className="text-xl font-semibold animate-pulse">Loading...</div>
    </div>
  );
};

export default AppProvider;