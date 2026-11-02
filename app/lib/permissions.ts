const isDriveRegex = /^[a-z0-9]{64}/i;

export const PERMS = {
  js: {
    persist: true,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: true,
    experimental: false,
  },
  network: {
    persist: true,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: true,
    experimental: false,
  },
  createDrive: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  modifyDrive: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  deleteDrive: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  tagDrive: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  listDrives: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  manageDriveWriters: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    experimental: false,
  },
  media: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  geolocation: {
    persist: false,
    idempotent: true,
    alwaysDisallow: true, // NOTE geolocation is disabled, right now
    requiresRefresh: false,
    experimental: false,
  },
  notifications: {
    persist: true,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  midi: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  midiSysex: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  pointerLock: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  fullscreen: {
    persist: true,
    idempotent: false,
    alwaysAllow: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  download: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  dangerousAppControl: {
    persist: true,
    idempotent: false,
    alwaysAllow: false,
    requiresRefresh: false,
    experimental: false,
  },
  openExternal: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: false,
  },
  experimentalLibrary: {
    persist: true,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: true,
  },
  experimentalLibraryRequestAdd: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: true,
  },
  experimentalLibraryRequestRemove: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: true,
  },
  experimentalGlobalFetch: {
    persist: true,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: true,
  },
  experimentalDatPeers: {
    persist: true,
    idempotent: true,
    alwaysAllow: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: true,
  },
  experimentalCapturePage: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    experimental: true,
  },
  panesCreate: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
  },
  panesAttach: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
  },
  panesInject: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
  },
  webmcpTools: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
  },
  // The AI's access to the user's Notes and Reader (ADR-0019): four grants, asked even on a trusted
  // nomad:// page (promptTrusted), since the AI asks, not Nomad's own code.
  notesRead: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  notesWrite: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  readerRead: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    promptTrusted: true,
  },
  readerWrite: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    promptTrusted: true,
  },
  // The AI's access to the user's Mods (ADR-0023). Changing them is dangerous: a Mod can run a
  // script on every page of a site.
  modsRead: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    promptTrusted: true,
  },
  modsWrite: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  // The AI Sidebar clicking and typing on this site (ADR-0028). Not persisted by the prompt:
  // bg/ui/page-control.js stores a yes as the time it ends, 30 days on. The site-info panel's
  // Allow (1) and Deny (0) don't end.
  aiPageControl: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  // The AI's access to the user's AI Jobs (ADR-0030). Changing them is dangerous: a Job runs a prompt
  // by itself, reads the user's Notes and Reader each time, and can notify their phone.
  jobsRead: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    promptTrusted: true,
  },
  jobsWrite: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  // The AI using one of the user's secrets (ADR-0033) for requests to the hosts the user allowed.
  // The param is the secret's name. Asked once a turn per secret, never kept: a yes for one
  // conversation shouldn't become a standing grant to a key.
  aiSecretUse: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  // The AI changing what it remembers about the user (ADR-0032). Every personal turn reads the
  // memories, so a memory a hostile page talked it into would follow the user around: ask.
  memoryWrite: {
    persist: 'allow', // dont persist 'deny'
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    promptTrusted: true,
  },
  // One click the AI makes that buys, sends, posts or deletes. Asked each time; the param numbers it.
  aiPageAction: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  // A plan of clicks the AI will make (planPageActions): one yes covers the ones in it. Asked each
  // time; the param numbers it.
  aiPagePlan: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  // Write grants for an AI Job the AI saves (ADR-0030): the drives, Notes or Reader it may change
  // with nobody watching. Asked each time the AI adds one; the param numbers it.
  jobWrites: {
    persist: false,
    idempotent: false,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
    promptTrusted: true,
  },
  // One file or folder of the user's private drive (hyper://private/), for a limited time. The
  // param is the path. Not persisted here: private-drive-guard.ts keeps the grant and ends it.
  privateRead: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
  },
  privateWrite: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    dangerous: true,
  },
  // A Session's tier 2 (ADR-0031 §8): the site sees the Persona's profile (its drive's URL, name and
  // picture). Granted only by the login prompt, as part of a Session; never asked for alone.
  profile: {
    persist: false,
    idempotent: true,
    alwaysDisallow: false,
    requiresRefresh: false,
    sessionOnly: true,
  },
};

export const PERM_ICONS = {
  js: 'fas fa-code',
  network: 'fas fa-cloud',
  createDrive: 'fas fa-folder-open',
  modifyDrive: 'fas fa-folder-open',
  deleteDrive: 'fas fa-folder-open',
  tagDrive: 'fas fa-tag',
  listDrives: 'fas fa-folder-open',
  manageDriveWriters: 'fas fa-user-shield',
  media: 'fas fa-video',
  geolocation: 'fas fa-map-marked',
  notifications: 'fas fa-bell',
  midi: 'fas fa-headphones',
  midiSysex: 'fas fa-headphones',
  pointerLock: 'fas fa-mouse-pointer',
  fullscreen: 'fas fa-arrows-alt',
  download: 'fas fa-download',
  openExternal: 'fas fa-external-link-alt',
  experimentalLibrary: 'fas fa-book',
  experimentalLibraryRequestAdd: 'fas fa-upload',
  experimentalLibraryRequestRemove: 'fas fa-times',
  experimentalGlobalFetch: 'fas fa-download',
  experimentalDatPeers: 'fas fa-exchange-alt',
  experimentalCapturePage: 'fas fa-camera',
  dangerousAppControl: 'fas fa-flask',
  panesCreate: 'fas fa-columns',
  panesAttach: 'fas fa-columns',
  panesInject: 'fas fa-columns',
  webmcpTools: 'fas fa-plug',
  notesRead: 'fas fa-sticky-note',
  notesWrite: 'fas fa-sticky-note',
  readerRead: 'fas fa-rss',
  readerWrite: 'fas fa-rss',
  modsRead: 'fas fa-magic',
  modsWrite: 'fas fa-magic',
  jobsRead: 'fas fa-clock',
  jobsWrite: 'fas fa-clock',
  jobWrites: 'fas fa-clock',
  memoryWrite: 'fas fa-brain',
  privateRead: 'fas fa-lock',
  privateWrite: 'fas fa-lock',
  profile: 'fas fa-id-badge',
  aiPageControl: 'fas fa-mouse-pointer',
  aiPageAction: 'fas fa-mouse-pointer',
  aiSecretUse: 'fas fa-key',
  aiPagePlan: 'fas fa-list-ol',
};

export function renderPermDesc({ html, bg, url, permId, permParam, permOpts }) {
  const api = bg ? bg.shellMenus || bg.permPrompt : null;
  const openUrl = (url) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    url = isDriveRegex.test(url) ? `hyper://${url}/` : url;
    if (api) api.createTab(url);
    else nomad.browser.openUrl(url, { setActive: true });
  };
  const mediaTypeToTool = (v) => ({ video: 'camera', audio: 'microphone' })[v];
  switch (permId) {
    case 'js':
      return 'Run Javascript';
    case 'media':
      return `Use your ${(permOpts.mediaTypes || ['video', 'audio'])
        .map(mediaTypeToTool)
        .join(' and ')}`;
    case 'geolocation':
      return 'Know your location';
    case 'notifications':
      return 'Create desktop notifications';
    case 'midi':
      return 'Access your MIDI devices';
    case 'midiSysex':
      return 'Access your MIDI devices';
    case 'pointerLock':
      return 'Lock your cursor';
    case 'fullscreen':
      return 'Go fullscreen';
    case 'openExternal':
      return `Open this URL in another program: ${shorten(permOpts.externalURL, 128)}`;
    case 'experimentalLibrary':
      return 'Read and modify your Library';
    case 'experimentalDatPeers':
      return 'Send and receive messages with peers';
    case 'dangerousAppControl':
      return 'Read and write your data, including bookmarks, archives, and files';
    case 'panesCreate':
      return 'Open a page in a new pane';
    case 'panesAttach':
      return 'Attach to other open pages and navigate them';
    case 'panesInject':
      return 'Inject code into other open pages';
    case 'webmcpTools':
      return 'Let the AI assistant use tools this page provides';
    case 'notesRead':
      return 'Let the AI assistant read your Notes';
    case 'notesWrite':
      return 'Let the AI assistant create and edit your Notes and Highlights';
    case 'readerRead':
      return 'Let the AI assistant read your Reader feeds and posts';
    case 'readerWrite':
      return 'Let the AI assistant follow and unfollow feeds and mark posts read';
    case 'modsRead':
      return 'Let the AI assistant read your Mods (your styles and scripts for sites)';
    case 'modsWrite':
      return 'Let the AI assistant create and change your Mods, including scripts that run on those sites';
    case 'aiPageControl':
      return 'Let the AI assistant click, type and scroll on this site for 30 days';
    case 'aiPageAction':
      return `Let the AI assistant ${permOpts?.action || 'do this'}`;
    case 'aiSecretUse': {
      const host = permOpts?.host ? ` to ${permOpts.host}` : '';
      return html`<span
        >Let the AI assistant send requests${host} with your secret <code>${permParam}</code>. It never
        sees the secret itself.</span
      >`;
    }
    case 'aiPagePlan': {
      const steps = Array.isArray(permOpts?.steps) ? permOpts.steps : [];
      return html`<span
        >Let the AI assistant do this plan: ${permOpts?.goal || ''}
        <ol class="plan-steps">
          ${steps.map(
            (s) =>
              html`<li>
                ${s.note ? html`${s.note} <span class="plan-what">(${s.what})</span>` : s.what}
              </li>`
          )}
        </ol>
        <span class="plan-note">Other clicks that buy, send, post or delete still ask.</span></span
      >`;
    }
    case 'jobsRead':
      return 'Let the AI assistant see your AI Jobs and their results';
    case 'jobsWrite':
      return 'Let the AI assistant create, change and run your AI Jobs, which run prompts on a schedule, read your Notes and Reader, and notify your phone';
    case 'jobWrites': {
      const grants = Array.isArray(permOpts?.grants) ? permOpts.grants : [];
      return html`<span
        >Let the AI Job “${permOpts?.title || 'Untitled'}” change these on its own, with nobody watching:
        <ul class="plan-steps">
          ${grants.map((g) => html`<li>${g}</li>`)}
        </ul>
        <span class="plan-note">You can take this back in My Library → Jobs.</span></span
      >`;
    }
    case 'profile':
      return permOpts?.title
        ? html`<span>See your name, <strong>${permOpts.title}</strong>, your picture and your profile drive</span>`
        : 'See your name, your picture and your profile drive';
    case 'memoryWrite':
      return 'Let the AI assistant remember things about you for later chats, and forget them';
    case 'privateRead':
    case 'privateWrite': {
      const verb = permId === 'privateWrite' ? 'Read and change' : 'Read';
      const what = permParam.endsWith('/') ? `${verb} the folder` : verb;
      const m = permOpts?.minutes || 0;
      const hours = m / 60;
      const span =
        Number.isInteger(hours) && hours >= 1
          ? `${hours} hour${hours > 1 ? 's' : ''}`
          : `${m} minutes`;
      const time = m ? ` for ${span}` : '';
      return html`<span
        >${what} <code>hyper://private${permParam}</code> in your private drive${time}</span
      >`;
    }

    case 'network':
      if (permParam === '*') return 'Access the network freely';
      return 'contact ' + permParam;

    case 'download':
      return html`<span>Download ${permOpts.filename}</span>`;

    case 'createDrive':
      if (permOpts.tags) return `Create a new hyperdrive tagged "${permOpts.tags.join(', ')}"`;
      if (permOpts.title) return `Create a new hyperdrive, "${permOpts.title}"`;
      return 'Create a new hyperdrive';

    case 'modifyDrive': {
      let viewArchive = openUrl(permParam);
      return html`<span>Write files to <a @click=${viewArchive}>${permOpts.title}</a></span>`;
    }

    case 'deleteDrive': {
      let viewArchive = openUrl(permParam);
      return html`<span
        >Remove the hyperdrive <a @click=${viewArchive}>${permOpts.title}</a> from your
        library</span
      >`;
    }

    case 'tagDrive': {
      let viewArchive = openUrl(permParam);
      return html`<span
        >Add the tags "${permOpts.tags.join(', ')}" to the hyperdrive
        <a @click=${viewArchive}>${permOpts.title}</a></span
      >`;
    }

    case 'listDrives':
      if (permParam) return `Read the hyperdrives tagged "${permParam}" in your library`;
      return `Read all the hyperdrives in your library`;

    case 'manageDriveWriters': {
      let viewArchive = openUrl(permParam);
      return html`<span
        >Manage who can write to <a @click=${viewArchive}>${permOpts.title}</a></span
      >`;
    }

    case 'experimentalLibraryRequestAdd': {
      let viewArchive = openUrl(permParam);
      return html`<span>Host <a @click=${viewArchive}>${permOpts.title}</a></span>`;
    }

    case 'experimentalLibraryRequestRemove': {
      let viewArchive = openUrl(permParam);
      return html`<span>Stop hosting <a @click=${viewArchive}>${permOpts.title}</a></span>`;
    }

    case 'experimentalGlobalFetch': {
      let viewPage = openUrl(permParam);
      return html`<span>Fetch data from <a @click=${viewPage}>${permParam}</a></span>`;
    }

    case 'experimentalCapturePage': {
      let viewPage = openUrl(permParam);
      return html`<span>Take a screenshot of <a @click=${viewPage}>${permParam}</a></span>`;
    }
  }
}

export function getPermId(permissionToken) {
  return permissionToken.split(':')[0];
}

export function getPermParam(permissionToken) {
  return permissionToken.split(':').slice(1).join(':');
}

function shorten(str, n = 6) {
  if (str.length > n + 3) {
    return str.slice(0, n) + '...';
  }
  return str;
}
