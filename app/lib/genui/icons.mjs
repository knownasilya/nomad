// The icons a drawn component can name (an Icon, a Button's or a Tag's icon, an Avatar, …): Font
// Awesome 5 Free solid names, the set the rest of Nomad draws with. A name outside this list draws
// nothing, so a model can't reach a brand logo or an icon the font doesn't have.
// tests/unit/genui.test.js checks every name is in app/assets/css/fa-all.min.css.

export const ICON_GROUPS = {
  people: ['user', 'users', 'user-friends', 'user-plus', 'baby', 'child', 'id-card', 'address-book', 'handshake', 'hands-helping'],
  places: ['home', 'building', 'city', 'store', 'school', 'university', 'hospital', 'landmark', 'warehouse', 'map-marker-alt', 'map', 'compass', 'route', 'globe', 'mountain', 'water', 'tree'],
  time: ['clock', 'stopwatch', 'hourglass-half', 'calendar-alt', 'calendar-check', 'calendar-day', 'bell', 'history'],
  things: ['box', 'book', 'bookmark', 'folder', 'folder-open', 'file-alt', 'file-pdf', 'file-image', 'file-code', 'file-csv', 'clipboard-list', 'clipboard-check', 'sticky-note', 'archive', 'inbox', 'envelope', 'paper-plane', 'phone', 'comment', 'comments', 'newspaper', 'rss', 'tag', 'tags', 'key', 'lock', 'unlock', 'shield-alt', 'gift', 'trophy', 'medal', 'award', 'flag', 'thumbtack', 'lightbulb', 'rocket', 'puzzle-piece', 'dice', 'palette', 'camera', 'image', 'video', 'music', 'film', 'headphones', 'microphone', 'gamepad', 'tv'],
  money: ['dollar-sign', 'euro-sign', 'pound-sign', 'coins', 'wallet', 'credit-card', 'receipt', 'shopping-cart', 'shopping-bag', 'calculator', 'percent', 'balance-scale', 'briefcase'],
  data: ['chart-line', 'chart-bar', 'chart-pie', 'chart-area', 'table', 'list', 'tasks', 'database', 'server', 'hdd', 'code', 'code-branch', 'terminal', 'bug', 'cube', 'cubes', 'layer-group', 'network-wired', 'wifi', 'plug', 'robot', 'magic', 'cog', 'cogs', 'tools', 'wrench', 'hammer', 'laptop', 'desktop', 'mobile-alt', 'keyboard'],
  weather: ['sun', 'moon', 'cloud', 'cloud-rain', 'snowflake', 'wind', 'umbrella', 'thermometer-half', 'tint', 'bolt', 'fire', 'leaf', 'seedling'],
  life: ['heart', 'heartbeat', 'star', 'smile', 'thumbs-up', 'thumbs-down', 'utensils', 'coffee', 'mug-hot', 'apple-alt', 'carrot', 'pizza-slice', 'birthday-cake', 'wine-glass-alt', 'bed', 'couch', 'bath', 'paw', 'dog', 'cat', 'dumbbell', 'running', 'walking', 'hiking', 'bicycle', 'swimmer', 'pills', 'stethoscope', 'graduation-cap'],
  travel: ['plane', 'car', 'bus', 'train', 'ship', 'anchor'],
  signs: ['check', 'check-circle', 'times', 'exclamation-triangle', 'exclamation-circle', 'info-circle', 'question-circle', 'plus', 'minus', 'arrow-up', 'arrow-down', 'arrow-right', 'arrow-left', 'external-link-alt', 'link', 'search', 'filter', 'eye', 'download', 'upload', 'sync', 'share-alt', 'pen', 'edit', 'trash', 'save', 'print', 'bullseye', 'bullhorn', 'circle'],
};

export const ICONS = Object.values(ICON_GROUPS).flat();
const SET = new Set(ICONS);

// The name when it is one we draw, else ''.
export function iconName(name) {
  const n = typeof name === 'string' ? name.trim().toLowerCase().replace(/^fa-/, '') : '';
  return SET.has(n) ? n : '';
}
