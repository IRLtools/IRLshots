import React, { useContext, useState } from 'react';
import { AppContext } from '../../contexts/AppContext';
import { LanguageContext } from '../../contexts/LanguageContext';
import { Input, Toggle, Button, Select } from '../common/StyledInputs';

const SettingsTab = () => {
  const { config, updateConfig, saveConfig, reloadConfig, appVersion, updateInfo, checkForUpdates, downloadUpdate } = useContext(AppContext);
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const { t, changeLanguage, getAvailableLanguages } = useContext(LanguageContext);
  
  const selectOutputFolder = async () => {
    try {
      const folderPath = await window.api.selectOutputFolder();
      console.log('Folder selection result:', folderPath);
      
      if (folderPath) {
        const updatedConfig = JSON.parse(JSON.stringify(config));
        updatedConfig.outputFolder = folderPath;
        updatedConfig.saveScreenshots = true;
        
        updateConfig('outputFolder', folderPath);
        updateConfig('saveScreenshots', true);
        
        const saveResult = await saveConfig(updatedConfig);
        
        if (saveResult) {
          window.api.onLog(`Success: Output folder set to: ${folderPath}`);
          await reloadConfig();
          
          if (window.api.debugConfig) {
            try {
              const verifyConfig = await window.api.debugConfig();
              window.api.onLog(`Verified config - outputFolder: ${verifyConfig.outputFolder}`);
            } catch (verifyErr) {
              console.error('Error verifying config:', verifyErr);
            }
          }
        } else {
          window.api.onLog('Warning: Config save may have failed');
          await reloadConfig();
        }
      } else {
        console.log('Folder selection canceled or no folder selected');
      }
    } catch (error) {
      console.error('Error in selectOutputFolder:', error);
      window.api.onLog(`Error selecting output folder: ${error.message || error}`);
      
      try {
        await reloadConfig();
      } catch (reloadErr) {
        console.error('Error reloading config:', reloadErr);
      }
    }
  };
  
  // Handle language change
  const handleLanguageChange = async (lang) => {
    console.log(`SettingsTab: Switching language to ${lang}`);
    // First update the config
    updateConfig('language', lang);
    // Then change the UI language
    const success = changeLanguage(lang);
    console.log(`Language change success: ${success}`);
    // Force an immediate save of the config
    await window.api.saveConfig(config);
    window.api.onLog(`Language changed to ${lang}. App restart may be required.`);
  };
  
  // Get available languages for dropdown
  const languageOptions = Object.entries(getAvailableLanguages()).map(([code, name]) => ({
    value: code,
    label: name
  }));

  const handleCheckForUpdates = async () => {
    setCheckingForUpdates(true);
    try {
      await checkForUpdates();
    } catch (error) {
      console.error('Error checking for updates:', error);
    } finally {
      setCheckingForUpdates(false);
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      await downloadUpdate();
    } catch (error) {
      console.error('Error downloading update:', error);
    }
  };

  return (
    <div className="bg-[rgba(17,24,39,0.4)] rounded-2xl shadow-md p-8 border border-gray-800 backdrop-blur-sm hover:shadow-lg transition-all duration-300 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent pointer-events-none"></div>
      <div className="relative z-10">
        <h2 className="text-2xl font-bold mb-6 text-white flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[#60a5fa]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {t('settingsTab.title')}
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Image Settings */}
          <div className="bg-[rgba(17,24,39,0.3)] p-4 rounded-xl border border-gray-800">
            <h3 className="text-lg font-semibold mb-4 text-white">{t('settingsTab.imageSettings')}</h3>
            <div className="space-y-4">
              <Input
                label={t('settingsTab.imageWidth')}
                type="number"
                value={config.imageWidth || 1280}
                onChange={e => updateConfig('imageWidth', parseInt(e.target.value) || 1920)}
              />
              
              <Input
                label={t('settingsTab.imageHeight')}
                type="number"
                value={config.imageHeight || 720}
                onChange={e => updateConfig('imageHeight', parseInt(e.target.value) || 1080)}
              />
              
              <Toggle
                label={t('settingsTab.saveScreenshots')}
                checked={config.saveScreenshots || false}
                onChange={e => updateConfig('saveScreenshots', e.target.checked)}
              />
              
              {/* Output Folder Selection */}
              <div className="mt-3">
                <label className="block text-sm font-medium mb-2 text-gray-300">
                  {t('settingsTab.outputFolder')}
                </label>
                <div className="flex items-center gap-2">
                  <input 
                    type="text"
                    value={config.outputFolder || ''}
                    readOnly
                    className="flex-grow px-4 py-2 bg-gray-900/50 border border-gray-700 rounded-lg shadow-sm text-white"
                  />
                  <Button
                    onClick={selectOutputFolder}
                    variant="secondary"
                    className="whitespace-nowrap"
                  >
                    {t('settingsTab.selectFolder')}
                  </Button>
                </div>
                {!config.outputFolder && (
                  <p className="text-amber-400 text-xs mt-1">
                    {t('settingsTab.selectFolderHint')}
                  </p>
                )}
              </div>
              
              {/* Debug button - only in development */}
              {process.env.NODE_ENV === 'development' && (
                <Button
                  onClick={async () => {
                    try {
                      const configData = await window.api.debugConfig();
                      window.api.onLog(`Debug config: ${JSON.stringify(configData)}`);
                    } catch (err) {
                      window.api.onLog(`Error debugging config: ${err.message}`);
                    }
                  }}
                  variant="danger"
                  className="mt-2"
                >
                  Debug Config
                </Button>
              )}
              
              <Input
                label={t('settingsTab.animationDelay')}
                type="number"
                value={config.animationDelay || 5000}
                onChange={e => updateConfig('animationDelay', parseInt(e.target.value) || 5000)}
              />
            </div>
          </div>
          
          {/* Other Settings */}
          <div className="space-y-6">
            {/* Discord Settings */}
            <div className="bg-[rgba(17,24,39,0.3)] p-4 rounded-xl border border-gray-800">
              <h3 className="text-lg font-semibold mb-4 text-white">{t('settingsTab.discordSettings')}</h3>
              <div className="space-y-4">
                <Toggle
                  label={t('settingsTab.sendToDiscord')}
                  checked={config.sendToDiscord || false}
                  onChange={e => updateConfig('sendToDiscord', e.target.checked)}
                />
                
                {config.sendToDiscord && (
                  <>
                    <Input
                      label={t('settingsTab.discordWebhook')}
                      type="text"
                      value={config.discordWebhook || ''}
                      onChange={e => updateConfig('discordWebhook', e.target.value)}
                    />
                    
                    <Input
                      label={t('settingsTab.discordBotName') || 'Discord Bot Name'}
                      type="text"
                      value={config.discordBotName || 'IRLshots Bot'}
                      onChange={e => updateConfig('discordBotName', e.target.value)}
                      placeholder="IRLshots Bot"
                    />
                    
                    <Input
                      label={t('settingsTab.discordMessageTemplate') || 'Message Template'}
                      type="text"
                      value={config.discordMessageTemplate || 'New screenshot taken at {time}'}
                      onChange={e => updateConfig('discordMessageTemplate', e.target.value)}
                      placeholder="New screenshot taken at {time}"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {t('settingsTab.discordMessageHelp') || 'Use {time} to include timestamp in message'}
                    </p>
                  </>
                )}
              </div>
            </div>
            
            {/* Browser Source Settings */}
            <div className="bg-[rgba(17,24,39,0.3)] p-4 rounded-xl border border-gray-800">
              <h3 className="text-lg font-semibold mb-4 text-white">{t('settingsTab.browserSource')}</h3>
              <div className="space-y-4">
                <Input
                  label={t('settingsTab.wsPort')}
                  type="number"
                  value={config.wsPort || 3456}
                  onChange={e => updateConfig('wsPort', parseInt(e.target.value) || 3456)}
                />
              </div>
            </div>
            
            {/* Language Settings */}
            <div className="bg-[rgba(17,24,39,0.3)] p-4 rounded-xl border border-gray-800">
              <h3 className="text-lg font-semibold mb-4 text-white">{t('settingsTab.language')}</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    {t('settingsTab.language')}
                  </label>
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      variant={config.language === 'en' ? 'primary' : 'secondary'}
                      onClick={() => handleLanguageChange('en')}
                    >
                      English
                    </Button>
                    <Button
                      variant={config.language === 'ja' ? 'primary' : 'secondary'}
                      onClick={() => handleLanguageChange('ja')}
                    >
                      日本語
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        // Force reset language to English
                        localStorage.setItem('irl-language', 'en');
                        updateConfig('language', 'en');
                        window.api.saveConfig({...config, language: 'en'});
                        window.location.reload();
                      }}
                    >
                      Reset to English
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-amber-400">{t('settingsTab.restartRequired')}</p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Version Info */}
        <div className="bg-[rgba(17,24,39,0.3)] p-4 rounded-xl border border-gray-800 mt-6">
          <h3 className="text-lg font-semibold mb-4 text-white flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
            {t('settingsTab.versionInfo')}
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-300">{t('settingsTab.currentVersion')}:</span>
              <span className="text-white font-semibold bg-gray-800 px-3 py-1 rounded-lg">{appVersion}</span>
            </div>
            
            {updateInfo && updateInfo.updateAvailable && (
              <div className="bg-yellow-900/40 border border-yellow-700 rounded-lg p-3 text-yellow-200 text-sm flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p>{t('settingsTab.updateAvailable')}: {updateInfo.latestVersion}</p>
                </div>
                <Button onClick={handleDownloadUpdate} variant="warning" className="w-full">
                  <div className="flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {t('settingsTab.downloadUpdate')}
                  </div>
                </Button>
              </div>
            )}
            
            <div className="flex gap-2">
              <Button 
                onClick={handleCheckForUpdates} 
                variant="secondary" 
                className="flex-1 flex items-center justify-center gap-2"
                disabled={checkingForUpdates}
              >
                {checkingForUpdates ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('settingsTab.checking')}
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {t('settingsTab.checkForUpdates')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
        
        <div className="mt-6 text-center">
          <Button onClick={() => saveConfig()} variant="primary">
            {t('settingsTab.saveSettings')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;
