// The sidebar's Map (ADR-0027): Leaflet with OpenStreetMap tiles, numbered pins when the markers
// are a route. Labels go in as text nodes, never as HTML. The wheel scrolls the chat, not the map;
// the +/- buttons, a double-click and dragging move it.

import { LitElement, html } from 'lit';
import leafletSource from 'leaflet/dist/leaflet.js?raw';

// Leaflet reads document.documentElement as it loads. This file is part of the shell window's
// preload, which runs before the page has an <html> element, so importing Leaflet as a module (it
// runs with the rest of the bundle) throws there and the whole window starts blank. The preload is
// sandboxed, so it can't require() Leaflet later either. The bundle carries Leaflet's source as
// text instead, and runs it the first time a map draws. tests/unit/genui.test.js guards this.
let L = null;
function leaflet() {
  if (!L) {
    const module = { exports: {} };
    new Function('exports', 'module', leafletSource)(module.exports, module);
    L = module.exports;
  }
  return L;
}

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const propsOf = (node) => (node && node.type === 'element' ? node.props : node) || {};

export function markersOf(props) {
  return (Array.isArray(props?.markers) ? props.markers : [])
    .map(propsOf)
    .map((m) => ({
      lat: Number(m.lat),
      lng: Number(m.lng),
      label: String(m.label ?? ''),
      details: m.details ? String(m.details) : '',
    }))
    .filter(
      (m) =>
        Number.isFinite(m.lat) &&
        Number.isFinite(m.lng) &&
        Math.abs(m.lat) <= 90 &&
        Math.abs(m.lng) <= 180
    );
}

function textNode(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = text;
  return el;
}

export class GenUiMap extends LitElement {
  static properties = {
    props: { attribute: false },
  };

  createRenderRoot() {
    return this;
  }

  render() {
    const markers = markersOf(this.props);
    if (!markers.length) return html`<div class="genui-empty">No places to show</div>`;
    return html`<div class="genui-map"></div>`;
  }

  updated() {
    const markers = markersOf(this.props);
    const el = this.querySelector('.genui-map');
    if (!el) {
      this._destroy();
      return;
    }
    // While an answer streams, props arrive again and again; redraw only when they change.
    const key = JSON.stringify([markers, !!this.props?.route, this.props?.zoom]);
    if (this._map && this._key === key) return;
    this._key = key;
    if (!this._map || this._el !== el) {
      this._destroy();
      this._el = el;
      const L = leaflet();
      this._map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(this._map);
      this._map.attributionControl.setPrefix(false);
      this._layer = L.layerGroup().addTo(this._map);
      this._ro = new ResizeObserver(() => this._map?.invalidateSize());
      this._ro.observe(el);
    }
    this._draw(markers);
  }

  _draw(markers) {
    const L = leaflet();
    const map = this._map;
    const route = !!this.props?.route && markers.length > 1;
    this._layer.clearLayers();
    const points = markers.map((m) => [m.lat, m.lng]);
    if (route) {
      L.polyline(points, { className: 'genui-route', weight: 3, interactive: false }).addTo(
        this._layer
      );
    }
    markers.forEach((m, i) => {
      const pin = document.createElement('div');
      pin.className = 'genui-pin';
      if (route) pin.textContent = String(i + 1);
      const marker = L.marker([m.lat, m.lng], {
        icon: L.divIcon({ html: pin, className: 'genui-pin-wrap', iconSize: [22, 22] }),
        title: m.label,
        keyboard: true,
      });
      const popup = document.createElement('div');
      popup.append(textNode('div', 'genui-popup-title', m.label));
      if (m.details) popup.append(textNode('div', 'genui-popup-details', m.details));
      marker.bindPopup(popup, { closeButton: false, offset: [0, -6] });
      marker.addTo(this._layer);
    });
    const zoom = Number(this.props?.zoom);
    if (markers.length === 1 || Number.isFinite(zoom)) {
      const center = markers.length === 1 ? points[0] : L.latLngBounds(points).getCenter();
      map.setView(center, Number.isFinite(zoom) ? Math.max(1, Math.min(18, zoom)) : 13);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 15 });
    }
  }

  _destroy() {
    this._ro?.disconnect();
    this._map?.remove();
    this._map = null;
    this._el = null;
    this._key = null;
  }

  connectedCallback() {
    super.connectedCallback();
    // Moved in the DOM: disconnectedCallback took the map down, so draw it again.
    if (this.hasUpdated) this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._destroy();
  }
}

customElements.define('nomad-genui-map', GenUiMap);
