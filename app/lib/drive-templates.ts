// The built-in drive templates: what a new Drive can start as. Pure data, shared by the Create Drive
// dialog (fg/modals/create-drive.js) and the main process (bg/hyper/drive-templates.js), which
// copies a template's `files` from app/drive-templates/<id>/ into the new Drive. The Document
// template is a Live Doc (ADR-0025).

export interface DriveTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  type?: string;
  fallback?: string;
  collaborative?: boolean;
  files?: string[];
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
];
