// Which tab a shell-level agent is talking about. The sidebar and the loopback
// MCP server both use this, so a local editor and the sidebar see the same Drive.

import { BrowserWindow } from 'electron'
import { getActive } from '../ui/tabs/manager'

export function isAgentHostApp(url) {
  return typeof url === 'string' && (url.startsWith('nomad://editor') || url.startsWith('nomad://explorer'))
}

export async function callAgentHost(pane, expr) {
  try {
    return await pane.webContents.executeJavaScript(expr)
  } catch {
    return undefined
  }
}

// { url, writable }. Editor and explorer tabs are nomad:// apps, so the Drive
// they have open comes from the app, not from the tab URL.
export async function resolveActiveDrive(pane) {
  if (!pane) return { url: null, writable: false }
  if (isAgentHostApp(pane.url)) {
    const info = await callAgentHost(
      pane,
      'window.__nomadAiHost && window.__nomadAiHost.getAgentDrive && window.__nomadAiHost.getAgentDrive()'
    )
    return { url: info?.url || null, writable: !!info?.writable }
  }
  if (typeof pane.url === 'string' && pane.url.startsWith('hyper://')) {
    return { url: pane.url, writable: !!pane.writable }
  }
  return { url: null, writable: false }
}

export function focusedPane() {
  const focused = BrowserWindow.getFocusedWindow()
  const windows = []
  if (focused && !focused.isDestroyed()) windows.push(focused)
  for (const candidate of BrowserWindow.getAllWindows()) {
    if (candidate && !candidate.isDestroyed() && candidate !== focused) windows.push(candidate)
  }
  for (const win of windows) {
    const pane = getActive(win)?.primaryPane
    if (pane) return pane
  }
  return null
}
