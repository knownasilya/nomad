import { LitElement, html } from 'lit';

/*
Usage:

<nomad-hoverable>
  <button class="btn" slot="default">Hover me!</button>
  <button class="btn" slot="hover">I'm hovered!</button>
</nomad-hoverable>
*/

export class Hoverable extends LitElement {
  static get properties() {
    return {
      isHovered: { type: Boolean },
    };
  }

  constructor() {
    super();
    this.isHovered = false;
  }

  render() {
    if (this.isHovered) {
      return html`<span @mouseleave=${this.onMouseleave}><slot name="hover"></slot></span>`;
    }
    return html`<span @mouseenter=${this.onMouseenter}><slot name="default"></slot></span>`;
  }

  onMouseenter() {
    this.isHovered = true;
  }

  onMouseleave() {
    this.isHovered = false;
  }
}

customElements.define('nomad-hoverable', Hoverable);
