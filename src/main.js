const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
// Import OBS WebSocket v5 - using the default export
const OBSWebSocket = require('obs-websocket-js').default;
const Jimp = require('jimp');
const axios = require('axios');
const FormData = require('form-data');
const tmi = require('tmi.js');
const express = require('express');
const http = require('http');
const { execFile } = require('child_process');
const os = require('os');
let io;

let mainWindow;
const exampleConfigPath = path.join(__dirname, '../config.example.json');
const configPath = path.join(app.getPath('userData'), 'config.json');
const logsDir = path.join(path.dirname(app.getAppPath()), 'logs');

const APP_VERSION = '1.0.1';
const VERSION_CHECK_URL = 'https://irlhosting.com/IRLshots/version';
const GITHUB_RELEASES_URL = 'https://github.com/IRLtools/IRLshots/releases';
const GITHUB_API_URL = 'https://api.github.com/repos/IRLtools/IRLshots/releases/latest';
let updateAvailable = false;
let latestVersion = null;
let downloadUrl = null;

// Track recent chat commands for throttling
let twitchRequestLog = [];

function log(message) {
  console.log(message);
  // Send to renderer process for display
  if (mainWindow) mainWindow.webContents.send('log', message);
  
  // Ensure logs directory exists
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch (err) {
      console.error(`Failed to create logs directory: ${err.message}`);
      return;
    }
  }
  
  // Write to log file with timestamp and formatted message
  try {
    const now = new Date();
    const formattedDate = now.toISOString().replace(/T/, ' ').replace(/\..+/, '');
    fs.appendFileSync(path.join(logsDir, `app-${now.toISOString().split('T')[0]}.log`), `[${formattedDate}] ${message}
`);
  } catch (err) {
    console.error(`Failed to write to log file: ${err.message}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 1200,
    title: 'IRLshots',
    autoHideMenuBar: true, // Hide menu bar by default
    frame: true, // Keep the window frame for dragging
    backgroundColor: '#242339', // Match the app's background color
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Remove application menu completely
  mainWindow.setMenu(null);
  
  // Ensure the window title is set correctly
  mainWindow.on('page-title-updated', (event) => {
    // Prevent the default title from being used (usually from HTML)
    event.preventDefault();
    // Force the title to be IRLshots
    mainWindow.setTitle('IRLshots');
  });
  
  // Also set the title after the window is created
  mainWindow.setTitle('IRLshots');
  
  // In production, use the bundled renderer code
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  } else {
    // In development, use the dev server for hot reloading
    // But we'll check if we're running from the compiled executable first
    if (process.env.NODE_ENV === 'development') {
      mainWindow.loadURL('http://localhost:3000');
    } else {
      // If dev but not running through npm script, still use the bundled code
      mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
    }
  }
}

// Check for single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting.');
  app.quit();
} else {
  // We are the first instance - continue initialization
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.webContents.send('log', 'Second instance attempted - focusing this window instead');
    }
  });

  app.whenReady().then(() => {
    createWindow();
    
    // Setup Twitch chat listener
    try {
      if (!fs.existsSync(configPath)) fs.copyFileSync(exampleConfigPath, configPath);
      const startupConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      
      // Start the browser source server
      startBrowserServer(startupConfig);
      
      // Set up Twitch if enabled
      if (startupConfig.twitch && startupConfig.twitch.enabled) {
        const twitchClient = new tmi.Client({ 
          identity: { 
            username: startupConfig.twitch.username, 
            password: startupConfig.twitch.oauthToken 
          }, 
          channels: [startupConfig.twitch.channel] 
        });
        
        twitchClient.connect()
          .then(() => log('Connected to Twitch chat'))
          .catch(err => log('Twitch chat error: ' + err.message));
          
        // Register Twitch chat message handler
        twitchClient.on('message', handleTwitchMessage);
      }
      
      setTimeout(async () => {
        try {
          await checkForUpdates();
        } catch (updateErr) {
          log(`Error during update check: ${updateErr.message}`);
        }
      }, 3000);
    } catch (err) {
      log('Error during startup: ' + err.message);
    }
    
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('load-config', async () => {
  try {
    if (!fs.existsSync(configPath)) {
      fs.copyFileSync(exampleConfigPath, configPath);
    }
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    log('Error loading config: ' + err.message);
    return null;
  }
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    // Log critical parts of the config for debugging
    log(`Saving config: obs=${JSON.stringify(config.obs)}, outputFolder=${config.outputFolder || 'not set'}`);
    
    // Make sure we preserve any existing config values not in the incoming config
    let existingConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (parseErr) {
        log(`Warning: Could not parse existing config: ${parseErr.message}`);
      }
    }
    
    // Merge the new config with existing config, prioritizing the new values
    const mergedConfig = { ...existingConfig, ...config };
    
    // Log the final merged config
    log(`Final merged config - outputFolder: ${mergedConfig.outputFolder}, saveScreenshots: ${mergedConfig.saveScreenshots}`);
    
    // Write the merged config to file
    fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2));
    
    // Confirm the config was actually written correctly
    try {
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      log(`Verification - saved outputFolder: ${savedConfig.outputFolder}`);
    } catch (verifyErr) {
      log(`Warning: Could not verify saved config: ${verifyErr.message}`);
    }
    
    return true;
  } catch (err) {
    log('Error saving config: ' + err.message);
    return false;
  }
});


// Reusable function for capturing a Polaroid snapshot
async function doTakePolaroid(config) {
  const obs = new OBSWebSocket();
  let imageData; // Declare at function scope so it's available throughout the function
  let savedImagePath = null; // Track the saved image path for Discord
  
  try {
    // v5 connection format according to docs
    log(`Connecting to OBS at ws://${config.obs.host}:${config.obs.port}`);
    await obs.connect(`ws://${config.obs.host}:${config.obs.port}`, config.obs.password);
    log('Connected to OBS');
    
    // Log available API calls for debugging
    if (!config.captureSource) {
      log('ERROR: No capture source specified');
      return { success: false, error: 'No capture source specified' };
    }
    log(`Taking screenshot of source: ${config.captureSource}`);
    
    // Use TakeSourceScreenshot API call - log the exact request
    // In OBS WebSocket v5, the API is 'GetSourceScreenshot' not 'TakeSourceScreenshot'
    const requestParams = { 
      sourceName: config.captureSource,
      imageFormat: 'png',
      imageWidth: config.imageWidth || 0,
      imageHeight: config.imageHeight || 0
    };
    log(`Request params: ${JSON.stringify(requestParams)}`);
    
    try {
      // Generate a timestamp for file naming
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      
      // Determine the image path - ensure it's using an absolute path
      let outputFolder;
      
      // Verify the saveScreenshots option is enabled and outputFolder is specified
      if (config.saveScreenshots && config.outputFolder && config.outputFolder.trim() !== '' && config.outputFolder !== 'path/to/output/folder') {
        // Use the folder path selected by the user
        outputFolder = config.outputFolder.trim();
        log(`Using user-configured output folder: ${outputFolder}`);
        
        // Normalize path separators for cross-platform compatibility
        outputFolder = outputFolder.replace(/\\/g, '/');
        
        // Check if the path is absolute
        if (!path.isAbsolute(outputFolder)) {
          // If not absolute, make it relative to the app's path
          outputFolder = path.join(app.getPath('userData'), outputFolder);
          log(`Converted to absolute path: ${outputFolder}`);
        }
      } else {
        // If no valid output folder configured or saving is disabled, use app's user data directory
        outputFolder = path.join(app.getPath('userData'), 'screenshots');
        log(`Using default output folder: ${outputFolder}`);
      }
      
      // Create the directory if it doesn't exist
      try {
        fs.mkdirSync(outputFolder, { recursive: true });
        log(`Ensured output directory exists: ${outputFolder}`);
      } catch (mkdirErr) {
        log(`Error creating output directory: ${mkdirErr.message}`);
        // Fall back to temporary directory if we can't create the output directory
        outputFolder = app.getPath('temp');
        log(`Falling back to temp directory: ${outputFolder}`);
      }
      
      // Define the final image path
      const imagePath = path.join(outputFolder, `polaroid_${timestamp}.png`);
      log(`Using image path: ${imagePath}`);
      
      // Use the correct API call with minimum dimensions required by OBS WebSocket v5
      // Save directly to the final destination instead of a temporary file
      const response = await obs.call('SaveSourceScreenshot', {
        sourceName: config.captureSource,
        imageFormat: 'png',
        imageFilePath: imagePath,
        imageWidth: config.imageWidth || 1280,  // 16:9 aspect ratio - HD resolution
        imageHeight: config.imageHeight || 720  // 16:9 aspect ratio - HD resolution
      });
      
      log(`Screenshot saved directly to: ${imagePath}`);
      savedImagePath = imagePath; // Track the saved path for later use
      
      // Read the saved file and convert to base64 for browser source
      try {
        const imageBuffer = fs.readFileSync(imagePath);
        imageData = imageBuffer.toString('base64');
        log('Image successfully read and converted to base64');
      } catch (readErr) {
        log(`Error reading saved image: ${readErr.message}`);
        throw readErr;
      }
      
      log(`Screenshot response: ${JSON.stringify(response)}`);
      log('Screenshot taken and saved successfully');
    } catch (screenshotErr) {
      log(`Screenshot error: ${screenshotErr.message}`);
      throw screenshotErr;
    }
    
    // Skip template composition - we'll do this in the browser with CSS
    log('Skipping template compositing - using browser-based Polaroid effect');
    
    // Send the image directly to the browser source for display
    // The browser will handle the Polaroid styling with CSS
    if (io && imageData) {
      log('Sending screenshot to browser source');
      io.emit('newSnapshot', { 
        imageData: imageData,
        animationDelay: config.animationDelay || 5000,
        animationDirection: config.animationDirection || 'left',
        timestamp: new Date().toLocaleString()
      });
    } else {
      log('WARNING: WebSocket server not initialized or image data missing, cannot send to browser source');
    }
    
    // Send to Discord if enabled
    // Check both the new config format (sendToDiscord) and legacy format (discord.enabled)
    const discordEnabled = config.sendToDiscord || (config.discord && config.discord.enabled);
    const discordWebhook = config.discordWebhook || (config.discord && config.discord.webhookUrl);
    
    if (discordEnabled && discordWebhook && savedImagePath) {
      try {
        log(`Sending screenshot to Discord webhook (${discordWebhook.substring(0, 30)}...)`);
        // Create a FormData to send the image to Discord
        const formData = new FormData();
        
        // Read the file directly instead of converting from base64 again
        const buffer = fs.readFileSync(savedImagePath);
        
        // Get current time for message template
        const currentTime = new Date().toLocaleString();
        
        // Use custom bot name if provided, otherwise default
        const botName = config.discordBotName || 'IRLshots Bot';
        
        // Use message template if provided, replace {time} placeholder with actual time
        let messageContent = 'New screenshot taken at ' + currentTime;
        if (config.discordMessageTemplate) {
          messageContent = config.discordMessageTemplate.replace('{time}', currentTime);
        }
        
        // Create a payload with the username and content
        const payload = {
          username: botName,
          content: messageContent
        };
        
        log(`Using Discord bot name: ${botName}`);
        log(`Message content: ${messageContent}`);
        
        // Add the payload as part of form-data
        formData.append('payload_json', JSON.stringify(payload));
        
        // Add the file
        formData.append('file', buffer, {
          filename: path.basename(savedImagePath),
          contentType: 'image/png'
        });
        
        // Send to Discord webhook
        await axios.post(discordWebhook, formData, {
          headers: formData.getHeaders()
        });
        
        log('Successfully sent image to Discord');
      } catch (discordErr) {
        log(`Error sending to Discord: ${discordErr.message}`);
      }
    } else if (discordEnabled) {
      log(`Discord enabled but ${!discordWebhook ? 'no webhook URL configured' : 'no saved image path available'}`);
    }
    
    obs.disconnect();
    return { success: true, imageData, imagePath: savedImagePath };
  } catch (err) {
    if (obs) {
      try {
        obs.disconnect();
      } catch (disconnectErr) {
        log(`Error disconnecting from OBS: ${disconnectErr.message}`);
      }
    }
    log('Error in doTakePolaroid: ' + err.message);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('take-polaroid', async (event, config) => {
  try {
    // Read the latest config directly from disk
    log('Reading config directly from disk for taking polaroid');
    let diskConfig = null;
    
    if (fs.existsSync(configPath)) {
      try {
        // Read the raw content first for debugging
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        log(`Raw config file content: ${rawConfig}`);
        
        // Then parse it as JSON
        diskConfig = JSON.parse(rawConfig);
        
        // Log the key values we care about
        log(`Disk config values: outputFolder=${diskConfig.outputFolder}, saveScreenshots=${diskConfig.saveScreenshots}`);
      } catch (parseErr) {
        log(`Error parsing config file: ${parseErr.message}`);
      }
    } else {
      log('Config file does not exist, will use default values');
    }
    
    // Create a fresh config object using disk values with priority
    const effectiveConfig = {};
    
    // Copy all properties from the passed config
    Object.assign(effectiveConfig, config);
    
    // If we have disk config, override with its values
    if (diskConfig) {
      // Explicitly override the critical values
      if (diskConfig.outputFolder && diskConfig.outputFolder !== 'path/to/output/folder') {
        effectiveConfig.outputFolder = diskConfig.outputFolder;
        log(`Using output folder from disk config: ${effectiveConfig.outputFolder}`);
      }
      
      if (diskConfig.saveScreenshots !== undefined) {
        effectiveConfig.saveScreenshots = diskConfig.saveScreenshots;
      }
    }
    
    log(`Final effective output folder: ${effectiveConfig.outputFolder}`);
    log(`Final effective saveScreenshots: ${effectiveConfig.saveScreenshots}`);
    
    return doTakePolaroid(effectiveConfig);
  } catch (err) {
    log(`Error in take-polaroid handler: ${err.message}`);
    // Fallback to passed config if disk read fails
    return doTakePolaroid(config);
  }
});

// Reusable function for test animation
async function doTestAnimation(config) {
  try {
    // Generate a test pattern
    log('Creating test image for browser source');
    
    // Create a simple colored rectangle as test image
    const width = config.imageWidth || 800;
    const height = config.imageHeight || 600;
    
    // Create a new Jimp image with blue background
    const image = new Jimp(width, height, 0x3498dbff); // Blue color
    
    // Add some text using Jimp
    const font = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    await image.print(font, width/2 - 150, height/2 - 50, 'Test Image');
    await image.print(font, width/2 - 150, height/2 + 20, new Date().toLocaleString());
    
    // Convert to base64
    const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    const base64Data = buffer.toString('base64');
    
    // Send to browser source
    if (io) {
      log('Sending test image to browser source');
      io.emit('testAnimation', { 
        imageData: base64Data,
        animationDelay: config.animationDelay || 5000,
        animationDirection: config.animationDirection || 'left'
      });
      return { success: true };
    } else {
      throw new Error('WebSocket server not initialized');
    }
  } catch (err) {
    log('Test animation error: ' + err.message);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('test-animation', (event, config) => doTestAnimation(config));

// connect to OBS and list sources
ipcMain.handle('connect-obs', async (event, config) => {
  const obs = new OBSWebSocket();
  try {
    log('Connect OBS handler called with config');
    await obs.connect(`ws://${config.obs.host}:${config.obs.port}`, config.obs.password);
    log(`Connected to OBS at ${config.obs.host}:${config.obs.port}`);
    
    // Get scenes list
    const { scenes } = await obs.call('GetSceneList');
    log(`Found ${scenes.length} scenes`);
    
    // Get list of inputs (sources) that can be captured
    const { inputs } = await obs.call('GetInputList');
    log(`Found ${inputs.length} inputs`);
    
    // Get all scene items to map sources to scenes
    const sourcesByScene = {};
    const enhancedSources = [];
    
    // Process scenes and their items
    for (const scene of scenes) {
      try {
        const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: scene.sceneName });
        
        // Add scene items to the scene map
        sceneItems.forEach(item => {
          const sourceName = item.sourceName;
          const sourceType = item.sourceType;
          
          enhancedSources.push({
            name: sourceName,
            type: sourceType,
            scene: scene.sceneName
          });
        });
      } catch (sceneErr) {
        log(`Error getting items for scene ${scene.sceneName}: ${sceneErr.message}`);
      }
    }
    
    // Add inputs that may not be in scenes
    inputs.forEach(input => {
      if (!enhancedSources.some(source => source.name === input.inputName)) {
        enhancedSources.push({
          name: input.inputName,
          type: 'OBS_SOURCE_TYPE_INPUT',
          inputKind: input.inputKind
        });
      }
    });
    
    log(`Processed ${enhancedSources.length} total sources with scene information`);
    
    return {
      scenes,
      sources: enhancedSources
    };
  } catch (err) {
    log(`OBS connection error: ${err.message}`);
    throw err;
  }
});

// File/folder pickers for renderer
ipcMain.handle('select-template', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  return canceled ? null : filePaths[0];
});

// Handler for selecting output folder - with enhanced logging
ipcMain.handle('select-output-folder', async () => {
  try {
    // Log current config for debugging
    const currentConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
    log(`Current config before folder selection: outputFolder=${currentConfig.outputFolder}, saveScreenshots=${currentConfig.saveScreenshots}`);
    
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Output Folder for Saved Images'
    });
    
    if (canceled) {
      log('Folder selection canceled');
      return null;
    }
    
    const selectedFolder = filePaths[0];
    log(`Folder selected: ${selectedFolder}`);
    
    // Update config immediately to ensure it's saved
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.outputFolder = selectedFolder;
      config.saveScreenshots = true;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      log(`Config file updated directly with new outputFolder: ${selectedFolder}`);
    }
    
    return selectedFolder;
  } catch (err) {
    log(`Error in select-output-folder: ${err.message}`);
    return null;
  }
});

// Debug handler to check config file content
ipcMain.handle('debug-config', async () => {
  try {
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      log(`Current config file content: ${configContent}`);
      return JSON.parse(configContent);
    } else {
      log('Config file does not exist');
      return null;
    }
  } catch (err) {
    log(`Error reading config: ${err.message}`);
    return { error: err.message };
  }
});

// Update checking and installation handlers
ipcMain.handle('check-for-updates', async () => {
  try {
    const result = await checkForUpdates();
    return {
      updateAvailable: updateAvailable,
      currentVersion: APP_VERSION,
      latestVersion: latestVersion,
      downloadUrl: downloadUrl
    };
  } catch (err) {
    log(`Error in check-for-updates handler: ${err.message}`);
    return { updateAvailable: false, error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    return await downloadAndInstallUpdate();
  } catch (err) {
    log(`Error in download-update handler: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return { version: APP_VERSION };
});

// Handle Twitch chat messages
async function handleTwitchMessage(channel, userstate, message, self, config) {
  if (self) return;

  // Get the current config
  const startupConfig = config || JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  // Get the configured command without any ! prefix for consistency
  const configuredCommand = startupConfig.twitch.command.replace(/^!+/, '');
  // Extract the actual command from the message
  const messageCommand = message.trim().split(' ')[0].replace(/^!+/, '');
  
  // Check if the command matches (case insensitive)
  if (messageCommand.toLowerCase() === configuredCommand.toLowerCase()) {
    // Check for request throttling to prevent spam
    const now = Date.now();
    const recentRequests = twitchRequestLog.filter(time => now - time < 10000); // Last 10 seconds
    
    if (recentRequests.length >= 3) {
      // Too many requests in the past 10 seconds, throttle
      log(`Throttling !${configuredCommand} from ${userstate.username} - too many recent requests (${recentRequests.length})`);
      return;
    }
    
    // Add current request to the log
    twitchRequestLog.push(now);
    // Keep only recent requests in the log
    twitchRequestLog = twitchRequestLog.filter(time => now - time < 60000);
    
    // Check user permission based on config setting
    const permissions = startupConfig.twitch.permissions || { everyone: true };
    let hasPermission = false;
    
    // Check if user has permission based on their badges
    if (permissions.everyone) {
      hasPermission = true;
    } else {
      const hasBroadcasterBadge = userstate.badges && userstate.badges.broadcaster === '1';
      const hasModeratorBadge = userstate.badges && userstate.badges.moderator === '1';
      const hasVipBadge = userstate.badges && userstate.badges.vip === '1';
      const hasSubscriberBadge = userstate.badges && userstate.badges.subscriber !== undefined;
      
      hasPermission = 
        (permissions.broadcaster && hasBroadcasterBadge) ||
        (permissions.moderator && (hasModeratorBadge || hasBroadcasterBadge)) ||
        (permissions.vip && (hasVipBadge || hasModeratorBadge || hasBroadcasterBadge)) ||
        (permissions.subscriber && (hasSubscriberBadge || hasVipBadge || hasModeratorBadge || hasBroadcasterBadge));
    }
    
    if (hasPermission) {
      log(`Chat command !${configuredCommand} triggered by ${userstate.username} (${userstate.badges ? Object.keys(userstate.badges).join(', ') : 'no badges'})`);
      await doTakePolaroid(startupConfig);
    }
  }
}

// Browser source HTTP+WebSocket server
function startBrowserServer(config) {
  const expApp = express();
  const server = http.createServer(expApp);
  io = require('socket.io')(server, { cors: { origin: '*' } });
  expApp.use(express.static(path.join(__dirname, '../public/browser')));
  const port = config.wsPort || 3456;
  server.listen(port, () => log(`Browser Source Server listening on http://localhost:${port}`));
}

// This duplicate code has been removed and merged into the main app.whenReady() handler above

async function checkForUpdates() {
  try {
    log('Checking for updates...');
    
    const response = await axios.get(VERSION_CHECK_URL);
    const fetchedVersion = response.data.trim();
    latestVersion = fetchedVersion;
    
    log(`Current version: ${APP_VERSION}, Latest version: ${fetchedVersion}`);
    
    if (fetchedVersion !== APP_VERSION) {
      updateAvailable = true;
      
      try {
        const githubResponse = await axios.get(GITHUB_API_URL);
        if (githubResponse.data?.assets?.length > 0) {
          let assetName;
          
          if (process.platform === 'win32') {
            assetName = githubResponse.data.assets.find(asset => asset.name.endsWith('.exe'));
          } else if (process.platform === 'darwin') {
            assetName = githubResponse.data.assets.find(asset => asset.name.endsWith('.dmg'));
          } else if (process.platform === 'linux') {
            assetName = githubResponse.data.assets.find(asset => asset.name.endsWith('.AppImage'));
          }
          
          if (assetName) {
            downloadUrl = assetName.browser_download_url;
            log(`Download URL for update: ${downloadUrl}`);
          } else {
            downloadUrl = GITHUB_RELEASES_URL;
            log('No specific download asset found, using releases page URL');
          }
        } else {
          downloadUrl = GITHUB_RELEASES_URL;
        }
      } catch (githubErr) {
        log(`Error getting GitHub release info: ${githubErr.message}`);
        downloadUrl = GITHUB_RELEASES_URL;
      }
      
      if (mainWindow) {
        mainWindow.webContents.send('update-available', {
          currentVersion: APP_VERSION,
          newVersion: fetchedVersion,
          downloadUrl: downloadUrl
        });
      }
      
      log(`Update available: ${fetchedVersion}`);
      return true;
    } else {
      log('Application is up-to-date');
      return false;
    }
  } catch (error) {
    log(`Error checking for updates: ${error.message}`);
    return false;
  }
}

async function downloadAndInstallUpdate() {
  try {
    if (!updateAvailable || !downloadUrl) {
      log('No update available to download');
      return { success: false, message: 'No update available' };
    }
    
    log(`Opening download URL: ${downloadUrl}`);
    await shell.openExternal(downloadUrl);
    
    return { success: true, message: 'Update download started in browser' };
  } catch (error) {
    log(`Error downloading update: ${error.message}`);
    return { success: false, message: `Error: ${error.message}` };
  }
}