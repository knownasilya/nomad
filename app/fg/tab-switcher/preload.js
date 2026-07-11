const { ipcRenderer } = require('electron');

// exposes the one call the tab-switcher page needs: commit the current
// selection immediately (used by click-to-switch)
window.commitSelection = () => ipcRenderer.send('tab-switcher:commit');
