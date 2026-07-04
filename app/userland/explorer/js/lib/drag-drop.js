import { html } from 'lit';
import * as toast from '../com/toast.js';
import { joinPath, pluralize } from './strings.js';
import * as contextMenu from '../com/context-menu.js';
import { doCopy, doMove, doImport, canWriteTo } from './files.js';
import * as loc from './location.js';

export async function handleDragDrop(targetEl, x, y, targetPath, dataTransfer) {
  if (targetPath === loc.getPath()) {
    if (dataTransfer.files && dataTransfer.files.length) {
      // files dragged into the window
      let targetUrl = joinPath(loc.getOrigin(), targetPath);
      var paths = Array.from(dataTransfer.files, (f) =>
        window.electronWebUtils ? window.electronWebUtils.getPathForFile(f) : f.path
      ).filter(Boolean);
      var res = await nomad.shell.importFilesAndFolders(targetUrl, paths);
      toast.create(
        `Imported ${res.numImported} ${pluralize(res.numImported, 'item')}`
      );
      window.dispatchEvent(new CustomEvent('explorer-files-changed'));
      return;
    }
    // TODO:
    // currently we ignore drops that are onto the current location
    // eventually drops may come from other tabs and we need to handle those
    // -prf
    return;
  }

  if (targetEl) {
    targetEl.classList.add('drop-target');
  }

  var text = dataTransfer.getData('text/plain');
  if (text) {
    await handleDragDropUrls(x, y, targetPath, text.split('\n'));
  }
  // TODO: handle dropped files

  if (targetEl) {
    targetEl.classList.remove('drop-target');
  }
}

export async function handleDragDropUrls(x, y, targetPath, urls) {
  var targetUrl = joinPath(loc.getOrigin(), targetPath);
  var targetName = targetPath.split('/').pop();
  var items;
  if (await canWriteTo(targetUrl)) {
    items = [
      html`<div class="section-header small light">
        ${urls.length} ${pluralize(urls.length, 'item')}...
      </div>`,
      {
        icon: 'far fa-copy',
        label: `Copy to ${targetName}`,
        async click() {
          let n = 0;
          for (let url of urls) {
            try {
              await doCopy({ sourceItem: url, targetFolder: targetUrl });
              n++;
            } catch (e) {
              console.error(e);
              let niceError = e.toString().split(':').slice(1).join(':').trim();
              toast.create(
                `${niceError}. ${n} ${pluralize(n, 'item')} copied.`,
                'error'
              );
              return;
            }
            toast.create(`Copied ${n} ${pluralize(n, 'item')}`);
          }
        },
      },
      {
        icon: 'cut',
        label: `Move to ${targetName}`,
        async click() {
          let n = 0;
          for (let url of urls) {
            try {
              await doMove({ sourceItem: url, targetFolder: targetUrl });
              n++;
            } catch (e) {
              console.error(e);
              let niceError = e.toString().split(':').slice(1).join(':').trim();
              toast.create(
                `${niceError}. ${n} ${pluralize(n, 'item')} copied.`,
                'error'
              );
              return;
            }
            toast.create(`Move ${n} ${pluralize(n, 'item')}`);
          }
        },
      },
      '-',
      {
        icon: 'times-circle',
        label: `Cancel`,
        click: () => {},
      },
    ];
  } else {
    items = [
      html`<div class="section-header small light">
        <span class="fas fa-fw fa-exclamation-triangle"></span> Can't drop here
      </div>`,
      html`<div class="section-header" style="font-size: 14px">
        The target folder is read-only.
      </div>`,
      '-',
      {
        icon: 'times-circle',
        label: `Cancel`,
        click: () => {},
      },
    ];
  }
  await contextMenu.create({
    x,
    y,
    roomy: false,
    noBorders: true,
    fontAwesomeCSSUrl: 'nomad://explorer/css/font-awesome.css',
    style: `padding: 4px 0`,
    items,
  });
}
