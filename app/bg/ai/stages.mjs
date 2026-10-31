// The kinds of AI turn (ADR-0021). A turn's stage decides what it may do.
//   page    — a page's nomad.ai.chat(), on desktop or on the phone. Only its own Drive; never personal.
//   sidebar — the desktop AI Sidebar. The user's own AI, with the tab the user is on, looked up live.
//   phone   — the phone's AI panel over the AI Bridge. The user's own AI, with a snapshot of the
//             phone's tab from when the user sent the message.
//   outside — another program on this machine, through the loopback MCP (callLocalTool). The user's
//             own AI, on the focused tab.
//   job     — one of the user's AI Jobs, run by this Device on its schedule or by hand (ADR-0030). The
//             user's own AI with no tab and nobody watching. It reads, and changes only what the user
//             granted the Job (search-execute.mjs jobCapabilities).
//
// `secrets`: the turn may use the user's secrets by name (ADR-0033): the sidebar and the phone after
// asking, a Job with the user's grant. Never a page's turn, and never another program through the
// loopback MCP.

const RULES = {
  page: { personal: false, tab: false, secrets: false },
  sidebar: { personal: true, tab: true, secrets: true },
  phone: { personal: true, tab: true, secrets: true },
  outside: { personal: true, tab: false, secrets: false },
  job: { personal: true, tab: false, secrets: true },
}

export function stageRules(stage) {
  return RULES[stage] || RULES.page
}

// The stage of a turn that came over the AI Bridge. The phone sends `personal` for its AI panel. A
// remote Device can't claim any other stage.
export function remoteStage(personal) {
  return personal === true ? 'phone' : 'page'
}

// The phone's tab, as it came over the Bridge: a url and a title, and nothing else.
export function tabSnapshot(tab) {
  if (!tab || typeof tab !== 'object' || typeof tab.url !== 'string' || !tab.url) return null
  return {
    url: tab.url.slice(0, 2048),
    title: typeof tab.title === 'string' ? tab.title.slice(0, 300) : '',
  }
}

// The drive a drive tool works on. `drive` is the model's argument, and `resolve` turns a name or a
// URL into a hyper:// URL (hyper/names.js). `own` is the drive a call uses without `drive`: a page's
// own Drive, or the drive in the user's current tab. With a tab (the user's own assistant), a write
// must name its drive, so a tab switch in the middle of a turn can't move the write. `current` says
// whether the drive is `own`.
export function pickToolDrive({ drive, write = false, personal = false, hasTab = false, own = null, resolve }) {
  if (drive == null || drive === '') {
    if (hasTab && write) {
      throw new Error("Name the drive to write to: pass `drive`, the drive that currentTab gives or one of the user's names.")
    }
    if (!hyperHost(own)) {
      throw new Error(
        hasTab
          ? "No drive is open in the user's current tab. Pass `drive`: one of the user's names or a hyper:// URL."
          : 'Not browsing a Drive'
      )
    }
    return { url: own, current: true }
  }
  if (!personal) throw new Error('Only the current Drive is available here')
  const url = resolve(drive)
  return { url, current: sameDrive(own, url) }
}

// Whether two hyper:// URLs are in the same drive.
export function sameDrive(a, b) {
  return !!hyperHost(a) && hyperHost(a) === hyperHost(b)
}

function hyperHost(url) {
  const m = /^hyper:\/\/([^/?#]+)/i.exec(typeof url === 'string' ? url : '')
  return m ? m[1].toLowerCase() : null
}
