import { html } from 'lit';

// A Space's mark wherever the Space switcher names a Space: a dot in its color, or, for a home
// (shared/home-setup.mjs HOME_ICON), a house in its color, so a home stands out from other Spaces.
// Personal (id 1) also carries the 'home' icon from the first schema, but it's not a home: a dot.
// The caller styles `.dot`; `.dot.home` is the house.
export function spaceDot(space, fallbackColor = '#6c6cff') {
  const color = space?.color || fallbackColor;
  if (isHome(space)) {
    return html`<svg class="dot home" viewBox="0 0 16 16" style="color:${color}" aria-hidden="true">
      <path fill="currentColor" d="M8 1 .5 7.4l1.1 1.2L2.8 7.6V15h4.1v-4.2h2.2V15h4.1V7.6l1.2 1 1.1-1.2z" />
    </svg>`;
  }
  return html`<span class="dot" style="background:${color}"></span>`;
}

export function isHome(space) {
  return !!space && space.icon === 'home' && Number(space.id) !== 1;
}
