import { describe, it, expect } from 'vitest';
import { shellMenuTemplate } from '../../app/bg/ui/shell-context-menu.mjs';

const labels = (items) => items.map((it) => it.label || '---');
const flags = (over = {}) => ({
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
  ...over,
});

describe('shellMenuTemplate', () => {
  it('gives nothing when there is nothing to edit or copy', () => {
    expect(
      shellMenuTemplate({ selectionText: '', editFlags: flags() }),
    ).toEqual([]);
    expect(shellMenuTemplate({})).toEqual([]);
  });

  it('offers Copy for selected text in a message', () => {
    const items = shellMenuTemplate({
      selectionText: 'hello',
      editFlags: flags(),
    });
    expect(labels(items)).toEqual(['Copy']);
    expect(items[0]).toMatchObject({ action: 'copy', enabled: true });
  });

  it('offers the full edit menu in the input, with Paste even when nothing is selected', () => {
    const items = shellMenuTemplate({
      isEditable: true,
      selectionText: '',
      editFlags: flags({ canCut: false, canCopy: false }),
    });
    expect(labels(items)).toEqual(['Cut', 'Copy', 'Paste', 'Select All']);
    expect(items.map((it) => it.enabled)).toEqual([false, false, true, true]);
  });

  it('enables Cut and Copy for selected text in the input', () => {
    const items = shellMenuTemplate({
      isEditable: true,
      selectionText: 'abc',
      editFlags: flags(),
    });
    expect(items.slice(0, 2).map((it) => it.enabled)).toEqual([true, true]);
  });

  it('adds spelling suggestions in the input', () => {
    const items = shellMenuTemplate({
      isEditable: true,
      selectionText: '',
      misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'ten'],
      editFlags: flags(),
    });
    expect(labels(items)).toEqual([
      'the',
      'ten',
      'Add to Dictionary',
      '---',
      'Cut',
      'Copy',
      'Paste',
      'Select All',
    ]);
    expect(items[0]).toMatchObject({
      action: 'replaceMisspelling',
      word: 'the',
    });
    expect(items[2]).toMatchObject({ action: 'addToDictionary', word: 'teh' });
  });

  it('offers Copy Link Address on a link in an answer', () => {
    const items = shellMenuTemplate({
      linkURL: 'https://example.com/',
      selectionText: '',
    });
    expect(labels(items)).toEqual(['Copy Link Address']);
    expect(items[0]).toMatchObject({
      action: 'copyLink',
      url: 'https://example.com/',
    });
    expect(
      labels(shellMenuTemplate({ linkURL: 'javascript:alert(1)' })),
    ).toEqual([]);
  });
});
