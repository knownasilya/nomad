// Ambient TypeScript declarations for the global `beaker` API, fed to the Monaco
// language service via monaco.languages.typescript.*Defaults.addExtraLib().
//
// KEEP IN SYNC with the actual API surface. Per ../../../../CLAUDE.md, when a
// beaker.* method is added or changed, update all three:
//   1. nomad.dev/content/docs/api/apis/<api-name>.md
//   2. NOMAD_API_REFERENCE in app/bg/web-apis/bg/ai.js
//   3. this file
//
// Authored as a JS module exporting a template-literal string so it bundles with
// the editor with zero extra build config (no .d.ts asset handling needed).

export const BEAKER_DTS = `
declare namespace Beaker {
  /** A stat object describing a file or directory in a hyperdrive. */
  interface Stat {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    blocks: number;
    downloaded: number;
    mtime: Date;
    ctime: Date;
    metadata: Record<string, string>;
    /** Present when the entry is a mount point. */
    mount?: { key: string };
    /** Present when the entry is a symlink. */
    linkname?: string;
  }

  /** Metadata describing a hyperdrive. */
  interface DriveInfo {
    key: string;
    url: string;
    writable: boolean;
    version: number;
    title: string;
    description: string;
    /** Tags applied to the drive in the local library. */
    tags?: string[];
  }

  interface ReadOptions { encoding?: 'utf8' | 'json' | 'binary' | 'base64' | 'hex'; }
  interface ReaddirOptions { recursive?: boolean; includeStats?: boolean; }
  interface DirEntry { name: string; stat: Stat; }
  interface QueryOptions {
    path?: string | string[];
    drive?: string | string[];
    metadata?: Record<string, string>;
    type?: 'file' | 'directory' | 'mount';
    sort?: 'name' | 'ctime' | 'mtime';
    reverse?: boolean;
    limit?: number;
    offset?: number;
  }
  interface QueryResult { type: string; path: string; url: string; stat: Stat; drive: string; mount?: string; }
  interface DiffEntry { change: 'add' | 'del' | 'mod'; type: 'file' | 'dir' | 'mount'; path: string; }

  /** A watcher returned by drive.watch(); an EventTarget that emits 'changed'. */
  interface DriveWatcher extends EventTarget {}

  /** Operations scoped to a single hyperdrive. Paths are relative to the drive root. */
  interface Drive {
    url: string;
    version: number | null;
    getInfo(opts?: object): Promise<DriveInfo>;
    configure(info: Partial<Pick<DriveInfo, 'title' | 'description'>>, opts?: object): Promise<void>;
    /** Return a read-only view of the drive at a historical version. */
    checkout(version: number): Drive;
    diff(prefix: string, other?: number, opts?: object): Promise<DiffEntry[]>;
    stat(path: string, opts?: object): Promise<Stat>;
    readFile(path: string, opts?: ReadOptions['encoding'] | ReadOptions): Promise<any>;
    writeFile(path: string, data: string | ArrayBuffer | Uint8Array, opts?: ReadOptions['encoding'] | object): Promise<void>;
    unlink(path: string, opts?: object): Promise<void>;
    copy(path: string, dstPath: string, opts?: object): Promise<void>;
    rename(path: string, dstPath: string, opts?: object): Promise<void>;
    updateMetadata(path: string, metadata: Record<string, string>, opts?: object): Promise<void>;
    deleteMetadata(path: string, keys: string | string[], opts?: object): Promise<void>;
    readdir(path?: string, opts?: ReaddirOptions): Promise<string[] | DirEntry[]>;
    mkdir(path: string, opts?: object): Promise<void>;
    rmdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
    symlink(path: string, linkname: string, opts?: object): Promise<void>;
    mount(path: string, opts?: string | { url: string }): Promise<void>;
    unmount(path: string, opts?: object): Promise<void>;
    query(opts: QueryOptions): Promise<QueryResult[]>;
    /** Watch for changes. Returns an EventTarget emitting 'changed'. */
    watch(pathSpec?: string | ((path: string) => void) | null, onChanged?: (path: string) => void): DriveWatcher;
  }

  /** Read/write Hyperdrive files. Methods accept full hyper:// URLs or plain paths. */
  interface Hyperdrive {
    /** Get a Drive instance to scope operations to one drive. */
    drive(url: string | { url: string }): Drive;
    /** Create a new writable drive. */
    createDrive(opts?: { title?: string; description?: string; tags?: string | string[] }): Promise<Drive>;
    /** Create a writable fork of an existing drive. */
    forkDrive(url: string, opts?: { title?: string; description?: string; detached?: boolean }): Promise<Drive>;
    /** Get drive metadata: { key, url, writable, version, title, description }. */
    getInfo(url: string, opts?: object): Promise<DriveInfo>;
    configure(url: string, info: Partial<Pick<DriveInfo, 'title' | 'description'>>, opts?: object): Promise<void>;
    checkout(url: string, version: number): Drive;
    diff(url: string, other?: number, opts?: object): Promise<DiffEntry[]>;
    /** Stat a path: { isFile(), isDirectory(), size, mtime, metadata }. */
    stat(url: string, opts?: object): Promise<Stat>;
    /** Read a file. Defaults to utf8; pass 'binary'/'base64'/'hex' for other encodings. */
    readFile(url: string, opts?: ReadOptions['encoding'] | ReadOptions): Promise<any>;
    /** Write a file (writing to other drives requires permission). */
    writeFile(url: string, data: string | ArrayBuffer | Uint8Array, opts?: ReadOptions['encoding'] | object): Promise<void>;
    unlink(url: string, opts?: object): Promise<void>;
    copy(url: string, dstPath: string, opts?: object): Promise<void>;
    rename(url: string, dstPath: string, opts?: object): Promise<void>;
    updateMetadata(url: string, metadata: Record<string, string>, opts?: object): Promise<void>;
    deleteMetadata(url: string, keys: string | string[], opts?: object): Promise<void>;
    /** List a directory. Returns string[], or { name, stat }[] with { includeStats: true }. */
    readdir(url: string, opts?: ReaddirOptions): Promise<string[] | DirEntry[]>;
    mkdir(url: string, opts?: object): Promise<void>;
    rmdir(url: string, opts?: { recursive?: boolean }): Promise<void>;
    symlink(url: string, linkname: string, opts?: object): Promise<void>;
    mount(url: string, opts?: string | { url: string }): Promise<void>;
    unmount(url: string, opts?: object): Promise<void>;
    query(opts: QueryOptions): Promise<QueryResult[]>;
    watch(pathSpec?: string | ((path: string) => void) | null, onChanged?: (path: string) => void): DriveWatcher;
  }

  /** A collaborative (multi-writer) drive built on Autobase. */
  interface CollaborativeDrive {
    url: string;
    getInfo(opts?: object): Promise<DriveInfo>;
    configure(info: object, opts?: object): Promise<void>;
    entry(path: string, opts?: object): Promise<any>;
    get(path: string, opts?: object): Promise<any>;
    put(path: string, data: any, opts?: object): Promise<void>;
    del(path: string, opts?: object): Promise<void>;
    list(path?: string, opts?: object): Promise<any[]>;
    mkdir(path: string, opts?: object): Promise<void>;
    rmdir(path: string, opts?: object): Promise<void>;
    diff(other: number, opts?: object): Promise<DiffEntry[]>;
    updateMetadata(path: string, metadata: Record<string, string>, opts?: object): Promise<void>;
    watch(pathSpec?: string | ((path: string) => void) | null, onChanged?: (path: string) => void): DriveWatcher;
    stat(path: string, opts?: object): Promise<Stat>;
    readFile(path: string, opts?: ReadOptions['encoding'] | ReadOptions): Promise<any>;
    writeFile(path: string, data: any, opts?: object): Promise<void>;
    unlink(path: string, opts?: object): Promise<void>;
    readdir(path?: string, opts?: ReaddirOptions): Promise<string[] | DirEntry[]>;
    /** Create an invite link granting write access. */
    createInvite(opts?: object): Promise<string>;
    listRequests(): Promise<any[]>;
    approveRequest(writerKey: string, opts?: object): Promise<void>;
    denyRequest(writerKey: string): Promise<void>;
    removeWriter(writerKey: string): Promise<void>;
    listWriters(): Promise<any[]>;
  }

  interface Autobase {
    collaborativeDrive(url: string): CollaborativeDrive;
    createCollaborativeDrive(opts?: { title?: string; description?: string }): Promise<CollaborativeDrive>;
    claimInvite(inviteUrl: string, opts?: object): Promise<any>;
    requestAccess(url: string, opts?: object): Promise<any>;
    getInfo(url: string, opts?: object): Promise<DriveInfo>;
    listWriters(url: string): Promise<any[]>;
    isCollaborativeDrive(url: string): Promise<boolean>;
  }

  type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string };
  interface Ai {
    /** Stream a chat completion. Yields string chunks as they arrive. */
    chat(messages: AiMessage[]): AsyncIterableIterator<string>;
    /** Test connectivity to an AI provider base URL. */
    testConnection(baseUrl: string): Promise<any>;
  }

  interface SelectFileResult { path: string; origin: string; url: string; }
  interface Shell {
    /** Open a file picker. Returns [{ path, origin, url }]. */
    selectFileDialog(opts?: { title?: string; select?: ('file' | 'folder')[]; filters?: object; allowMultiple?: boolean }): Promise<SelectFileResult[]>;
    saveFileDialog(opts?: { title?: string; defaultFilename?: string; extension?: string }): Promise<SelectFileResult>;
    /** Open a drive picker. Returns the selected drive URL. */
    selectDriveDialog(opts?: { title?: string; writable?: boolean; tag?: string }): Promise<string>;
    saveDriveDialog(url: string): Promise<void>;
    tagDrive(url: string, tags: string): Promise<void>;
    unsaveDrive(url: string): Promise<void>;
    listDrives(opts?: { tag?: string; writable?: boolean }): Promise<DriveInfo[]>;
    drivePropertiesDialog(url: string): Promise<void>;
    /** Internal (beaker: pages only). */
    importFilesAndFolders?(opts?: object): Promise<any>;
    importFilesDialog?(opts?: object): Promise<any>;
    importFoldersDialog?(opts?: object): Promise<any>;
    exportFilesDialog?(opts?: object): Promise<any>;
  }

  interface Pane { id: string; url: string; }
  interface Panes extends EventTarget {
    /** Mark this pane as attachable by others. */
    setAttachable(): void;
    getAttachedPane(): Pane | undefined;
    attachToLastActivePane(): Promise<Pane | undefined>;
    create(url: string, opts?: { attach?: boolean }): Promise<Pane>;
    navigate(paneId: string, url: string): Promise<void>;
    focus(paneId: string): Promise<void>;
    executeJavaScript(paneId: string, script: string): Promise<any>;
    injectCss(paneId: string, styles: string): Promise<string>;
    uninjectCss(paneId: string, cssId: string): Promise<void>;
    // Events: 'pane-attached', 'pane-detached', 'pane-navigated'
  }

  interface PeersocketsTopic extends EventTarget {
    /** Send a message to a peer on this topic. */
    send(peerId: number, message: Uint8Array): void;
    // Events: 'message' (e.peerId, e.message)
  }
  interface Peersockets {
    /** Join a named topic, scoped to the current drive's peers. */
    join(topic: string): PeersocketsTopic;
    /** Watch peer join/leave events. Emits 'join' and 'leave'. */
    watch(): EventTarget;
  }

  interface Contacts {
    requestProfile(): Promise<any>;
    requestContact(): Promise<any>;
    requestContacts(): Promise<any[]>;
    requestAddContact(url: string): Promise<any>;
    list(): Promise<any[]>;
    remove(url: string): Promise<void>;
  }

  interface Markdown {
    /** Render a markdown string to an HTML string. */
    toHTML(str: string, opts?: object): string;
  }

  interface SchemaValidateResult { success: boolean; data?: any; error?: string; }
  interface Schemas {
    /** Validate data against a registered schema type (e.g. 'walled.garden/person'). */
    validate(type: string, data: unknown): SchemaValidateResult;
    /** List the available schema type names. */
    list(): string[];
  }

  interface Capabilities {
    create(opts?: object): Promise<any>;
    modify(opts?: object): Promise<any>;
    delete(opts?: object): Promise<any>;
  }

  interface TerminalCommand {
    name: string;
    handle: (...args: any[]) => any;
    help?: string;
    usage?: string;
    options?: any[];
  }
  /** Register webterm commands (available to user-authored code). */
  interface Terminal {
    getCommands(): TerminalCommand[];
    registerCommand(command: TerminalCommand): void;
    unregisterCommand(name: string): void;
  }

  /** Browser-control API (available only on beaker: pages, not hyper:// sites). */
  interface Browser {
    openUrl(url: string, opts?: object): Promise<void>;
    gotoUrl(url: string): Promise<void>;
    fetchBody(url: string): Promise<string>;
    getResourceContentType(url: string): string;
    showContextMenu(items: any[]): Promise<any>;
    getInfo(): Promise<any>;
    getSetting(key: string): Promise<any>;
    setSetting(key: string, value: any): Promise<void>;
    [method: string]: (...args: any[]) => any;
  }

  /** The global beaker object. Some namespaces are gated by page protocol. */
  interface Root {
    hyperdrive: Hyperdrive;
    autobase: Autobase;
    ai: Ai;
    shell: Shell;
    panes: Panes;
    peersockets: Peersockets;
    contacts: Contacts;
    markdown: Markdown;
    schemas: Schemas;
    capabilities: Capabilities;
    terminal: Terminal;
    /** Available only on beaker: pages. */
    browser: Browser;
  }
}

declare const beaker: Beaker.Root;
`;
