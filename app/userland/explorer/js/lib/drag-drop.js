import { html } from 'lit';
import * as toast from '../com/toast.js';
import { joinPath, pluralize } from './strings.js';
import * as contextMenu from '../com/context-menu.js';
import { doCopy, doMove, doImport, canWriteTo } from './files.js';
import * as loc from './location.js';

export async function handleDragDrop(targetEl, x, y, targetPath, dataTransfer) {
  if (targetPath === loc.getPath()) {
    if (dataTransfer.files && dataTransfer.files.length) {
      // Files dragged in from the OS. Read the bytes in-renderer and write via nomad.fs — NOT the
      // native-path import, because Electron removed File.path (drops silently no-op'd). Writing
      // through nomad.fs also means a drop while the drive is in Draft Mode stages the file.
      let targetUrl = joinPath(loc.getOrigin(), targetPath);
      let n = 0;
      for (const file of Array.from(dataTransfer.files)) {
        try {
          const b64 = await fileToBase64(file);
          await nomad.fs.writeFile(joinPath(targetUrl, file.name), b64, { encoding: 'base64' });
          n++;
        } catch (e) {
          console.error('drop upload failed', file.name, e);
          toast.create(`Failed to add ${file.name}: ${e.toString()}`, 'error');
        }
      }
      if (n) toast.create(`Added ${n} ${pluralize(n, 'item')}`);
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

// Read a dropped File into a base64 string (works regardless of the removed File.path API).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(file);
  });
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
