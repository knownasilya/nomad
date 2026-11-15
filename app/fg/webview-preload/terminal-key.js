import { ipcRenderer } from 'electron';

// ~ on a page of a drive the user can edit opens the drive terminal under it, or closes it (as
// Developer → Toggle Terminal, Ctrl+`, does). Not while typing in a field, and only on hyper://
// pages: bg checks that the drive is the user's to edit (manager.js `nomad-terminal:toggle`).
export function setupTerminalKey() {
  if (location.protocol !== 'hyper:') return;
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== '~' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing) return;
      if (e.defaultPrevented || typingIn(e)) return;
      ipcRenderer.send('nomad-terminal:toggle');
    },
    true
  );
}

function typingIn(e) {
  for (const el of e.composedPath()) {
    if (!el || el.nodeType !== 1) continue;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    const role = el.getAttribute && el.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  }
  return false;
}
