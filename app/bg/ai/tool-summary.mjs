// Plain words for what the AI is doing right now, one line per search, execute or capability
// call. The AI Sidebar and the phone's AI panel show them as the turn's steps. A CLI runtime
// names Nomad's MCP tools mcp__nomad__search and mcp__nomad__execute, so that prefix goes first.

// What each capability does, for an execute module that calls it: "Running code to read a file".
const PURPOSES = {
  readDriveFile: 'read a file',
  listDriveFiles: 'list files',
  writeDriveFile: 'write a file',
  fetchUrl: 'fetch a web page',
  currentTab: 'check your current tab',
  readCurrentPage: 'read this page',
  screenshotCurrentPage: 'take a screenshot of this page',
  openTab: 'open a tab',
  listNotes: 'look through your Notes',
  readNote: 'read a Note',
  writeNote: 'save a Note',
  highlightText: 'highlight text on this page',
  listReaderPosts: 'look through Reader',
  readReaderPost: 'read a Reader post',
  followFeed: 'follow a feed',
  unfollowFeed: 'unfollow a feed',
  markPostsRead: 'mark posts as read',
};

// search's domains, as a place to search in and as a list to show.
const DOMAINS = {
  capability: { place: 'what the assistant can do', list: 'Listing what the assistant can do' },
  guide: { place: 'the API guides', list: 'Listing the API guides' },
  page: { place: "this page's tools", list: "Listing this page's tools" },
  drive: { place: 'public drives', list: 'Listing public drives' },
  name: { place: 'your names', list: 'Listing your names' },
};

export function toolSummary(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  const tool = String(name || '').replace(/^mcp__nomad__/, '');
  if (tool.startsWith('page_')) return `Using this page's ${tool.slice(5)} tool`;
  switch (tool) {
    case 'search':
      return searchSummary(a);
    case 'execute':
      return executeSummary(a.code);
    case 'readDriveFile':
      return `Reading ${inDrive(a.path || 'a file', a.drive)}`;
    case 'listDriveFiles':
      return `Listing the files in ${inDrive(a.path || '/', a.drive)}`;
    case 'writeDriveFile':
      return `Writing ${inDrive(a.path || 'a file', a.drive)}`;
    case 'fetchUrl':
      return a.url ? `Fetching ${a.url}` : 'Fetching a web page';
    case 'currentTab':
      return 'Checking which tab you are on';
    case 'readCurrentPage':
      return 'Reading this page';
    case 'screenshotCurrentPage':
      return 'Taking a screenshot of this page';
    case 'openTab': {
      const where = a.group ? ` in the group ${quote(a.group)}` : '';
      return a.url ? `Opening ${a.url} in a new tab${where}` : `Opening a new tab${where}`;
    }
    case 'listNotes':
      return a.query ? `Looking in your Notes for ${quote(a.query)}` : 'Listing your Notes';
    case 'readNote':
      return a.title ? `Reading the Note ${quote(a.title)}` : 'Reading a Note';
    case 'writeNote': {
      const title = firstLine(a.body);
      return title ? `Saving the Note ${quote(title)}` : 'Saving a Note';
    }
    case 'highlightText': {
      const what = a.text ? quote(a.text) : 'text on this page';
      return a.note ? `Highlighting ${what} and adding a Note` : `Highlighting ${what}`;
    }
    case 'listReaderPosts':
      if (a.query) return `Looking in Reader for ${quote(a.query)}`;
      return a.unread ? 'Checking Reader for unread posts' : 'Checking Reader';
    case 'readReaderPost':
      return 'Reading a Reader post';
    case 'followFeed':
      return a.url ? `Following ${a.url}` : 'Following a feed';
    case 'unfollowFeed':
      return a.url ? `Unfollowing ${a.url}` : 'Unfollowing a feed';
    case 'markPostsRead': {
      const n = Array.isArray(a.urls) ? a.urls.length : 0;
      return n ? `Marking ${n} post${n === 1 ? '' : 's'} as read` : 'Marking posts as read';
    }
    default:
      return tool ? `Using ${tool}` : 'Working…';
  }
}

function searchSummary(a) {
  if (a.entity != null) {
    const refs = (Array.isArray(a.entity) ? a.entity : [a.entity]).filter((r) => typeof r === 'string');
    if (refs.length === 1) return refSummary(refs[0]);
    if (refs.length > 1) return `Looking up ${listOf(refs.map((r) => r.slice(r.indexOf(':') + 1)))}`;
  }
  const domain = DOMAINS[a.domain];
  if (a.query) return `Searching ${domain ? domain.place + ' ' : ''}for ${quote(a.query)}`;
  return domain ? domain.list : 'Looking at what the assistant can do';
}

// An entity ref is <domain>:<id>, e.g. guide:nomad.fs or capability:readDriveFile.
function refSummary(ref) {
  const i = ref.indexOf(':');
  const id = ref.slice(i + 1);
  switch (i > 0 ? ref.slice(0, i) : '') {
    case 'guide':
      return `Reading the guide to ${id}`;
    case 'capability':
      return PURPOSES[id] ? `Looking up how to ${PURPOSES[id]}` : `Looking up ${id}`;
    case 'page':
      return `Looking up this page's ${id} tool`;
    case 'drive':
      return `Looking up the drive ${id}`;
    case 'name':
      return `Looking up the name ${quote(id)}`;
    default:
      return `Looking up ${ref}`;
  }
}

// An execute module calls capabilities as nomad.<name>(…) and page tools as nomad.page.<name>(…).
function executeSummary(code) {
  const purposes = [];
  for (const m of String(code || '').matchAll(/\bnomad\.(page\.)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    const purpose = m[1] ? `use this page's ${m[2]} tool` : PURPOSES[m[2]] || `use ${m[2]}`;
    if (!purposes.includes(purpose)) purposes.push(purpose);
  }
  return purposes.length ? `Running code to ${listOf(purposes)}` : 'Running code';
}

function inDrive(path, drive) {
  if (!drive) return path;
  const key = /^hyper:\/\/([0-9a-f]{64})/i.exec(drive);
  return `${path} in ${key ? `hyper://${key[1].slice(0, 6)}…` : String(drive).replace(/\/+$/, '')}`;
}

function firstLine(text) {
  const line = String(text || '')
    .split('\n')
    .find((l) => l.trim());
  return line ? line.replace(/^#+\s*/, '').trim() : '';
}

function quote(text) {
  const s = String(text).trim();
  return `“${s.length > 60 ? s.slice(0, 59) + '…' : s}”`;
}

function listOf(items) {
  if (items.length < 2) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
