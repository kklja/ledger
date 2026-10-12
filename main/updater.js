'use strict';
// Auto-updates from GitHub Releases. New versions download in the background; if Ledger is
// sitting in the tray (window hidden, nothing running) the update installs right away and
// Ledger comes back hidden, otherwise it installs on the next restart or via "Restart now".

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CHECK_EVERY = 2 * 3600e3;

function initUpdater({ onStatus, notify, isIdle }) {
  if (!app.isPackaged) {
    onStatus({ state: 'dev' });
    return { check: async () => onStatus({ state: 'dev' }), install: () => {} };
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  let ready = null;
  const flag = path.join(app.getPath('userData'), 'relaunch-hidden');

  const install = (hidden = false) => {
    if (!ready) return;
    try { if (hidden) fs.writeFileSync(flag, '1'); } catch {}
    app.isQuitting = true;
    autoUpdater.quitAndInstall(true, true); // silent installer, relaunch afterwards
  };

  autoUpdater.on('checking-for-update', () => onStatus({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => onStatus({ state: 'current', checked: new Date().toISOString() }));
  autoUpdater.on('update-available', (info) => onStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => onStatus({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('error', (e) => onStatus({ state: 'error', error: String(e && e.message || e).split('\n')[0].slice(0, 200) }));
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version;
    onStatus({ state: 'ready', version: info.version });
    if (isIdle()) install(true);
    else notify('Ledger update ready', `Version ${info.version} installs when you restart Ledger.`);
  });

  const check = () => autoUpdater.checkForUpdates().catch((e) => onStatus({ state: 'error', error: String(e.message || e).slice(0, 200) }));
  setTimeout(check, 10000);
  setInterval(() => {
    if (ready && isIdle()) install(true); // ready but you were busy earlier: install once idle
    else check();
  }, CHECK_EVERY);
  return { check, install: () => install(false) };
}

// True once, right after an update that was installed while Ledger was hidden in the tray.
function consumeRelaunchHidden() {
  const flag = path.join(app.getPath('userData'), 'relaunch-hidden');
  if (!fs.existsSync(flag)) return false;
  try { fs.unlinkSync(flag); } catch {}
  return true;
}

module.exports = { initUpdater, consumeRelaunchHidden };
