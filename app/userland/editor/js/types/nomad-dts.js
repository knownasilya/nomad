// Ambient TypeScript declarations for the global `nomad` API, fed to the Monaco
// language service via monaco.languages.typescript.*Defaults.addExtraLib().
//
// KEEP IN SYNC with the actual API surface. Per ../../../../CLAUDE.md, when a
// nomad.* method is added or changed, update all three:
//   1. nomad.dev/src/content/docs/docs/api/apis/<api-name>.md
//   2. API_REFERENCE in app/bg/ai/api-reference.mjs
//   3. this file
//
// Authored as a JS module exporting a template-literal string so it bundles with
// the editor with zero extra build config (no .d.ts asset handling needed).

export const NOMAD_DTS = `
declare namespace Nomad {
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
    /** Whether the drive currently accepts writer-access requests (locked/single-writer by default). */
    collaborative?: boolean;
    /** The manifest's type, e.g. 'walled.garden/document' for a Document drive. */
    type?: string;
    /** This Device's writer key for the drive (what listWriters and peersockets report); null if none. */
    writerKey?: string | null;
    /** Tags applied to the drive in the local library. */
    tags?: string[];
  }

  interface ReadOptions { encoding?: 'utf8' | 'json' | 'binary' | 'base64' | 'hex'; }
  interface WriteOptions {
    encoding?: 'utf8' | 'binary' | 'base64' | 'hex';
    /** Keep a small file (up to 4 KB) in the drive's view instead of a blob, so peers see it sooner. */
    inline?: boolean;
    /** false writes live even while the drive's Draft Mode is on; true stages into the Draft. */
    draft?: boolean;
  }
  interface CreateDriveOptions {
    title?: string;
    description?: string;
    /** Accept writer-access requests. A template can default this on (Document does). */
    collaborative?: boolean;
    /** A built-in template: 'blank' (default), 'document' (a page several people edit at once), 'blog', 'website', 'photo-album' or 'forum'. */
    template?: 'blank' | 'document' | 'blog' | 'website' | 'photo-album' | 'forum';
    tags?: string | string[];
  }
  interface ReaddirOptions { recursive?: boolean; includeStats?: boolean; }
  interface DirEntry { name: string; stat: Stat; }
  interface QueryOptions {
    path?: string | string[];
    drive?: string | string[];
    metadata?: Record<string, string>;
    type?: 'file' | 'directory';
    sort?: 'name' | 'ctime' | 'mtime';
    reverse?: boolean;
    limit?: number;
    offset?: number;
  }
  interface QueryResult { type: string; path: string; url: string; stat: Stat; drive: string; }
  interface DiffEntry { change: 'add' | 'del' | 'mod'; type: 'file' | 'dir'; path: string; }

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
    copy(path: string, dstPath: string, opts?: object): Promise<void>;
    rename(path: string, dstPath: string, opts?: object): Promise<void>;
    diff(other: number, opts?: object): Promise<DiffEntry[]>;
    updateMetadata(path: string, metadata: Record<string, string>, opts?: object): Promise<void>;
    deleteMetadata(path: string, keys: string | string[], opts?: object): Promise<void>;
    watch(pathSpec?: string | ((path: string) => void) | null, onChanged?: (path: string) => void): DriveWatcher;
    stat(path: string, opts?: object): Promise<Stat>;
    readFile(path: string, opts?: ReadOptions['encoding'] | ReadOptions): Promise<any>;
    writeFile(path: string, data: any, opts?: object): Promise<void>;
    unlink(path: string, opts?: object): Promise<void>;
    readdir(path?: string, opts?: ReaddirOptions): Promise<string[] | DirEntry[]>;
    /** An invite link to edit this drive. Whoever claims it is added at once: once, for 7 days, unless multiUse or days (1 to 30). */
    createInvite(opts?: { multiUse?: boolean; days?: number; note?: string }): Promise<string>;
    listRequests(): Promise<any[]>;
    /** Watch for writer-access requests arriving over the network; emits 'changed'. */
    watchRequests(onRequest?: (e: any) => void): DriveWatcher;
    approveRequest(writerKey: string, opts?: object): Promise<void>;
    denyRequest(writerKey: string): Promise<void>;
    removeWriter(writerKey: string): Promise<void>;
    listWriters(): Promise<any[]>;
  }

  interface Autobase {
    collaborativeDrive(url: string): CollaborativeDrive;
    createCollaborativeDrive(opts?: { title?: string; description?: string; prompt?: false }): Promise<CollaborativeDrive>;
    claimInvite(inviteUrl: string, opts?: object): Promise<any>;
    requestAccess(url: string, opts?: object): Promise<any>;
    getInfo(url: string, opts?: object): Promise<DriveInfo>;
    listWriters(url: string): Promise<any[]>;
    isCollaborativeDrive(url: string): Promise<boolean>;
  }

  type AiContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };
  type AiMessage = {
    role: 'system' | 'user' | 'assistant';
    /** Plain text, or text and image_url parts. */
    content: string | AiContentPart[];
    /** One or more images for this message: data:image (png, jpeg, webp, gif) or http(s) URLs. At most 8. Appended after content. */
    images?: Array<string | { url: string }>;
  };
  interface AiChatOpts {
    /** Resolve tools + AI Config against this Drive instead of the caller's URL. */
    driveUrl?: string;
    /** Withhold the file-write tool when false (e.g. read-only Drives). */
    allowWrite?: boolean;
    /** Override the resolved model for this turn (from a chat UI's model picker). */
    model?: string;
    /** When false, ask the runtime to skip its reasoning phase. Default true. */
    think?: boolean;
    /** When false, a plain completion: no search/execute tools and no standing tool prompt. Default true. */
    tools?: boolean;
    /** Cap the completion. Sent as max_tokens. Values above 8192 are clamped. */
    maxTokens?: number;
    /** Reasoning effort ('low' | 'medium' | 'high'); sent as reasoning_effort when think !== false. */
    effort?: 'low' | 'medium' | 'high';
    /**
     * Fires for each tool call the agent makes. \`phase\` is 'start' ({ id, parentId?, name, summary }),
     * 'end' ({ id, error? }; same id as its start), 'write' ({ drive, path, priorContent, draft }),
     * 'screenshot' ({ imageDataUrl }) or 'note' ({ summary }).
     */
    onToolEvent?: (e: any) => void;
    /** Fires per reasoning-stream chunk (only when think !== false and the model emits one). */
    onReasoning?: (text: string) => void;
  }
  interface Ai {
    /** Stream a chat completion. Yields string chunks as they arrive. */
    chat(messages: AiMessage[], opts?: AiChatOpts): AsyncIterableIterator<string>;
    /** Test connectivity to an AI provider base URL. */
    testConnection(baseUrl: string): Promise<any>;
    /** Models for the active runtime. labels maps a model to a readable name when the runtime gives one (the Claude CLI does). */
    listModels(): Promise<{ models: string[]; current: string | null; labels?: Record<string, string> }>;
    /** Detected local runtimes and named OpenAI servers: { active, model, runtimes }. */
    listRuntimes(): Promise<{
      active: string;
      model: string;
      runtimes: Array<{
        id: string;
        name: string;
        kind: 'openai' | 'claude' | 'cursor';
        detected: boolean;
        available: boolean;
        baseUrl: string;
        hasToken: boolean;
      }>;
    }>;
    /** Tools a turn can reach: { builtin: search and execute, capabilities, page, pageOrigin, pageGranted }. */
    listTools(opts?: { driveUrl?: string; allowWrite?: boolean }): Promise<any>;
    /** Whether a model is a reasoning and/or vision model. vision is reliable for Ollama only. */
    modelInfo(model: string): Promise<{ reasoning: boolean; vision: boolean; probed: boolean }>;
  }

  interface SelectFileResult { path: string; origin: string; url: string; }
  interface Shell {
    /**
     * Open a file picker. Returns [{ path, origin, url }]. A web page always gets read-only
     * capability URLs (\`hyper://<token>.cap/<path>\`) for just the picked files or folders, never the
     * drive's own URL; they can come from the user's private drive. Read them with nomad.fs. Each
     * lasts until the user removes it in site-info or the page calls nomad.capabilities.delete(url).
     * Only nomad:// pages get the drive's own URLs (unless they pass \`capability: true\`).
     */
    selectFileDialog(opts?: { title?: string; buttonLabel?: string; drive?: string; defaultPath?: string; select?: ('file' | 'folder')[]; filters?: { extensions?: string[]; writable?: boolean; networked?: boolean }; allowMultiple?: boolean; disallowCreate?: boolean; capability?: boolean }): Promise<SelectFileResult[]>;
    saveFileDialog(opts?: { title?: string; defaultFilename?: string; extension?: string }): Promise<SelectFileResult>;
    /**
     * Open a drive picker. Returns the selected drive URL (an array with \`allowMultiple\`). The dialog
     * warns the user that the site keeps the drive's address. Unless \`writable: true\` is asked, the
     * user can share it read-only instead, and the page then gets a whole-drive capability URL
     * (\`hyper://<token>.cap/\`) they can take back in site-info.
     */
    selectDriveDialog(opts?: { title?: string; buttonLabel?: string; writable?: boolean; tag?: string; allowMultiple?: boolean; template?: string }): Promise<string | string[]>;
    saveDriveDialog(url: string): Promise<void>;
    tagDrive(url: string, tags: string): Promise<void>;
    unsaveDrive(url: string): Promise<void>;
    listDrives(opts?: { tag?: string; writable?: boolean }): Promise<DriveInfo[]>;
    drivePropertiesDialog(url: string): Promise<void>;
    /** Internal (nomad: pages only). */
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
    send(peerId: string, message: Uint8Array): void;
    // Events, for peers that joined this topic:
    //   'join' (e.peerId), 'leave' (e.peerId)
    //   'writer' (e.peerId, e.writerKey): the peer proved it is a current writer of this drive
    //   'message' (e.peerId, e.message, e.writerKey): writerKey is null until the peer proved it
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

  /** A login a site holds (ADR-0031). profile only when the user left that permission checked. */
  interface Session {
    /** Random, made for this site, Persona and Space. The same each visit until the user logs out. */
    id: string;
    /** What the user granted: 'profile', 'modifyDrive', 'email' and/or 'vouches'. A partial grant is normal. */
    perms: Array<'profile' | 'modifyDrive' | 'email' | 'vouches'>;
    profile?: { url: string; title: string; thumb?: string };
    /** The Persona's email, only with 'email'. Not verified by Nomad. */
    email?: string;
    /**
     * Only with 'vouches': the vouches the user ticked, each saying its host has had this Persona over.
     * Check each against its host's /.data/walled.garden/vouches-given.json before you trust it.
     */
    vouches?: WalledGarden.Vouch[];
    createdAt: string;
    expiresAt?: string;
  }

  interface SessionChangeEvent {
    type: 'change';
    /** The new Session, or null once logged out. */
    session: Session | null;
  }

  /** Log the user in with one of their Personas. Only the login prompt makes a Session. */
  interface SessionApi {
    /**
     * Show the login prompt. Rejects with UserDeniedError on a cancel, a "no", or no Persona.
     * perms: 'profile' (the Persona's drive URL, name and picture), 'modifyDrive' (write that drive),
     * 'email' (the Persona's email, which Nomad doesn't verify), 'vouches' (the vouches the user ticks;
     * needs and asks for 'profile').
     * maxAge: seconds until the Session ends (no expiry by default).
     */
    requestLogin(opts?: { perms?: Array<'profile' | 'modifyDrive' | 'email' | 'vouches'>; maxAge?: number }): Promise<Session>;
    /** The Session the prompt already made, or null. Never prompts. */
    getCurrent(): Promise<Session | null>;
    /** Log out. */
    revoke(): Promise<void>;
    addEventListener(type: 'change', cb: (e: SessionChangeEvent) => void): void;
    removeEventListener(type: 'change', cb: (e: SessionChangeEvent) => void): void;
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

  /**
   * Capability URLs (\`hyper://<token>.cap/\`): stand-ins for a drive, or one file or folder in it, that
   * give read access without naming the drive's key, and can be revoked. A page's own are in memory
   * on this Device only; ones the user shared (the file picker, or the drive dialog's read-only share)
   * are kept.
   * Read them with nomad.fs; writes and drive management through one are refused.
   */
  interface Capabilities {
    /** Make a capability for a drive (\`hyper://<key>/\` or \`hyper://<key>+<version>/\`). Resolves to the \`hyper://<token>.cap/\` URL. */
    create(targetUrl: string): Promise<string>;
    /** Point a capability this page made at another drive. */
    modify(capUrl: string, targetUrl: string): Promise<void>;
    /** Revoke a capability this page made, or a file or folder the user picked for it. Later reads through it fail. */
    delete(capUrl: string): Promise<void>;
    /** This page's capabilities: the ones it made, and the files and folders the user picked for it. */
    list(): Promise<CapabilityRecord[]>;
  }
  interface CapabilityRecord {
    /** The capability URL (for a picked item, its own path: \`hyper://<token>.cap/photos/a.png\`). */
    url: string;
    /** What it covers: '/' for a whole drive, '/dir/' for a folder, '/file' for one file. */
    path: string;
    /** True when the user shared it (file picker, or the drive dialog's read-only share); kept across restarts. */
    picked: boolean;
    title: string;
    createdAt: number;
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

  /** Browser-control API (available only on nomad: pages, not hyper:// sites). */
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

  /** A filesystem handle scoped to one drive, returned by nomad.fs.drive(url). */
  interface FsDrive {
    readonly url: string;
    getInfo(opts?: object): Promise<DriveInfo>;
    entry(path: string, opts?: object): Promise<any>;
    stat(path: string, opts?: object): Promise<Stat>;
    /** Read a file. encoding 'utf8'|'binary'|'base64'|'hex'|'json' (json parses for you). */
    get(path: string, opts?: object | string): Promise<any>;
    readFile(path: string, opts?: object | string): Promise<any>;
    list(path?: string, opts?: object): Promise<any[]>;
    readdir(path?: string, opts?: object): Promise<any[]>;
    query(path?: string, opts?: object): Promise<any[]>;
    diff(other: string, opts?: object): Promise<any[]>;
    put(path: string, data: any, opts?: WriteOptions | string): Promise<void>;
    writeFile(path: string, data: any, opts?: WriteOptions | string): Promise<void>;
    del(path: string, opts?: object): Promise<void>;
    unlink(path: string, opts?: object): Promise<void>;
    mkdir(path: string, opts?: object): Promise<void>;
    rmdir(path: string, opts?: object): Promise<void>;
    copy(src: string, dst: string, opts?: object): Promise<void>;
    rename(src: string, dst: string, opts?: object): Promise<void>;
    watch(pathSpec?: string | null, onChanged?: (e: any) => void): EventTarget;
    configure(info: object, opts?: object): Promise<void>;
    forkDrive(opts?: object): Promise<FsDrive>;
    updateMetadata(path: string, metadata: object, opts?: object): Promise<void>;
    deleteMetadata(path: string, keys: string[], opts?: object): Promise<void>;
    // collaborative-drive writer management (this drive)
    createInvite(opts?: object): Promise<string>;
    listRequests(): Promise<any[]>;
    watchRequests(onRequest?: (e: any) => void): EventTarget;
    approveRequest(writerKey: string, opts?: object): Promise<void>;
    denyRequest(writerKey: string): Promise<void>;
    removeWriter(writerKey: string): Promise<void>;
    listWriters(): Promise<any[]>;
    // Draft Mode (ADR-0012) — device-private staging in the Vault. While Draft Mode is on, put/del
    // stage instead of going live; pass { draft:true } to a read to preview the merged view.
    beginDraft(): Promise<{ on: boolean }>;
    endDraft(): Promise<{ on: boolean }>;
    draftStatus(): Promise<{ mode: boolean; changes: Array<{ path: string; op: 'put' | 'del'; conflict: boolean }> }>;
    publishDraft(opts?: { paths?: string[]; force?: boolean }): Promise<{ published: string[]; conflicts: string[] }>;
    discardDraft(opts?: { paths?: string[] }): Promise<{ discarded: string[] }>;
    setDraftPreview(on: boolean): Promise<{ on: boolean }>;
    watchDraft(onChanged?: (e: any) => void): EventTarget;
  }

  /**
   * Unified, backend-agnostic filesystem API over the drive backend — single-writer
   * Hyperdrives AND multi-writer Autobase collaborative drives. It detects the backend for a
   * hyper:// URL and dispatches, so one code path works for any drive (no more "try hyperdrive,
   * fall back to autobase"). Use nomad.fs.drive(url) for a scoped handle, or the url-first
   * helpers below. stat carries real mtime/ctime/size; get(..., 'json') parses.
   */
  interface Fs {
    drive(url: string): FsDrive;
    getInfo(url: string, opts?: object): Promise<DriveInfo>;
    entry(url: string, opts?: object): Promise<any>;
    stat(url: string, opts?: object): Promise<Stat>;
    get(url: string, opts?: object | string): Promise<any>;
    readFile(url: string, opts?: object | string): Promise<any>;
    list(url: string, opts?: object): Promise<any[]>;
    readdir(url: string, opts?: object): Promise<any[]>;
    query(url: string, opts?: object): Promise<any[]>;
    diff(url: string, other: string, opts?: object): Promise<any[]>;
    put(url: string, data: any, opts?: WriteOptions | string): Promise<void>;
    writeFile(url: string, data: any, opts?: WriteOptions | string): Promise<void>;
    del(url: string, opts?: object): Promise<void>;
    unlink(url: string, opts?: object): Promise<void>;
    mkdir(url: string, opts?: object): Promise<void>;
    rmdir(url: string, opts?: object): Promise<void>;
    copy(src: string, dst: string, opts?: object): Promise<void>;
    rename(src: string, dst: string, opts?: object): Promise<void>;
    watch(url: string, pathSpec?: string | null, onChanged?: (e: any) => void): EventTarget;
    // drive lifecycle (new drives are Autobase-from-birth)
    createDrive(opts?: CreateDriveOptions): Promise<FsDrive>;
    createCollaborativeDrive(opts?: CreateDriveOptions): Promise<FsDrive>;
    forkDrive(url: string, opts?: object): Promise<FsDrive>;
    loadDrive(url: string): Promise<any>;
    configure(url: string, info: object, opts?: object): Promise<void>;
    isCollaborativeDrive(url: string): Promise<boolean>;
    updateMetadata(url: string, metadata: object, opts?: object): Promise<void>;
    deleteMetadata(url: string, keys: string[], opts?: object): Promise<void>;
    importFromFilesystem(opts?: object): Promise<any>;
    exportToFilesystem(opts?: object): Promise<any>;
    exportToDrive(opts?: object): Promise<any>;
    // collaborative-drive writer management (url-first)
    /** An invite link to edit the drive. Whoever claims it is added at once: once, for 7 days, unless multiUse or days (1 to 30). */
    createInvite(url: string, opts?: { multiUse?: boolean; days?: number; note?: string }): Promise<string>;
    /** Accept an invite link: the drive's writers add this device when one of them is online. */
    claimInvite(inviteUrl: string, opts?: { profileUrl?: string }): Promise<{ writerKey: string; writable: boolean }>;
    requestAccess(url: string, opts?: object): Promise<any>;
    listRequests(url: string): Promise<any[]>;
    watchRequests(url: string, onRequest?: (e: any) => void): EventTarget;
    approveRequest(url: string, writerKey: string, opts?: object): Promise<void>;
    denyRequest(url: string, writerKey: string): Promise<void>;
    removeWriter(url: string, writerKey: string): Promise<void>;
    listWriters(url: string): Promise<any[]>;
    // Draft Mode (ADR-0012, url-first). While a Drive's Draft Mode is on, put/del stage into the
    // Vault-hosted Draft instead of going live; pass { draft:true } to a read to preview the merge.
    beginDraft(url: string): Promise<{ on: boolean }>;
    endDraft(url: string): Promise<{ on: boolean }>;
    draftStatus(url: string): Promise<{ mode: boolean; changes: Array<{ path: string; op: 'put' | 'del'; conflict: boolean }> }>;
    publishDraft(url: string, opts?: { paths?: string[]; force?: boolean }): Promise<{ published: string[]; conflicts: string[] }>;
    discardDraft(url: string, opts?: { paths?: string[] }): Promise<{ discarded: string[] }>;
    setDraftPreview(url: string, on: boolean): Promise<{ on: boolean }>;
    watchDraft(url: string, onChanged?: (e: any) => void): EventTarget;
  }

  /** A parsed hyper:// URL. \`key\` is as written in the URL (64-char hex or 52-char z-base-32). */
  interface ParsedUrl {
    url: string;
    origin: string;
    key: string;
    version: string | null;
    path: string;
    search: string;
  }

  /** The global nomad object. Some namespaces are gated by page protocol. */
  interface Root {
    /**
     * This page's own identity — the authoritative way for a drive frontend to learn its drive and
     * current route (use nomad.page.path instead of location.pathname, which is unreliable in the
     * mobile WebView). null on non-hyper pages.
     */
    page: ParsedUrl | null;
    /** Parse a hyper:// URL into { url, origin, key, version, path, search }. null if not hyper. */
    parseUrl(url: string): ParsedUrl | null;
    fs: Fs;
    ai: Ai;
    shell: Shell;
    panes: Panes;
    peersockets: Peersockets;
    contacts: Contacts;
    /** Log the user in with one of their Personas (ADR-0031). */
    session: SessionApi;
    markdown: Markdown;
    schemas: Schemas;
    capabilities: Capabilities;
    terminal: Terminal;
    /** Available only on nomad: pages. */
    browser: Browser;
  }
}

declare const nomad: Nomad.Root;

// --- WebMCP (document.modelContext) ---
// A DOM polyfill Nomad injects into every eligible page (not a nomad.* API), so page
// scripts can register tools that Nomad's AI assistant may call. See
// nomad.dev/src/content/docs/docs/api/developers/webmcp.md.
declare namespace WebMCP {
  interface ToolDefinition {
    name: string;
    description: string;
    /** JSON Schema for the tool's arguments. */
    inputSchema?: object;
    /** Runs in the page; return { content: [{ type: 'text', text }] } (or a string). */
    execute: (args: any) => any | Promise<any>;
  }
  interface RegisteredTool {
    name: string;
    description: string;
    inputSchema?: object;
  }
  interface ModelContext {
    /** Register a tool. Pass { signal } and abort it to unregister. */
    registerTool(tool: ToolDefinition, opts?: { signal?: AbortSignal }): Promise<void>;
    getTools(): Promise<RegisteredTool[]>;
    executeTool(tool: RegisteredTool | string, argsJson: string): Promise<any>;
    addEventListener(type: 'toolchange', listener: () => void): void;
    removeEventListener(type: 'toolchange', listener: () => void): void;
  }
}
interface Document {
  readonly modelContext?: WebMCP.ModelContext;
}
interface Navigator {
  /** @deprecated use document.modelContext */
  readonly modelContext?: WebMCP.ModelContext;
}
`;
