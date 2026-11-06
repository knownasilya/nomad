// The right-click menu for the shell window's own UI (the AI Sidebar's messages and input, the
// location bar's neighbours, find-in-page, …). Parts of the shell with their own menu (tabs,
// pins, groups, the location bar) call preventDefault on `contextmenu`, so Electron never asks
// here for them. Everything else gets a plain edit menu, and nothing when there is nothing to
// edit or copy. Pure, so it is unit-tested (tests/unit/shell-context-menu.test.js); context-menu.js
// turns each `action` into a webContents call.

const WEB_LINK = /^(https?|hyper|nomad):/i;

export function shellMenuTemplate(props = {}) {
  const editFlags = props.editFlags || {};
  const hasText = String(props.selectionText || '').trim().length > 0;
  const items = [];

  if (props.isEditable && props.misspelledWord) {
    for (const word of props.dictionarySuggestions || []) {
      items.push({ label: word, action: 'replaceMisspelling', word });
    }
    items.push({
      label: 'Add to Dictionary',
      action: 'addToDictionary',
      word: props.misspelledWord,
    });
    items.push({ type: 'separator' });
  }

  if (props.linkURL && WEB_LINK.test(props.linkURL)) {
    items.push({
      label: 'Copy Link Address',
      action: 'copyLink',
      url: props.linkURL,
    });
    items.push({ type: 'separator' });
  }

  if (props.isEditable) {
    items.push({
      label: 'Cut',
      action: 'cut',
      enabled: !!editFlags.canCut && hasText,
    });
    items.push({
      label: 'Copy',
      action: 'copy',
      enabled: !!editFlags.canCopy && hasText,
    });
    items.push({
      label: 'Paste',
      action: 'paste',
      enabled: !!editFlags.canPaste,
    });
    items.push({
      label: 'Select All',
      action: 'selectAll',
      enabled: editFlags.canSelectAll !== false,
    });
  } else if (hasText) {
    items.push({
      label: 'Copy',
      action: 'copy',
      enabled: editFlags.canCopy !== false,
    });
  }

  // no trailing or doubled separators
  while (items.length && items[items.length - 1].type === 'separator')
    items.pop();
  return items.filter(
    (it, i) => !(it.type === 'separator' && items[i - 1]?.type === 'separator'),
  );
}
