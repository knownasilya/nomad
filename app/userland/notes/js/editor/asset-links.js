// Links from a Note to Assets (ADR-0044 amendment): a file, a folder or a tag. Typing [[ offers
// them after the other notes, and [[# offers the tags. Picking one writes a Markdown link,
// [Recipe.pdf](nomad://assets/?id=…), which desktop opens in nomad://assets and the phone on its
// Assets screen (shared/item-links.mjs parseItemLink).
//
// The host hands the editor what listAssets gave it: { assets: [{ id, name, kind, folder?, tags? }], folders }.

import { assetLink, assetFolderLink, assetTagLink } from '../../../../../shared/item-links.mjs';
import { tagCounts, folderName, KIND_LABELS } from '../../../../../shared/assets.mjs';

const MAX_FILES = 400;

// A link's text: no brackets, which would end it early.
const text = (s) => String(s || '').replace(/[[\]]/g, '').trim() || 'file';

// [{ kind: 'file' | 'folder' | 'tag', label, detail, link }] from listAssets' answer.
export function assetOptions(data) {
  const assets = Array.isArray(data?.assets) ? data.assets : [];
  const folders = Array.isArray(data?.folders) ? data.folders : [];
  const out = [];
  for (const a of assets.slice(0, MAX_FILES)) {
    if (!a || typeof a.id !== 'string' || typeof a.name !== 'string') continue;
    out.push({
      kind: 'file',
      label: a.name,
      detail: [KIND_LABELS[a.kind] || 'File', a.folder ? a.folder.split('/').join(' › ') : ''].filter(Boolean).join(' · '),
      link: `[${text(a.name)}](${assetLink(a.id)})`,
    });
  }
  for (const f of folders) {
    if (typeof f !== 'string' || !f) continue;
    const parent = f.split('/').slice(0, -1).join(' › ');
    out.push({ kind: 'folder', label: folderName(f), detail: parent ? `Folder in ${parent}` : 'Folder', link: `[${text(folderName(f))}](${assetFolderLink(f)})` });
  }
  for (const { tag, count } of tagCounts(assets)) {
    out.push({ kind: 'tag', label: `#${tag}`, detail: `Tag · ${count} file${count === 1 ? '' : 's'}`, link: `[#${text(tag)}](${assetTagLink(tag)})` });
  }
  return out;
}

const SECTIONS = {
  file: { name: 'Files in Assets', rank: 1 },
  folder: { name: 'Folders in Assets', rank: 2 },
  tag: { name: 'Tags in Assets', rank: 3 },
};

// The completions for a set of options, replacing the "[[…" (from `start`) with the link.
export function assetCompletions(options, start, closed) {
  return options.map((o) => ({
    label: o.label,
    detail: o.detail,
    type: o.kind,
    section: SECTIONS[o.kind],
    apply: (view, completion, from, to) => {
      view.dispatch({
        changes: { from: start, to: closed ? to + 2 : to, insert: o.link },
        selection: { anchor: start + o.link.length },
      });
    },
  }));
}

export function isAssetHref(href) {
  return /^nomad:\/\/assets\//i.test(String(href || ''));
}
