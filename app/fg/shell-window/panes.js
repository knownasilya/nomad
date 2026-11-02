import { LitElement, html, css } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import * as bg from './bg-process-rpc';
import {
  currentTabDrag,
  endTabDrag,
  onTabDragChange,
  paneDropEdge,
  dropPreviewRect,
} from './split-drop';

const STATUS_BAR_HEIGHT = 22;

class ShellWindowPanes extends LitElement {
  static get properties() {
    return {
      activeTab: { type: Object },
      focusAttachId: { type: Number },
    };
  }

  static get styles() {
    return css`
      .pane-background {
        position: fixed;
        background: var(--bg-color--content);
        z-index: 1;
      }
      .pane-border {
        position: fixed;
        background: var(--bg-color--paneborder);
        z-index: 2;
      }
      .pane-border.active {
        z-index: 3;
        background: var(--bg-color--paneborder--active);
      }
      .pane-border.horz {
        height: 2px;
      }
      .pane-border.horz.movable {
        cursor: ns-resize;
      }
      .pane-border.vert {
        width: 2px;
      }
      .pane-border.vert.movable {
        cursor: ew-resize;
      }
      .pane-status-bar {
        position: fixed;
        font-family:
          -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Ubuntu, Cantarell,
          'Oxygen Sans', 'Helvetica Neue', sans-serif;
        background: var(--bg-color--pane-status-bar);
        color: var(--text-color--pane-status-bar);
        z-index: 2;
        display: flex;
        align-items: baseline;
        box-sizing: border-box;
        padding: 0 4px;
        font-size: 12px;
        letter-spacing: 0.5px;
        line-height: 23px;
      }
      .pane-status-bar.active {
        color: var(--text-color--pane-status-bar--active);
        background: var(--bg-color--pane-status-bar--active);
      }
      .pane-status-bar .status {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pane-status-bar .indicator {
        position: relative;
        top: -1px;
        font-size: 9px;
        margin: 0 2px;
        color: var(--text-color--pane-status-bar-indicator);
      }
      .pane-status-bar button {
        border: 0;
        font-size: 11px;
        line-height: 12px;
        background: transparent;
        color: inherit;
        padding: 2px 4px;
        border-radius: 2px;
      }
      .pane-status-bar button:hover {
        background: var(--bg-color--pane-status-bar-button--hover);
      }
      .pane-status-bar button.attachment span.icon {
        font-size: 14px;
      }
      .rotate90 {
        transform: rotate(-90deg);
      }
      /* split view by drag and drop: while a tab is dragged, the pages step aside for a picture of
         them, and the half a dropped tab will take is drawn over it */
      .drop-pane {
        position: fixed;
        z-index: 4;
        overflow: hidden;
      }
      .drop-pane img {
        display: block;
        width: 100%;
        height: calc(100% - ${STATUS_BAR_HEIGHT}px);
        object-fit: cover;
        object-position: top left;
        pointer-events: none;
      }
      .drop-target {
        position: fixed;
        z-index: 5;
        box-sizing: border-box;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-color--split-drop);
        border: 2px solid var(--border-color--split-drop);
        border-radius: 6px;
        transition:
          left 0.12s,
          top 0.12s,
          width 0.12s,
          height 0.12s;
      }
      .drop-target .drop-label {
        font-family:
          -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Ubuntu, Cantarell,
          'Oxygen Sans', 'Helvetica Neue', sans-serif;
        font-size: 13px;
        font-weight: 500;
        padding: 6px 12px;
        border-radius: 14px;
        color: #fff;
        background: var(--border-color--split-drop);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
    `;
  }

  constructor() {
    super();
    this.activeTab = undefined;
    this.isResizing = false;
    this.focusAttachId = undefined;
    // A tab dragged over the page (split-drop.js): { index, images: {[paneId]: dataUrl}, paneId,
    // edge } while the drop zones show.
    this.drop = null;
    document.body.addEventListener('mousemove', this.onMouseMove.bind(this));
    onTabDragChange(() => this.onTabDragChange());
  }

  // rendering
  // =

  render() {
    if (!this.activeTab) {
      return html``;
    }

    const hasMultiple = this.activeTab.paneLayout.length > 1;
    const attachTargets = {};
    for (let pane of this.activeTab.paneLayout) {
      if (pane.attachedPaneId) {
        attachTargets[pane.attachedPaneId] = true;
      }
    }

    const background = (pane) =>
      this.isResizing
        ? ''
        : html`
            <div
              class="pane-background"
              style="left: ${pane.bounds.x}px; top: ${pane.bounds.y}px; width: ${pane.bounds
                .width}px; height: ${pane.bounds.height}px"
            ></div>
          `;
    const horzLine = (pane, y, edge) => html`
      <div
        class="pane-border horz ${!pane.isEdge[edge] ? 'movable' : ''} ${edge === 'top' &&
        pane.isActive
          ? 'active'
          : ''}"
        style="left: ${pane.bounds.x - 2}px; top: ${y}px; width: ${pane.bounds.width + 4}px"
        @mousedown=${(e) => this.onMouseDown(e, pane, edge)}
        @mousemove=${this.onMouseMove}
        @mouseup=${this.onMouseUp}
      ></div>
    `;
    const vertLine = (pane, x, edge) => html`
      <div
        class="pane-border vert ${!pane.isEdge[edge] ? 'movable' : ''}"
        style="left: ${x}px; top: ${pane.bounds.y}px; height: ${pane.bounds.height + 2}px"
        @mousedown=${(e) => this.onMouseDown(e, pane, edge)}
        @mousemove=${this.onMouseMove}
        @mouseup=${this.onMouseUp}
      ></div>
    `;
    const statusBar = (pane) => html`
      <div
        class="pane-status-bar ${pane.isActive ? 'active' : ''}"
        style="left: ${pane.bounds.x}px; top: ${pane.bounds.y +
        pane.bounds.height -
        STATUS_BAR_HEIGHT}px; width: ${pane.bounds.width}px; height: ${STATUS_BAR_HEIGHT}px"
      >
        ${pane.isActive && hasMultiple ? html`<span class="fas fa-circle indicator"></span>` : ''}
        <button title="Pane menu" @click=${(e) => this.onClickPaneMenu(e, pane)}>
          <span class="fa fa-bars"></span>
        </button>
        <span class="status"> ${pane.status || pane.title} </span>
        ${hasMultiple
          ? html`
              <button
                class="attachment"
                title="Attach to another pane"
                @click=${(e) => this.onClickAttachMenu(e, pane)}
                @mouseover=${(e) => this.onMouseoverAttachMenu(e, pane)}
                @mouseleave=${(e) => this.onMouseleaveAttachMenu(e, pane)}
              >
                ${pane.attachedPaneId
                  ? html` Attached <span class="icon">⚯</span> `
                  : pane.wantsAttachedPane
                    ? html` <span class="icon">⚬</span> `
                    : ''}
              </button>
            `
          : ''}
        ${Number(pane.id) === Number(this.focusAttachId)
          ? html` <span class="icon rotate90">☞</span> `
          : ''}
      </div>
    `;

    if (!hasMultiple) {
      return html`
        <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
        ${repeat(
          this.activeTab.paneLayout,
          (pane) => pane.id,
          (pane) => html` ${background(pane)} ${statusBar(pane)} `
        )}
        ${this.renderDropZones()}
      `;
    }
    return html`
      <link rel="stylesheet" href="nomad://assets/font-awesome.css" />
      ${repeat(
        this.activeTab.paneLayout,
        (pane) => pane.id,
        (pane) => html`
          ${background(pane)} ${horzLine(pane, pane.bounds.y - 2, 'top')}
          ${!pane.isEdge.bottom ? horzLine(pane, pane.bounds.y + pane.bounds.height, 'bottom') : ''}
          ${!pane.isEdge.right ? vertLine(pane, pane.bounds.x + pane.bounds.width, 'right') : ''}
          ${statusBar(pane)}
        `
      )}
      ${this.renderDropZones()}
    `;
  }

  // While a tab is dragged: one drop zone per pane, showing the picture of its page, and the half
  // the tab would take.
  renderDropZones() {
    const drop = this.drop;
    if (!drop) return '';
    const panes = this.activeTab.paneLayout;
    const target = panes.find((p) => String(p.id) === String(drop.paneId));
    const rect = target && drop.edge ? dropPreviewRect(target.bounds, drop.edge) : null;
    const px = (b) => `left: ${b.x}px; top: ${b.y}px; width: ${b.width}px; height: ${b.height}px`;
    return html`
      ${repeat(
        panes,
        (pane) => `drop:${pane.id}`,
        (pane) => html`
          <div
            class="drop-pane"
            style=${px(pane.bounds)}
            @dragenter=${(e) => this.onDropDragover(e, pane)}
            @dragover=${(e) => this.onDropDragover(e, pane)}
            @dragleave=${(e) => this.onDropDragleave(e, pane)}
            @drop=${(e) => this.onDropOnPane(e, pane)}
          >
            ${drop.images[pane.id]
              ? html`<img class="drop-shot" src=${drop.images[pane.id]} alt="" />`
              : ''}
          </div>
        `
      )}
      ${rect
        ? html`
            <div class="drop-target" style=${px(insetRect(rect, 6))}>
              <span class="drop-label">${DROP_LABELS[drop.edge]}</span>
            </div>
          `
        : ''}
    `;
  }

  // events
  // =

  onMouseDown(e, pane, edge) {
    e.preventDefault();
    e.stopPropagation();
    this.isResizing = true;
    this.requestUpdate();
    bg.views.setPaneResizeModeEnabled(true, pane.id, edge);
  }

  onMouseMove(e) {
    if (this.isResizing && !e.buttons) {
      bg.views.setPaneResizeModeEnabled(false);
      this.isResizing = false;
      this.requestUpdate();
    }
  }

  onMouseUp(e) {
    if (this.isResizing) {
      bg.views.setPaneResizeModeEnabled(false);
      this.isResizing = false;
      this.requestUpdate();
    }
  }

  onClickPaneMenu(e, pane) {
    bg.views.openPaneMenu(pane.id);
  }

  onClickAttachMenu(e, pane) {
    bg.views.openAttachMenu(pane.id);
  }

  onMouseoverAttachMenu(e, pane) {
    this.focusAttachId = pane.attachedPaneId;
  }

  onMouseleaveAttachMenu(e, pane) {
    this.focusAttachId = undefined;
  }

  // split view by drag and drop
  // =

  // A tab other than this one started or stopped being dragged in the tab strip or the sidebar.
  async onTabDragChange() {
    const drag = currentTabDrag();
    const tab = this.activeTab;
    const canDrop = Boolean(
      drag && tab && !drag.tab?.isActive && !drag.tab?.isPinned && !tab.isPinned
    );
    if (canDrop && !this.drop) {
      const drop = (this.drop = { index: drag.index, images: {}, paneId: null, edge: null });
      // Take a picture of each page, draw it, and only then let the pages step aside, so the
      // window doesn't flash while the drag is still over the tabs.
      const shots = await bg.views.capturePanesForDrop().catch(() => []);
      if (this.drop !== drop) return;
      for (const shot of shots || []) if (shot.image) drop.images[shot.id] = shot.image;
      this.requestUpdate();
      await this.updateComplete;
      await Promise.all(
        Array.from(this.shadowRoot.querySelectorAll('img.drop-shot'), (img) =>
          img.decode ? img.decode().catch(() => {}) : null
        )
      );
      if (this.drop !== drop) return;
      bg.views.setDropPreview(true);
    } else if (!drag && this.drop) {
      this.drop = null;
      this.requestUpdate();
      bg.views.setDropPreview(false);
    }
  }

  onDropDragover(e, pane) {
    if (!this.drop) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const edge = paneDropEdge(pane.bounds, e.clientX, e.clientY);
    if (this.drop.paneId !== pane.id || this.drop.edge !== edge) {
      this.drop.paneId = pane.id;
      this.drop.edge = edge;
      this.requestUpdate();
    }
  }

  onDropDragleave(e, pane) {
    if (!this.drop || this.drop.paneId !== pane.id) return;
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    this.drop.paneId = null;
    this.drop.edge = null;
    this.requestUpdate();
  }

  onDropOnPane(e, pane) {
    const drop = this.drop;
    if (!drop) return;
    e.preventDefault();
    e.stopPropagation();
    const edge = paneDropEdge(pane.bounds, e.clientX, e.clientY);
    bg.views.moveTabIntoSplit(drop.index, 'active', { paneId: pane.id, edge });
    endTabDrag();
  }
}

const DROP_LABELS = {
  left: 'Open on the left',
  right: 'Open on the right',
  top: 'Open above',
  bottom: 'Open below',
};

function insetRect(r, n) {
  return { x: r.x + n, y: r.y + n, width: r.width - n * 2, height: r.height - n * 2 };
}

customElements.define('shell-window-panes', ShellWindowPanes);
