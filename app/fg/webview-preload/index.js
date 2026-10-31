import { ipcRenderer } from 'electron';
import { setup as setupWebAPIs } from '../../bg/web-apis/fg';
import { setupModelContext } from './model-context';
import { setupHighlights } from './highlights';
import { setupMods } from './mods';
import { setupPageControl } from './page-control';
import { setup as setupPrompt } from './prompt';
import { setup as setupExecuteJavascript } from './execute-javascript';
import setupExitFullScreenHackfix from './exit-full-screen-hackfix';
// import readableStreamAsyncIteratorPolyfill from './readable-stream-async-iterator-polyfill'
import windowOpenCloseHackfix from './window-open-close-hackfix';
import resizeHackfix from './resize-hackfix';

// HACKS
setupExitFullScreenHackfix();
// readableStreamAsyncIteratorPolyfill()
windowOpenCloseHackfix();
resizeHackfix();

// First, so a Mod's styles are in before the page paints.
setupMods();
setupWebAPIs();
setupModelContext();
setupHighlights();
setupPageControl();
setupPrompt();
setupExecuteJavascript();

window.addEventListener('focus', (e) => {
  // track focus
  ipcRenderer.send('NOMAD_WC_FOCUSED');
});
