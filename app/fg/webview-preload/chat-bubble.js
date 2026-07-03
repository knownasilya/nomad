import { ipcRenderer } from 'electron';

export async function setupChatBubble() {
  // Only run on hyper:// drives
  if (!window.location.href.startsWith('hyper://')) return;

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
  }

  // Read /index.json from the current drive
  let index;
  try {
    const res = await fetch('/index.json');
    if (res.ok) index = await res.json();
  } catch {
    return;
  }

  if (!index?.chatBubble) return;

  ipcRenderer.send('NOMAD_INJECT_CHAT_BUBBLE');
}
