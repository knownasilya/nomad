// The built-in drive templates: what a new Drive can start as. Pure data, shared by the Create Drive
// dialog (fg/modals/create-drive.js) and the main process (bg/hyper/drive-templates.js), which
// copies a template's `files` from app/drive-templates/<id>/ into the new Drive. The Document
// template is a Live Doc (ADR-0025). Blog, Forum, Website and Photo album are copies of the
// nomad.dev gallery's templates (nomad.dev/static/templates/<name>/, without their index.json:
// the Drive's manifest is made from `type`, `fallback`, `collaborative` and `manifest` here).
// `npm run sync:drive-templates` copies them again from a nomad.dev checkout next to this repo.
// The phone gets the same list and files from mobile/lib/driveTemplates.json
// (`npm run build:phone-templates`; tests/unit/drive-templates.test.js keeps them equal).

export interface DriveTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  type?: string;
  fallback?: string;
  collaborative?: boolean;
  // More manifest fields the template's app reads (a Blog's itemsPath, …). The caller's win.
  manifest?: Record<string, unknown>;
  files?: string[];
  // The nomad.dev gallery template this one copies (static/templates/<source>/).
  source?: string;
}

export const DRIVE_TEMPLATES: DriveTemplate[] = [
  {
    id: 'blank',
    title: 'Blank',
    description: 'An empty drive for any files you like.',
    icon: 'far fa-file',
  },
  {
    id: 'document',
    title: 'Document',
    description: 'A page several people can edit at the same time.',
    icon: 'far fa-file-alt',
    type: 'walled.garden/document',
    fallback: '/index.html',
    collaborative: true,
    files: ['/index.html', '/app.js'],
  },
  {
    id: 'blog',
    title: 'Blog',
    description: 'Posts people can read and follow in Reader.',
    icon: 'fas fa-rss',
    type: 'walled.garden/feed',
    fallback: '/index.html',
    collaborative: true,
    manifest: { itemsPath: '/posts/', itemType: 'walled.garden/post', language: 'en' },
    files: ['/index.html', '/app.js'],
    source: 'blog',
  },
  {
    id: 'website',
    title: 'Website',
    description: 'Pages you write and edit in place.',
    icon: 'fas fa-globe',
    fallback: '/index.html',
    files: ['/index.html', '/ui.js', '/ui.css'],
    source: 'simple-cms',
  },
  {
    id: 'photo-album',
    title: 'Photo album',
    description: 'Photos with captions, to share.',
    icon: 'far fa-images',
    files: ['/index.html', '/index.js', '/index.css'],
    source: 'photo-album',
  },
  {
    id: 'forum',
    title: 'Forum',
    description: 'Topics and replies from everyone you let in.',
    icon: 'far fa-comments',
    type: 'walled.garden/forum',
    fallback: '/index.html',
    collaborative: true,
    files: ['/index.html', '/app.js'],
    source: 'forum',
  },
];
