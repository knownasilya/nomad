import { ipcRenderer } from 'electron';
import { setup as setupWebAPIs } from '../../bg/web-apis/fg';
import { setupModelContext } from './model-context';
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

setupWebAPIs();
setupModelContext();
setupPrompt();
setupExecuteJavascript();

window.addEventListener('focus', (e) => {
  // track focus
  ipcRenderer.send('NOMAD_WC_FOCUSED');
});
