/* globals monaco */

import {
  LitElement,
  html,
} from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { isFilenameBinary } from '../../app-stdlib/js/is-ext-binary.js';
import lock from '../../../lib/lock';
import datServeResolvePath from '@beaker/dat-serve-resolve-path';
import { joinPath } from '../../app-stdlib/js/strings.js';
import * as contextMenu from '../../app-stdlib/js/com/context-menu.js';
import { writeToClipboard } from '../../app-stdlib/js/clipboard.js';
import * as toast from '../../app-stdlib/js/com/toast.js';
import './com/files-explorer.js';
import '../../app-stdlib/js/com/ai-sidebar.js';
import { ResizeImagePopup } from './com/resize-image-popup.js';
import { configureLanguageService } from './language-service.js';
import { registerHtmlEmbeddedProviders } from './html-embedded-ts.js';

class EditorApp extends LitElement {
  static get properties() {
    return {
      url: { type: String },
      isUnloaded: { type: Boolean },
      isLoading: { type: Boolean },
      showLoadingNotice: { type: Boolean },
      isFilesOpen: { type: Boolean },
      isAiOpen: { type: Boolean },
      readOnly: { type: Boolean },
      dne: { type: Boolean },
      isBinary: { type: Boolean },
      // Draft Mode (ADR-0012)
      draftMode: { type: Boolean },
      draftCount: { type: Number },
      draftConflicts: { type: Number },
    };
  }

  createRenderRoot() {
    return this; // no shadow dom
  }

  get drive() {
    // nomad.fs auto-detects the backend (Hyperdrive or Autobase collaborative
    // drive) and dispatches reads/writes to the right one.
    return nomad.fs.drive(this.url);
  }

  get origin() {
    let urlp = new URL(this.url);
    return urlp.origin + '/';
  }

  get viewedDatVersion() {
    let urlp = new URL(this.url);
    let parts = urlp.hostname.split('+');
    if (parts.length === 2) return parts[1];
    return 'latest';
  }

  get pathname() {
    let urlp = new URL(this.url);
    return urlp.pathname;
  }

  get resolvedFilename() {
    return (this.resolvedPath || '').split('/').pop();
  }

  get resolvedUrl() {
    return this.origin + this.resolvedPath;
  }

  get resolvedDirname() {
    return (
      '/' +
      (this.resolvedPath || '')
        .split('/')
        .filter(Boolean)
        .slice(0, -1)
        .join('/')
    );
  }

  get hasFileExt() {
    var path = this.pathname;
    return path.split('/').pop().includes('.');
  }

  get isPrivate() {
    return this.url.startsWith('hyper://private/');
  }

  get hasChanges() {
    var model = this.editor.getModel(this.url);
    return (
      typeof this.lastSavedVersionId !== 'undefined' &&
      !!model &&
      this.lastSavedVersionId !== model.getAlternativeVersionId()
    );
  }

  constructor() {
    super();
    nomad.panes.setAttachable();
    this.editorEl = undefined;
    this.editor = undefined; // monaco instance
    this.attachedPane = undefined;
    this.url = '';
    this.isUnloaded = true;
    this.stat = undefined;
    this.isLoading = false;
    this.showLoadingNotice = false;
    this.isFilesOpen = true;
    // AI Sidebar — collapsed by default; open/closed persisted globally
    this.isAiOpen = localStorage.getItem('nomad-ai-sidebar:open') === '1';
    this.readOnly = true;
    this.lastSavedVersionId = undefined;
    this.dne = false;
    this.isBinary = false;
    this.resolvedPath = '';
    this.setFocusOnLoad = false;
    this.isCollaborative = false;
    // Draft Mode (ADR-0012): staged, device-private edits held back from replication until Publish.
    this.draftMode = false;
    this.draftCount = 0;
    this.draftConflicts = 0;

    nomad.panes.addEventListener('pane-attached', (e) => {
      this.attachedPane = nomad.panes.getAttachedPane();
      this.requestUpdate();
      if (this.url !== this.attachedPane.url) {
        this.load(this.attachedPane.url);
      }
    });
    nomad.panes.addEventListener('pane-detached', (e) => {
      this.attachedPane = undefined;
      this.requestUpdate();
    });
    nomad.panes.addEventListener('pane-navigated', (e) => {
      if (!this.url || this.dne) {
        this.load(e.detail.url);
      }
    });
    (async () => {
      this.attachedPane = await nomad.panes.attachToLastActivePane();
      if (this.attachedPane) {
        this.load(this.attachedPane.url);
      } else {
        let ctx = new URLSearchParams(location.search).get('url');
        if (ctx) this.load(ctx);
      }
    })();
  }

  teardown() {
    if (this.editor) {
      this.editor.dispose();
    }
  }

  getContext() {
    return this.url;
  }

  setFocus() {
    if (this.editor) {
      this.editor.focus();
    } else {
      this.setFocusOnLoad = true;
    }
  }

  ensureEditorEl() {
    if (!this.editorEl) {
      this.editorEl = document.createElement('div');
      this.editorEl.id = 'monaco-editor';
      this.editorEl.addEventListener('contextmenu', async (e) => {
        var choice = await nomad.browser.showContextMenu([
          { id: 'cut', label: 'Cut' },
          { id: 'copy', label: 'Copy' },
          { id: 'paste', label: 'Paste' },
          { type: 'separator' },
          { id: 'selectAll', label: 'Select All' },
          { type: 'separator' },
          { id: 'undo', label: 'Undo' },
          { id: 'redo', label: 'Redo' },
        ]);
        switch (choice) {
          case 'cut':
          case 'copy':
          case 'paste':
            this.editor.focus();
            document.execCommand(choice);
            break;
          case 'selectAll':
            this.editor.setSelection(
              this.editor.getModel().getFullModelRange()
            );
            break;
          case 'undo':
          case 'redo':
            this.editor.trigger('contextmenu', choice);
            break;
        }
      });
    }
    this.append(this.editorEl);
  }

  async createEditor() {
    this.ensureEditorEl();
    return new Promise((resolve, reject) => {
      // Monaco's language workers live at nomad://assets, a different origin
      // than this page (nomad://editor), so `new Worker(crossOriginUrl)` is
      // blocked by the same-origin policy and Monaco falls back to running them
      // on the main thread (UI freezes + "Duplicate definition of module" spam +
      // broken lib loading). Spawn each worker from a same-origin blob that
      // importScripts the real worker instead. (EDITOR_CSP allows blob: workers.)
      if (!window.MonacoEnvironment) {
        window.MonacoEnvironment = {
          getWorkerUrl: function () {
            var code = [
              "self.MonacoEnvironment = { baseUrl: 'nomad://assets/' };",
              "importScripts('nomad://assets/vs/base/worker/workerMain.js');",
            ].join('\n');
            return URL.createObjectURL(
              new Blob([code], { type: 'application/javascript' })
            );
          },
        };
      }
      window.require.config({ baseUrl: 'nomad://assets/' });
      window.require(['vs/editor/editor.main'], () => {
        try {
          // update monaco to syntax-highlight <script type="module">
          var jsLang = monaco.languages
            .getLanguages()
            .find((lang) => lang.id === 'javascript');
          if (jsLang) {
            jsLang.mimetypes.push('module');
            monaco.languages.register(jsLang);
          }

          // we have load monaco outside of the shadow dom
          monaco.editor.defineTheme('custom-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [{ background: '222222' }],
            colors: {
              'editor.background': '#222222',
            },
          });
          let opts = {
            automaticLayout: true,
            contextmenu: false,
            fixedOverflowWidgets: true,
            folding: false,
            lineNumbersMinChars: 4,
            links: false,
            minimap: { enabled: false },
            renderLineHighlight: 'all',
            roundedSelection: false,
            theme: 'custom-dark',
            value: '',
          };
          this.editor = monaco.editor.create(this.editorEl, opts);
          this.editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
            function () {
              document.querySelector('editor-app').onClickSave();
            }
          );

          // wire up the TypeScript language service: nomad.* + schema types,
          // DOM/JS built-ins, and autocomplete/hover inside HTML <script>
          // blocks. Wrapped so a setup failure can never block editor creation.
          try {
            configureLanguageService(monaco);
            registerHtmlEmbeddedProviders(monaco);
          } catch (e) {
            console.error('Failed to set up editor language services', e);
          }
        } catch (e) {
          console.error('Editor failed to initialize', e);
        } finally {
          resolve();
        }
      });
    });
  }

  resetEditor() {
    for (let model of monaco.editor.getModels()) {
      model.dispose();
    }

    this.editor.setValue('');
    this.readOnly = true;
    this.dne = false;
    this.isBinary = false;
    this.resolvedPath = '';
    this.isCollaborative = false;
    this.showLoadingNotice = true;
  }

  async load(url, forceLoad = false) {
    var release = await lock('editor-load');
    try {
      this.isUnloaded = false;
      this.isLoading = true;
      if (!this.editor) {
        await this.createEditor();
      }
      if (this.editor.hasTextFocus()) {
        this.setFocusOnLoad = true;
      }
      if (!forceLoad && (this.url === url || !url)) {
        this.isLoading = false;
        setTimeout(() => this.editor.focus(), 1);
        this.setFocusOnLoad = false;
        return;
      }
      if (this.hasChanges) {
        if (
          !confirm(
            'You have unsaved changes. Are you sure you want to navigate away?'
          )
        ) {
          this.isLoading = false;
          return;
        }
      }
      this.url = url;
      history.replaceState({}, '', `/?url=${url}`);

      this.resetEditor();
      console.log('Loading', url);

      this.stat = undefined;
      var body = '';
      try {
        if (url.startsWith('hyper:')) {
          body = await this.loadDrive(url);
          this.isFilesOpen = !body;
        } else if (url.startsWith('http:') || url.startsWith('https:')) {
          this.isFilesOpen = false;
          body = await nomad.browser.fetchBody(url);
        } else {
          this.isFilesOpen = false;
          let res = await fetch(url);
          body = await res.text();
        }
      } catch (e) {
        this.dne = true;
        body = '';
      }

      if (!this.dne && !this.isBinary) {
        // create a model
        let urlp2 = new URL(url);
        urlp2.pathname = this.resolvedPath || this.pathname;
        let model = monaco.editor.createModel(
          body,
          null,
          url ? monaco.Uri.parse(urlp2.toString()) : undefined
        );

        // override the model syntax highlighting when the URL doesnt give enough info (no extension)
        if (body && model.getLanguageId() === 'plaintext') {
          let type = await nomad.browser.getResourceContentType(url);
          if (type) {
            if (type.includes('text/html')) {
              monaco.editor.setModelLanguage(model, 'html');
            } else if (type.includes('text/markdown')) {
              monaco.editor.setModelLanguage(model, 'markdown');
            } else if (type.includes('text/css')) {
              monaco.editor.setModelLanguage(model, 'css');
            } else if (
              type.includes('text/javascript') ||
              type.includes('application/javascript')
            ) {
              monaco.editor.setModelLanguage(model, 'javascript');
            }
          }
        }

        this.editor.updateOptions({
          // only enable autocomplete for html/css/js/ts/json
          quickSuggestions: [
            'html',
            'css',
            'javascript',
            'typescript',
            'json',
          ].includes(model.getLanguageId()),
          wordBasedSuggestions: false,
          wordWrap: 'on',
          readOnly: this.readOnly,
        });
        model.updateOptions({ tabSize: 2 });
        this.editor.setModel(model);
        this.lastSavedVersionId = model.getAlternativeVersionId();

        model.onDidChangeContent(() => {
          this.setSaveBtnState();
        });
      }

      this.requestUpdate();

      if (this.setFocusOnLoad) {
        setTimeout(() => this.editor.focus(), 1);
        this.setFocusOnLoad = false;
      }
    } catch (e) {
      // surface the real error instead of silently hanging on "Loading..."
      console.error('Editor failed to load', url, e);
      toast.create('Editor failed to load: ' + (e && e.message ? e.message : e), 'error', 15000);
    } finally {
      // always clear the loading state, even on error/early-return, so the
      // editor can never get stuck showing "Loading..." indefinitely
      this.isLoading = false;
      this.showLoadingNotice = false;
      this.requestUpdate();
      release();
    }
  }

  async loadDrive(url) {
    var body;

    // Bound each drive read so a hung/slow read (e.g. a key the daemon can't
    // serve) can't block the load indefinitely. Optional reads use a short
    // timeout; the essential file read passes a longer one.
    const step = (label, p, ms = 2500) =>
      Promise.race([
        p,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timed out at: ' + label)), ms)
        ),
      ]);

    // load drive meta
    let drive = this.drive;
    let info = await step('getInfo', drive.getInfo());
    this.readOnly = !info.writable;

    // readonly if viewing historic version
    if (info.writable) {
      let v = this.viewedDatVersion;
      if (v == +v) {
        // viewing a numeric version? (in the history)
        this.readOnly = true;
      }
    }

    // Determine the entry to load. For an explicit file path (has an extension)
    // we already know the file — open it directly and DON'T read the manifest or
    // run datServeResolvePath. Both of those read possibly-missing paths
    // (/index.json, <file>.html, <file>.md); a missing-path read can wedge the
    // drive's daemon for a long time and block the real readFile behind it.
    if (this.hasFileExt) {
      this.resolvedPath = this.pathname;
    } else {
      // directory / extensionless URL: need the manifest for index resolution
      let manifest = await Promise.race([
        drive.readFile('/index.json', 'utf8').catch(() => ''),
        new Promise((resolve) =>
          setTimeout(() => {
            console.warn(
              'editor: /index.json read did not return in time; continuing without a manifest'
            );
            resolve('');
          }, 2500)
        ),
      ]);
      try {
        manifest = JSON.parse(manifest);
      } catch (e) {
        manifest = null;
      }
      let entry = await step(
        'datServeResolvePath',
        Promise.resolve(datServeResolvePath(drive, manifest, url, '*/*'))
      );
      this.resolvedPath = entry ? entry.path : this.pathname;
    }
    // stat is only metadata (size/mtime/isFile) — make it best-effort so a
    // hung/missing stat can't block reading the file, which is what matters.
    // figure out if it's binary (filename-based — no drive read)
    {
      let filename = this.resolvedPath.split('/').pop();
      if (filename.includes('.') && isFilenameBinary(filename)) {
        this.isBinary = true;
      } else if (filename.endsWith('.goto')) {
        this.isBinary = true;
      }
    }

    // Fetch the file FIRST — it's the only essential read. Doing it before stat
    // matters: a slow/hung stat keeps running on the backend and can wedge the
    // drive's daemon, blocking the content read behind it.
    // Learn this drive's Draft Mode first, so the content read below reflects staged edits.
    await this.refreshDraftStatus();
    if (!this.isBinary) {
      try {
        if (!this.resolvedPath) throw new Error('dne');
        // This is the one essential read and the content may need fetching from
        // a peer (slow on first read), so give it a longer timeout than the
        // optional metadata reads — but bounded, since a hung read also blocks
        // other drive operations (e.g. the file tree) behind it.
        body = await step(
          'readFile(' + this.resolvedPath + ')',
          // In Draft Mode, read the merged (staged-over-published) content; otherwise force the
          // published view (draft:false) so a Drive's preview flag can't leak in here.
          drive.readFile(this.resolvedPath, { encoding: 'utf8', draft: !!this.draftMode }),
          10000
        );
      } catch (e) {
        this.dne = true;
        body = '';
      }
    }

    // stat + mount detection are optional metadata (file size, mount info). For
    // an explicit file we already have the content from readFile above, so skip
    // them — their backend reads can keep running and wedge the daemon, blocking
    // load completion. The UI guards against a missing this.stat/this.mountInfo.
    this.stat = undefined;
    this.mountInfo = undefined;
    if (!this.hasFileExt) {
      this.stat = await step(
        'stat(' + this.resolvedPath + ')',
        drive.stat(this.resolvedPath)
      ).catch((e) => {
        console.warn('editor: stat did not return; continuing', e);
        return undefined;
      });

      let pathParts = this.resolvedPath.split('/').filter(Boolean);
      let realPathParts = [pathParts.pop()];
      while (pathParts.length) {
        let path = '/' + pathParts.join('/');
        let stat = await step('mountStat(' + path + ')', drive.stat(path)).catch(
          (e) => undefined
        );
        if (stat && stat.mount) {
          this.mountInfo = await step(
            'mountGetInfo',
            nomad.fs.drive(stat.mount.key).getInfo()
          ).catch((e) => undefined);
          if (this.mountInfo) {
            this.mountInfo.resolvedPath = '/' + realPathParts.join('/');
          }
          break;
        }
        realPathParts.unshift(pathParts.pop());
      }
    }

    return body;
  }

  loadExplorer() {
    try {
      let fe = this.querySelector('files-explorer');
      // set directly (don't wait on attribute reflection) so the tree reads the
      // collaborative drive through the right API
      fe.isCollaborative = this.isCollaborative;
      fe.load();
    } catch (e) {
      console.warn(e);
    }
  }

  setSaveBtnState() {
    if (this.readOnly || this.dne || !this.hasChanges) {
      this.querySelector('#save-btn').setAttribute('disabled', '');
    } else {
      this.querySelector('#save-btn').removeAttribute('disabled');
    }
  }

  async showMenu(x, y, folderPath, item, folderItemUrls) {
    var items = [];
    if (item) {
      items.push({
        label: 'Open in New Tab',
        click() {
          nomad.browser.openUrl(item.url);
        },
      });
      items.push({
        label: 'Copy Link Address',
        disabled: !item.shareUrl,
        click() {
          writeToClipboard(item.shareUrl);
          toast.create('Copied to your clipboard');
        },
      });
      if (item.stat.mount && item.stat.mount.key) {
        items.push({
          label: 'Copy Mount Target',
          click() {
            writeToClipboard(`hyper://${item.stat.mount.key}/`);
            toast.create('Copied to your clipboard');
          },
        });
      }
      items.push({
        label: `Copy ${item.stat.isFile() ? 'file' : 'folder'} path`,
        click() {
          writeToClipboard(item.path);
          toast.create('Copied to your clipboard');
        },
      });
      items.push({ type: 'separator' });
      items.push({
        label: 'Open in Pane Right',
        click: () => {
          nomad.browser.newPane(item.shareUrl, { splitDir: 'vert' });
        },
      });
      items.push({
        label: 'Open in Pane Below',
        click: () => {
          nomad.browser.newPane(item.shareUrl, { splitDir: 'horz' });
        },
      });
      items.push({ type: 'separator' });
      items.push({
        label: 'Rename',
        disabled: this.readOnly,
        click: () => this.onClickRename(item.path),
      });
      items.push({
        label: 'Delete',
        disabled: this.readOnly,
        click: () => this.onClickDelete(item.path),
      });
      items.push({ type: 'separator' });
      items.push({
        label: 'Refresh Files',
        click: () => this.loadExplorer(),
      });
      items.push({
        label: 'Export',
        click: () => this.onClickExportFiles([item.url]),
      });
    } else {
      items.push({ id: 'builtin:back' });
      items.push({ id: 'builtin:forward' });
      items.push({ id: 'builtin:reload' });
      items.push({ type: 'separator' });
      items.push({ id: 'builtin:split-pane-vert' });
      items.push({ id: 'builtin:split-pane-horz' });
      items.push({ id: 'builtin:move-pane' });
      items.push({ id: 'builtin:close-pane' });
      items.push({ type: 'separator' });
      items.push({
        label: 'New Folder',
        disabled: this.readOnly,
        click: () => this.onClickNewFolder(folderPath),
      });
      items.push({
        label: 'New File',
        disabled: this.readOnly,
        click: () => this.onClickNewFile(folderPath),
      });
      items.push({
        label: 'New Mount',
        disabled: this.readOnly,
        click: () => this.onClickNewMount(folderPath),
      });
      items.push({ type: 'separator' });
      items.push({
        label: 'Refresh Files',
        click: () => this.loadExplorer(),
      });
      items.push({ type: 'separator' });
      items.push({
        label: 'Import File(s)',
        disabled: this.readOnly,
        click: () => this.onClickImportFiles(folderPath),
      });
      items.push({
        label: 'Import Folder(s)',
        disabled: this.readOnly,
        click: () => this.onClickImportFolders(folderPath),
      });
      items.push({
        label: 'Export Files',
        click: () => this.onClickExportFiles(folderItemUrls),
      });
    }
    items.push({ type: 'separator' });
    items.push({ id: 'builtin:inspect-element' });

    var fns = {};
    for (let i = 0; i < items.length; i++) {
      if (items[i].id) continue;
      let id = `item=${i}`;
      items[i].id = id;
      fns[id] = items[i].click;
      delete items[i].click;
    }

    var choice = await nomad.browser.showContextMenu(items);
    if (fns[choice]) fns[choice]();
  }

  // rendering
  // =

  render() {
    if (this.isFilesOpen) {
      this.classList.add('files-open');
    } else {
      this.classList.remove('files-open');
    }
    if (this.isAiOpen && !this.isUnloaded) {
      this.classList.add('ai-open');
    } else {
      this.classList.remove('ai-open');
    }
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${this.renderToolbar()}
      ${!this.isUnloaded && this.isFilesOpen
        ? html`
            <files-explorer
              url=${this.url}
              ?is-collaborative=${this.isCollaborative}
              open-file-path=${this.resolvedPath}
              @open=${this.onOpenFile}
              @show-menu=${this.onShowMenu}
              @new-file=${this.onFilesExplorerNewFile}
            ></files-explorer>
          `
        : ''}
      ${this.isBinary && this.pathname.endsWith('.goto')
        ? html`
            <div class="empty">
              .goto files store their information in
              <a
                href="#"
                @click=${(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  this.querySelector('#file-metadata-btn').click();
                }}
                >file metadata</a
              >.
            </div>
          `
        : this.isBinary
        ? html`
            <div class="empty">
              ${/\.(png|jpe?g)$/.test(this.pathname)
                ? html`
                    <button
                      class="primary btn"
                      @click=${this.onClickResizeImage}
                    >
                      Resize Image
                    </button>
                  `
                : 'This file is not editable here.'}
              <div class="binary-render">
                ${/\.(png|jpe?g|gif)$/.test(this.pathname)
                  ? html`<img src="${this.url}?cache_buster=${Date.now()}" />`
                  : ''}
                ${/\.(mp4|webm|mov)$/.test(this.pathname)
                  ? html`<video controls>
                      <source src="${this.url}?cache_buster=${Date.now()}" />
                    </video>`
                  : ''}
                ${/\.(mp3|ogg)$/.test(this.pathname)
                  ? html`<audio controls>
                      <source src="${this.url}?cache_buster=${Date.now()}" />
                    </audio>`
                  : ''}
              </div>
            </div>
          `
        : this.dne
        ? html`
            <div class="empty">
              <a
                @click=${(e) => {
                  this.isFilesOpen = true;
                }}
                >Select a file</a
              >
              ${!this.readOnly
                ? html` or
                    <a
                      @click=${(e) => {
                        this.onClickNewFile(
                          this.resolvedDirname,
                          this.resolvedFilename
                        );
                      }}
                      >Create a file</a
                    >`
                : ''}
            </div>
          `
        : ''}
      ${!this.isUnloaded && this.isAiOpen
        ? html`
            <ai-sidebar
              .host=${this}
              .url=${this.url}
              .readOnly=${this.readOnly}
            ></ai-sidebar>
          `
        : ''}
      ${this.showLoadingNotice
        ? html`<div id="loading-notice">Loading...</div>`
        : ''}
    `;
  }

  updated(changedProperties) {
    this.ensureEditorEl();
    if (changedProperties.has('isFilesOpen') || changedProperties.has('isAiOpen')) {
      if (this.editor) {
        this.editor.layout();
      }
    }
  }

  renderToolbar() {
    return html`
      <div class="toolbar">
        <button
          class="transparent"
          @click=${this.onToggleFilesOpen}
          ?disabled=${this.isUnloaded}
        >
          <span class="fas fa-fw fa-columns"></span>
        </button>
        <span class="divider"></span>
        ${!this.readOnly
          ? html`
              <button
                id="save-btn"
                title="Save"
                @click=${this.onClickSave}
                ?disabled=${this.dne || !this.hasChanges}
              >
                <span class="fas fa-fw fa-save"></span> Save
              </button>
              <button
                title="Rename"
                @click=${(e) => this.onClickRename(this.resolvedPath)}
                ?disabled=${this.dne}
              >
                <span class="fas fa-fw fa-i-cursor"></span> Rename
              </button>
              <button
                title="Delete"
                @click=${(e) => this.onClickDelete(this.resolvedPath)}
                ?disabled=${this.dne}
              >
                <span class="far fa-fw fa-trash-alt"></span> Delete
              </button>
            `
          : ''}
        <button title="Actions" @click=${this.onClickActions}>
          <span class="fas fa-fw fa-ellipsis-h"></span>
        </button>
        <span class="divider"></span>
        ${this.isLoading
          ? html`
              <div class="text">
                <span class="fas fa-fw fa-info-circle"></span> Loading...
              </div>
              <span class="divider"></span>
            `
          : this.readOnly && !this.isUnloaded
          ? html`
              <div class="text">
                <span class="fas fa-fw fa-info-circle"></span> This site is
                read-only
              </div>
              <span class="divider"></span>
              ${this.mountInfo && this.mountInfo.writable
                ? html`
                    <span style="margin-left: 8px">You own this file</span>
                    <button class="primary" @click=${this.onClickEditReal}>
                      Edit it in New Tab
                    </button>
                  `
                : ''}
            `
          : ''}
        <button
          id="file-metadata-btn"
          title="File Metadata"
          ?disabled=${!this.stat}
          @click=${this.onClickFileMetadata}
        >
          Metadata <span class="fas fa-fw fa-caret-down"></span>
        </button>
        <span class="divider"></span>
        <button
          title="View file"
          @click=${this.onClickView}
          ?disabled=${this.dne || this.isUnloaded}
        >
          <span class="far fa-fw fa-window-maximize"></span> View file
        </button>
        ${!this.readOnly && !this.isUnloaded
          ? html`
              <span class="divider"></span>
              <button
                class="${this.draftMode ? 'active' : ''}"
                title="Draft Mode — stage edits privately (synced across your devices) until you Publish"
                @click=${this.onToggleDraftMode}
              >
                <span class="fas fa-fw fa-pen-nib"></span> Draft${this.draftMode &&
                this.draftCount
                  ? ` (${this.draftCount})`
                  : ''}
              </button>
              ${this.draftMode
                ? html`
                    <button
                      class="primary"
                      title="Publish staged changes to the drive"
                      ?disabled=${!this.draftCount}
                      @click=${this.onClickPublishDraft}
                    >
                      <span class="fas fa-fw fa-cloud-upload-alt"></span> Publish
                    </button>
                    <button
                      title="Discard staged changes"
                      ?disabled=${!this.draftCount}
                      @click=${this.onClickDiscardDraft}
                    >
                      <span class="far fa-fw fa-trash-alt"></span> Discard
                    </button>
                  `
                : ''}
            `
          : ''}
        <span class="spacer"></span>
        <button
          class="${this.isAiOpen ? 'active' : ''}"
          title="Toggle AI sidebar"
          @click=${this.onToggleAiOpen}
          ?disabled=${this.isUnloaded}
        >
          <span class="fas fa-fw fa-robot"></span> AI
        </button>
        ${this.attachedPane
          ? html`
              <button @click=${window.close}>
                <span class="fas fa-times"></span>
              </button>
            `
          : ''}
      </div>
    `;
  }

  // events
  // =

  onToggleFilesOpen(e) {
    this.isFilesOpen = !this.isFilesOpen;
  }

  onToggleAiOpen(e) {
    this.isAiOpen = !this.isAiOpen;
    localStorage.setItem('nomad-ai-sidebar:open', this.isAiOpen ? '1' : '0');
  }

  closeAiSidebar() {
    this.isAiOpen = false;
    localStorage.setItem('nomad-ai-sidebar:open', '0');
  }

  // --- Draft Mode (ADR-0012) ---

  async refreshDraftStatus() {
    try {
      const { mode, changes } = await this.drive.draftStatus();
      this.draftMode = !!mode;
      this.draftCount = changes.length;
      this.draftConflicts = changes.filter((c) => c.conflict).length;
    } catch {
      this.draftMode = false;
      this.draftCount = 0;
      this.draftConflicts = 0;
    }
  }

  async onToggleDraftMode() {
    try {
      if (this.draftMode) await this.drive.endDraft();
      else await this.drive.beginDraft();
    } catch (e) {
      alert('Draft Mode needs a Vault on this device.\n\n' + (e.message || e));
      return;
    }
    await this.refreshDraftStatus();
    await this.load(this.url, true); // re-read the buffer through the new (merged/published) view
  }

  async onClickPublishDraft() {
    await this.refreshDraftStatus();
    if (!this.draftCount) return;
    let res = await this.drive.publishDraft();
    if (res.conflicts && res.conflicts.length) {
      const msg =
        `${res.conflicts.length} file(s) changed on the drive since you staged them:\n\n` +
        res.conflicts.join('\n') +
        `\n\nPublish your version anyway (overwrite)? Cancel to keep them staged.`;
      if (confirm(msg)) res = await this.drive.publishDraft({ force: true });
    }
    await this.refreshDraftStatus();
    await this.load(this.url, true);
  }

  async onClickDiscardDraft() {
    await this.refreshDraftStatus();
    if (!this.draftCount) return;
    if (!confirm(`Discard ${this.draftCount} staged change(s)? This cannot be undone.`)) return;
    await this.drive.discardDraft();
    await this.refreshDraftStatus();
    await this.load(this.url, true);
  }

  // Called by the AI Sidebar before it runs a prompt. The agent writes directly
  // to the drive, so the open buffer must be clean first (save-clean gate) — else
  // an agent write to the open file would collide with unsaved manual edits.
  // Returns false to abort the run.
  async prepareForAgentRun() {
    if (!this.hasChanges) return true;
    if (!confirm('Save your unsaved changes before running the agent?')) return false;
    await this.onClickSave();
    return true;
  }

  // Tells the agent which Drive + file it is operating on (the sidebar runs at
  // nomad://editor, so the model can't infer this from location.href).
  getAgentContext() {
    // only treat it as "the open file" if it's a concrete file path (not the
    // drive root or a directory) — otherwise the model may try to write to "/".
    const openFile =
      this.resolvedPath && !this.resolvedPath.endsWith('/') ? this.resolvedPath : null;
    const lines = [
      `You are editing the Nomad drive at ${this.origin}`,
      openFile
        ? `The file currently open in the editor is ${openFile} — when the user says "this file" or "the current file", they mean ${openFile}.`
        : `No single file is open; use listDriveFiles to see what exists before writing. Never write to a directory or "/" — always target a full file path (e.g. /index.html).`,
      `Use the drive tools (readDriveFile / listDriveFiles / writeDriveFile) with absolute file paths (e.g. ${openFile || '/index.html'}) to read and modify files in THIS drive. Ignore any instruction about location.href.`,
      this.readOnly ? `This drive is READ-ONLY — you cannot write to it.` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  // Called by the AI Sidebar after the agent writes (or a revert restores) a file.
  // Refresh the file tree and, if the affected file is the one open in the editor,
  // reload it so the buffer reflects the new drive content.
  async onAgentWroteFile(path) {
    this.loadExplorer();
    // The agent runs in Draft Mode (auto-enabled by the AI Sidebar), so its writes stage — refresh
    // the unpublished-count badge and toggle state.
    await this.refreshDraftStatus();
    if (path === this.resolvedPath) {
      await this.load(this.url, true);
    }
  }

  onOpenFile(e) {
    if (this.hasChanges) {
      if (
        !confirm(
          'You have unsaved changes. Are you sure you want to navigate away?'
        )
      ) {
        return;
      }
    }
    this.load(e.detail.url);
  }

  onShowMenu(e) {
    this.showMenu(
      e.detail.x,
      e.detail.y,
      e.detail.folderPath,
      e.detail.item,
      e.detail.folderItemUrls
    );
  }

  onFilesExplorerNewFile(e) {
    this.onClickNewFile(e.detail.folderPath);
  }

  async onClickActions(e) {
    let el = e.currentTarget;
    if (el.classList.contains('active')) return;
    e.preventDefault();
    e.stopPropagation();
    let rect = e.currentTarget.getClientRects()[0];
    el.classList.add('active');
    await contextMenu.create({
      x: (rect.left + rect.right) / 2,
      y: rect.bottom,
      center: true,
      fontAwesomeCSSUrl: 'nomad://assets/font-awesome.css',
      noBorders: true,
      roomy: true,
      rounded: true,
      style: 'padding: 4px 0',
      items: [
        {
          icon: 'fas fa-fw fa-file-export',
          label: 'Export',
          disabled: this.dne,
          click: () => this.onClickExportFiles(this.resolvedUrl),
        },
      ],
    });
    el.classList.remove('active');
  }

  onClickEditReal(e) {
    nomad.browser.openUrl(
      `nomad://editor?url=${this.mountInfo.url + this.mountInfo.resolvedPath}`,
      {
        setActive: true,
        adjacentActive: true,
      }
    );
  }

  async onClickFileMetadata(e) {
    let el = e.currentTarget;
    if (el.classList.contains('active')) return;
    e.preventDefault();
    e.stopPropagation();
    let rect = e.currentTarget.getClientRects()[0];
    el.classList.add('active');
    await contextMenu.create({
      x: (rect.left + rect.right) / 2,
      y: rect.bottom,
      render: () => {
        var entries = Object.entries(this.stat.metadata).filter(
          ([key]) => key !== 'type'
        );
        if (!this.readOnly) entries = entries.concat([['', '']]);
        const onClickSaveMetadata = async (e) => {
          var metadataEl = e.currentTarget.parentNode;
          var newMetadata = {};
          for (let entryEl of Array.from(
            metadataEl.querySelectorAll('.entry')
          )) {
            let k = entryEl.querySelector('[name="key"]').value.trim();
            let v = entryEl.querySelector('[name="value"]').value.trim();
            if (k && v) newMetadata[k] = v;
          }
          var deletedKeys = [];
          for (let k in this.stat.metadata) {
            if (!(k in newMetadata)) deletedKeys.push(k);
          }
          await this.drive.updateMetadata(this.resolvedPath, newMetadata);
          if (deletedKeys.length) {
            await this.drive.deleteMetadata(this.resolvedPath, deletedKeys);
          }
          this.stat.metadata = newMetadata;
          contextMenu.destroy();
        };
        const onChange = (e) => {
          e.target
            .getRootNode()
            .querySelector('button')
            .removeAttribute('disabled');
        };
        return html`
          <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
          <style>
            .dropdown-items {
              padding: 12px;
              border: 0;
            }
            .metadata {
              position: relative;
              width: 100%;
            }
            .metadata .entry {
              display: flex;
              border: 1px solid #ccd;
              border-bottom: 0;
            }
            .metadata.readonly .entry:last-child {
              border-bottom-left-radius: 8px;
              border-bottom-right-radius: 8px;
              border-bottom: 1px solid #ccd;
              overflow: hidden;
            }
            .metadata input {
              box-sizing: border-box;
              border: 0;
              border-radius: 0;
              height: 22px;
              padding: 1px 4px 0 6px;
            }
            .metadata input[name='key'] {
              border-right: 1px solid #ccd;
              flex: 0 0 120px;
            }
            .metadata input[name='value'] {
              flex: 1;
              box-sizing: border-box;
            }
            button {
              display: block;
              width: 100%;
              cursor: pointer;
              border-bottom-left-radius: 8px;
              border-bottom-right-radius: 8px;
              padding: 5px 10px;
              outline: 0px;
              color: rgb(255, 255, 255);
              box-shadow: rgba(0, 0, 0, 0.1) 0px 1px 1px;
              background: rgb(82, 137, 247);
              border: 1px solid rgb(40, 100, 220);
            }
            button:disabled {
              background: #ddd;
              color: #aaa;
              border-color: #bbc;
            }
            button:disabled .fas {
              display: none;
            }
          </style>
          <div class="dropdown-items center rounded">
            <div class="metadata ${this.readOnly ? 'readonly' : ''}">
              ${repeat(
                entries,
                (entry) => `meta-${entry[0]}`,
                ([k, v]) => html`
                  <div class="entry">
                    <input
                      type="text"
                      name="key"
                      value=${k}
                      ?disabled=${this.readOnly}
                      placeholder="Key"
                      @change=${onChange}
                    />
                    <input
                      type="text"
                      name="value"
                      value=${v}
                      ?disabled=${this.readOnly}
                      placeholder="Value"
                      @change=${onChange}
                    />
                  </div>
                `
              )}
              ${this.readOnly && entries.length === 0
                ? html` <div class="empty">No metadata</div> `
                : ''}
              ${!this.readOnly
                ? html`
                    <button
                      class="primary"
                      @click=${onClickSaveMetadata}
                      disabled
                    >
                      <span class="fas fa-fw fa-check"></span> Save
                    </button>
                  `
                : ''}
            </div>
          </div>
        `;
      },
    });
    el.classList.remove('active');
  }

  async onClickResizeImage(e) {
    e.preventDefault();
    var dataUrl = await ResizeImagePopup.create(this.url);
    var base64buf = dataUrl.split(',').pop();
    await this.drive.writeFile(this.resolvedPath, base64buf, 'base64');
  }

  async onClickView() {
    this.attachedPane = nomad.panes.getAttachedPane();
    if (!this.attachedPane) {
      this.attachedPane = await nomad.panes.create(this.url, { attach: true });
    } else {
      nomad.panes.navigate(this.attachedPane.id, this.url);
    }
  }

  async onClickSave() {
    if (this.readOnly) return;
    var model = this.editor.getModel(this.url);
    let st = await this.drive.stat(this.resolvedPath).catch((e) => undefined);
    let metadata = st && st.metadata ? st.metadata : undefined;
    await this.drive.writeFile(this.resolvedPath, model.getValue(), {
      metadata,
    });
    this.lastSavedVersionId = model.getAlternativeVersionId();
    if (this.attachedPane) {
      this.attachedPane = nomad.panes.getAttachedPane();
      nomad.panes.navigate(this.attachedPane.id, this.attachedPane.url);
    }
    this.setSaveBtnState();
    this.setFocus();
  }

  async onClickRename(oldpath) {
    if (this.readOnly) return;
    var folderPath = oldpath.split('/').slice(0, -1).join('/');
    var oldname = oldpath.split('/').pop();
    var newname = prompt('Enter the new name of this file', oldname);
    if (!newname) return;
    var newpath = joinPath(folderPath, newname);
    await this.drive.rename(oldpath, newpath);

    this.loadExplorer();
    if (this.resolvedPath === oldpath) {
      let oldurl = this.url;
      let urlp = new URL(this.url);
      urlp.pathname = newpath;
      this.load(urlp.toString());
      if (this.attachedPane) {
        this.attachedPane = nomad.panes.getAttachedPane();
        if (this.attachedPane.url === oldurl) {
          nomad.panes.navigate(this.attachedPane.id, urlp.toString());
        }
      }
    }
  }

  async onClickDelete(path) {
    if (this.readOnly) return;
    if (confirm('Are you sure you want to delete this file?')) {
      let st = await this.drive.stat(path);
      if (st.mount && st.mount.key) {
        await this.drive.unmount(path);
      } else if (st.isDirectory()) {
        await this.drive.rmdir(path, { recursive: true });
      } else {
        await this.drive.unlink(path);
      }

      this.loadExplorer();
      if (this.attachedPane) {
        this.attachedPane = nomad.panes.getAttachedPane();
        if (this.attachedPane.url === this.url) {
          nomad.panes.navigate(this.attachedPane.id, this.url);
        }
      }
      if (this.resolvedPath === path) {
        this.load(this.url);
      }
    }
  }

  async onClickNewFolder(folderPath) {
    if (this.readOnly) return;
    var name = prompt('Enter the new folder name');
    if (name) {
      let path = joinPath(folderPath, name);
      await this.drive.mkdir(path);
      this.loadExplorer();
    }
  }

  async onClickNewFile(folderPath, defaultName = '') {
    if (this.readOnly) return;
    var name = prompt('Enter the new file name', defaultName);
    if (name) {
      let path = joinPath(folderPath, name);
      await this.drive.writeFile(path, '');
      this.loadExplorer();
      this.load(joinPath(this.drive.url, path), true);
    }
  }

  async onClickNewMount(folderPath) {
    if (this.readOnly) return;
    var url = await nomad.shell.selectDriveDialog();
    if (!url) return;
    var name = await prompt('Enter the new mount name');
    if (!name) return;
    await this.drive.mount(joinPath(folderPath, name), url);
    this.loadExplorer();
  }

  async onClickImportFiles(folderPath) {
    toast.create('Importing...');
    try {
      var { numImported } = await nomad.shell.importFilesDialog(
        joinPath(this.drive.url, folderPath)
      );
      if (numImported > 0) toast.create('Import complete', 'success');
      else toast.destroy();
    } catch (e) {
      console.log(e);
      toast.create(e.toString(), 'error');
    }
    this.loadExplorer();
  }

  async onClickImportFolders(folderPath) {
    toast.create('Importing...');
    try {
      var { numImported } = await nomad.shell.importFoldersDialog(
        joinPath(this.drive.url, folderPath)
      );
      if (numImported > 0) toast.create('Import complete', 'success');
      else toast.destroy();
    } catch (e) {
      console.log(e);
      toast.create(e.toString(), 'error');
    }
    this.loadExplorer();
  }

  async onClickExportFiles(urls) {
    toast.create('Exporting...');
    try {
      var { numExported } = await nomad.shell.exportFilesDialog(urls);
      if (numExported > 0) toast.create('Export complete', 'success');
      else toast.destroy();
    } catch (e) {
      console.log(e);
      toast.create(e.toString(), 'error');
    }
  }

  async onClickFork(e) {
    var urlp = new URL(this.url);
    var newDrive = await nomad.fs.forkDrive(this.url);
    var newDriveUrlp = new URL(newDrive.url);
    urlp.hostname = newDriveUrlp.hostname;

    nomad.browser.gotoUrl(urlp.toString());
    this.load(urlp.toString());
  }
}

customElements.define('editor-app', EditorApp);
