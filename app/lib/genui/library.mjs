// The components the AI Sidebar's assistant can draw with (ADR-0027). They are written in OpenUI
// Lang (https://openui.com, @openuidev/lang-core): the model puts a program in an `openui-lang`
// fence inside its Markdown answer, and the sidebar renders it (app/fg/shell-window/genui/).
//
// Names and argument order follow OpenUI's own chat library (@openuidev/react-ui genui-lib) where
// it has the component, so its docs and examples carry over. Stat, Progress, Map and MapMarker are
// ours. There is no Image: an image the model names would load from any host the moment the
// answer renders, which lets a page the model read send data out in the URL. Map tiles come only
// from OpenStreetMap.
//
// The second set (ADR-0048) takes its shape from Nuxt UI's components: a `color`, a `variant` and a
// `size` where they make sense, an `icon`, and slots. A slot is an argument that takes a component
// (a ListItem's `leading` and `trailing`, a Card's `footer`, a Callout's `actions`), since
// openui-lang has no other way to nest. Arguments are positional, so a component that was here
// before only ever gains arguments at its end: a saved chat's programs are parsed again every
// time the chat opens.
//
// Three sets come out of this file:
// - the core ones, taught on every sidebar turn (`genuiPrompt()`), with the names of the rest;
// - all of them, taught by guide:genui-components and guide:genui-pages (`genuiFullPrompt()`);
// - the home page's live widgets (Home…), which only nomad://desktop draws, taught by
//   guide:dashboard (`genuiDashboardPrompt()`).
//
// The parser in the shell window takes this library's JSON Schema (schema.json, kept in step by
// tests/unit/genui.test.js and `node scripts/gen-genui-schema.mjs`), so the window bundles neither
// zod nor this file.

import { action, createLibrary, defineComponent } from '@openuidev/lang-core';
import { z } from 'zod';
import { ICON_GROUPS } from './icons.mjs';

export const GENUI_FENCE = 'openui-lang';

const def = (name, description, props) =>
  defineComponent({ name, description, props: z.object(props), component: null });

const gap = z.enum(['none', 'xs', 's', 'm', 'l', 'xl']).optional();
// What the second set shares (ADR-0048).
export const COLORS = ['neutral', 'primary', 'info', 'success', 'warning', 'error'];
export const STYLES = ['soft', 'outline', 'solid'];
export const SIZES = ['s', 'm', 'l'];
const color = z.enum(COLORS).optional();
const style = z.enum(STYLES).optional();
const size = z.enum(SIZES).optional();
// An icon is a name from icons.mjs; one that isn't there draws nothing.
const icon = z.string().optional();
// A slot: one component, or several.
const slot = z.any().optional();
const slots = z.array(z.any()).optional();

// — Layout —

const Stack = def('Stack', 'Lays out children in a column (default) or a row', {
  children: z.array(z.any()),
  direction: z.enum(['row', 'column']).optional(),
  gap,
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  wrap: z.boolean().optional(),
  justify: z.enum(['start', 'center', 'end', 'between']).optional(),
});
const Grid = def(
  'Grid',
  'Children in equal columns (2 by default, up to 4), fewer when there is no room',
  { children: z.array(z.any()), columns: z.number().optional(), gap }
);
const GridItem = def('GridItem', 'A Grid child that is span columns wide', {
  children: z.array(z.any()),
  span: z.number().optional(),
});
const Columns = def(
  'Columns',
  'Children of different heights packed into columns top to bottom (3 by default), like a board of cards',
  { children: z.array(z.any()), count: z.number().optional(), gap }
);
const CardHeader = def(
  'CardHeader',
  'Title and optional subtitle at the top of a Card. trailing is a slot at its right: a Tag, a Button, an Avatar',
  { title: z.string().optional(), subtitle: z.string().optional(), icon, trailing: slot }
);
const Card = def(
  'Card',
  'A bordered box that groups related content. footer is a slot under a rule; color tints a "soft" card and marks the others with a stripe',
  {
    children: z.array(z.any()),
    variant: z.enum(['card', 'sunk', 'clear', 'soft']).optional(),
    footer: slots,
    color,
  }
);
const TabItem = def('TabItem', 'value is a unique id, trigger is the tab label', {
  value: z.string(),
  trigger: z.string(),
  content: z.array(z.any()),
  icon,
});
const Tabs = def('Tabs', 'Alternative views of the same subject, one visible at a time', {
  items: z.array(TabItem.ref),
  variant: z.enum(['underline', 'pill']).optional(),
});
const AccordionItem = def('AccordionItem', 'One section of an Accordion; open: true starts it open', {
  label: z.string(),
  content: z.array(z.any()),
  icon,
  open: z.boolean().optional(),
});
const Accordion = def(
  'Accordion',
  'Sections that open on a click, one at a time unless multiple is true: FAQs, details on demand',
  { items: z.array(AccordionItem.ref), multiple: z.boolean().optional() }
);
const Collapsible = def('Collapsible', 'Content behind a "show more" line', {
  label: z.string(),
  children: z.array(z.any()),
  open: z.boolean().optional(),
});
const Carousel = def('Carousel', 'One item at a time with previous and next: a few cards to flip through', {
  items: z.array(z.any()),
});
const Separator = def('Separator', 'A horizontal rule between sections, with an optional label in it', {
  label: z.string().optional(),
});
const Header = def(
  'Header',
  'The heading of a page or a section: a small eyebrow line, the title, a description. actions is a slot of Buttons at its right',
  {
    title: z.string(),
    description: z.string().optional(),
    eyebrow: z.string().optional(),
    icon,
    actions: slots,
  }
);

// — Content —

const TextContent = def('TextContent', 'A paragraph or a heading of plain text', {
  text: z.string(),
  size: z.enum(['small', 'default', 'large', 'small-heavy', 'large-heavy']).optional(),
  color: z.enum(['default', 'muted', 'primary', 'success', 'warning', 'error']).optional(),
});
const Tag = def('Tag', 'A small colored badge', {
  text: z.string(),
  variant: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).optional(),
  icon,
  style,
});
const TagBlock = def('TagBlock', 'A row of neutral tags', { tags: z.array(z.string()) });
const Icon = def('Icon', 'One icon, for a slot or a row', { name: z.string(), color, size });
const Avatar = def(
  'Avatar',
  'A round badge with the initials of name, or an icon. status adds a dot',
  {
    name: z.string(),
    icon,
    color,
    size,
    status: z.enum(['online', 'away', 'busy', 'offline']).optional(),
  }
);
const AvatarGroup = def('AvatarGroup', 'Overlapping Avatars; past max they show as "+N"', {
  avatars: z.array(Avatar.ref),
  max: z.number().optional(),
});
const User = def('User', 'A person in one line: an avatar, the name, a description. trailing is a slot at the right', {
  name: z.string(),
  description: z.string().optional(),
  avatar: slot,
  trailing: slot,
  url: z.string().optional(),
});
const Kbd = def('Kbd', 'Keys of a keyboard shortcut', { keys: z.array(z.string()) });
const Link = def('Link', 'A text link that opens url on a click', {
  label: z.string(),
  url: z.string(),
  icon,
});
const Breadcrumb = def('Breadcrumb', 'A path of places, the last one the current', {
  items: z.array(z.string()),
});
const CodeBlock = def('CodeBlock', 'Code or a command in monospace, with a Copy button', {
  code: z.string(),
  language: z.string().optional(),
  title: z.string().optional(),
});
const Button = def('Button', 'A button. Without an action it sends its label to you', {
  label: z.string(),
  action: action().optional(),
  variant: z.enum(['primary', 'secondary', 'tertiary']).optional(),
  icon,
  size,
});
const Buttons = def('Buttons', 'A group of Buttons', {
  buttons: z.array(Button.ref),
  direction: z.enum(['row', 'column']).optional(),
});
const Callout = def(
  'Callout',
  'A colored notice with a title and a description. actions is a slot of Buttons under it',
  {
    variant: z.enum(['info', 'warning', 'error', 'success', 'neutral']),
    title: z.string(),
    description: z.string(),
    icon,
    actions: z.array(Button.ref).optional(),
    style,
  }
);
const Empty = def('Empty', 'What to show when there is nothing: an icon, a title, a line, and what to do next', {
  title: z.string(),
  description: z.string().optional(),
  icon,
  actions: z.array(Button.ref).optional(),
});
const Feature = def('Feature', 'An icon with a title and a line under it: a point, a benefit, a shortcut. url makes it a link', {
  title: z.string(),
  description: z.string().optional(),
  icon,
  url: z.string().optional(),
  color,
});

// — Lists —

const ListItem = def(
  'ListItem',
  'One row of a List. leading is a slot at its left (an Icon, an Avatar), trailing one at its right (a Tag, a Button, a Sparkline, text). url makes the row a link',
  {
    title: z.string(),
    description: z.string().optional(),
    leading: slot,
    trailing: slot,
    url: z.string().optional(),
  }
);
const List = def('List', 'Rows of things: tasks, files, people, results', {
  items: z.array(ListItem.ref),
  variant: z.enum(['plain', 'divided', 'cards']).optional(),
});
const Field = def('Field', 'One label and value, on an EntityCard or in a DataList', {
  label: z.string(),
  value: z.string(),
});
const DataList = def('DataList', 'Labels and values: the facts of one thing', {
  items: z.array(Field.ref),
  layout: z.enum(['rows', 'columns']).optional(),
});
const StepsItem = def('StepsItem', 'One numbered step', {
  title: z.string(),
  details: z.string(),
  icon,
});
const Steps = def(
  'Steps',
  'A numbered step-by-step guide. With current (from 1), earlier steps show done and later ones to do',
  { items: z.array(StepsItem.ref), current: z.number().optional() }
);
const TreeItem = def('TreeItem', 'One node of a Tree; children are TreeItems', {
  label: z.string(),
  children: slots,
  icon,
  open: z.boolean().optional(),
});
const Tree = def('Tree', 'Nested things that open on a click: folders, an outline, an org chart', {
  items: z.array(TreeItem.ref),
});

// — Numbers —

const Stat = def(
  'Stat',
  'A headline number (KPI). change is a short delta like "+12%"; trend colors it. spark draws a small line of the numbers behind it',
  {
    label: z.string(),
    value: z.string(),
    change: z.string().optional(),
    trend: z.enum(['up', 'down', 'flat']).optional(),
    caption: z.string().optional(),
    icon,
    color,
    spark: z.array(z.number()).optional(),
  }
);
const Progress = def('Progress', 'A labelled bar, or a ring, showing value out of max (default 100)', {
  label: z.string(),
  value: z.number(),
  max: z.number().optional(),
  color,
  variant: z.enum(['bar', 'ring']).optional(),
  caption: z.string().optional(),
});
const Sparkline = def('Sparkline', 'A tiny chart with no axes, for a slot or beside a number', {
  values: z.array(z.number()),
  color,
  variant: z.enum(['line', 'area', 'bar']).optional(),
});
const CalendarMark = def('CalendarMark', 'A day to mark on a Calendar, YYYY-MM-DD', {
  date: z.string(),
  label: z.string().optional(),
  color,
});
const Calendar = def(
  'Calendar',
  'One month as a grid of days, with marked days. month is YYYY-MM (this month when left out)',
  { month: z.string().optional(), marks: z.array(CalendarMark.ref).optional() }
);

// — Tables —

const Col = def('Col', 'One table column: a header and one value per row', {
  label: z.string(),
  data: z.array(z.any()),
  type: z.enum(['string', 'number']).optional(),
});
const Table = def(
  'Table',
  'A table, column by column. Every Col has one value per row. pageSize pages a long one; a click on a header sorts',
  {
    columns: z.array(Col.ref),
    pageSize: z.number().optional(),
    variant: z.enum(['plain', 'striped']).optional(),
    caption: z.string().optional(),
  }
);

// — Charts —

const Series = def('Series', 'One named series of numbers, one per label', {
  category: z.string(),
  values: z.array(z.number()),
});
const xyChart = (variants) => ({
  labels: z.array(z.string()),
  series: z.array(Series.ref),
  variant: z.enum(variants).optional(),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});
const BarChart = def(
  'BarChart',
  'Vertical bars: compare values across a few categories, one or more series',
  xyChart(['grouped', 'stacked'])
);
const HorizontalBarChart = def(
  'HorizontalBarChart',
  'Horizontal bars: rankings, or categories with long names',
  xyChart(['grouped', 'stacked'])
);
const LineChart = def(
  'LineChart',
  'Lines over ordered labels (time): trends, one or more series',
  xyChart(['linear', 'step'])
);
const AreaChart = def(
  'AreaChart',
  'Filled lines over time; "stacked" shows parts of a total',
  xyChart(['overlap', 'stacked'])
);
const PieChart = def('PieChart', 'Shares of one whole, at most 6 slices', {
  labels: z.array(z.string()),
  values: z.array(z.number()),
  variant: z.enum(['pie', 'donut']).optional(),
});
const Point = def('Point', 'One x/y point; label names it in the tooltip', {
  x: z.number(),
  y: z.number(),
  label: z.string().optional(),
});
const ScatterSeries = def('ScatterSeries', 'A named set of points', {
  name: z.string(),
  points: z.array(Point.ref),
});
const ScatterChart = def('ScatterChart', 'X/Y points: correlation and clusters', {
  datasets: z.array(ScatterSeries.ref),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});

// — Maps —

const MapMarker = def('MapMarker', 'A place on a Map, in decimal degrees', {
  lat: z.number(),
  lng: z.number(),
  label: z.string(),
  details: z.string().optional(),
});
const MapView = def(
  'Map',
  'An OpenStreetMap map that fits its markers. route: true joins them in order (an itinerary)',
  {
    markers: z.array(MapMarker.ref),
    route: z.boolean().optional(),
    zoom: z.number().optional(),
  }
);

// — Cards for a purpose —
// Each is one call, so a list of search results or products streams in card by card. A card with
// a url opens it in a new tab on a click; none of them shows an image.

// The icons the every-turn prompt names, for any `icon` argument (a CardHeader's, a Stat's, a
// Button's, an EntityCard's). Any name in icons.mjs draws; the whole list is in the guide.
export const CARD_ICONS = [
  'user',
  'users',
  'home',
  'building',
  'map-marker-alt',
  'globe',
  'calendar-alt',
  'clock',
  'bell',
  'box',
  'book',
  'bookmark',
  'file-alt',
  'folder',
  'envelope',
  'tag',
  'star',
  'heart',
  'lightbulb',
  'rocket',
  'code',
  'chart-line',
  'chart-bar',
  'dollar-sign',
  'wallet',
  'shopping-cart',
  'music',
  'film',
  'utensils',
  'plane',
  'car',
  'sun',
  'leaf',
  'seedling',
  'check',
  'exclamation-triangle',
  'info-circle',
  'plus',
  'sync',
  'search',
];

const EntityCard = def(
  'EntityCard',
  'A person, place, project, package or other thing: its name, facts and tags',
  {
    title: z.string(),
    subtitle: z.string().optional(),
    fields: z.array(Field.ref).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    icon,
    url: z.string().optional(),
  }
);
const LinkCard = def(
  'LinkCard',
  'A page to open: a search result, a source, a file in a drive (hyper://). The whole card is the link',
  {
    title: z.string(),
    url: z.string(),
    description: z.string().optional(),
    source: z.string().optional(),
  }
);
const ProductCard = def(
  'ProductCard',
  'Something to buy or choose: price, a 0-5 rating, tags, a badge like "Best value"',
  {
    title: z.string(),
    price: z.string().optional(),
    description: z.string().optional(),
    rating: z.number().optional(),
    tags: z.array(z.string()).optional(),
    badge: z.string().optional(),
    action: action().optional(),
  }
);
const EventCard = def(
  'EventCard',
  'Something that happens on a date. date is YYYY-MM-DD when you know it',
  {
    title: z.string(),
    date: z.string(),
    time: z.string().optional(),
    location: z.string().optional(),
    details: z.string().optional(),
    url: z.string().optional(),
  }
);
const QuoteCard = def('QuoteCard', 'A quotation, with who said it or where it is from', {
  text: z.string(),
  source: z.string().optional(),
  url: z.string().optional(),
});
const ProsCons = def('ProsCons', 'Two lists side by side, for and against', {
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  title: z.string().optional(),
});
const TimelineItem = def('TimelineItem', 'One dated entry on a Timeline', {
  date: z.string(),
  title: z.string(),
  details: z.string().optional(),
  variant: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).optional(),
  icon,
});
const Timeline = def('Timeline', 'Dated events in order: history, a changelog, a schedule', {
  items: z.array(TimelineItem.ref),
});
const CardGrid = def('CardGrid', 'Cards in as many columns as fit (one in a narrow sidebar)', {
  cards: z.array(z.any()),
});

// — Forms —
// A Form's values go nowhere but the conversation: Submit sends them as the user's next message,
// which they see. There is no password field, and nothing is sent before the click.

const Input = def('Input', 'A one-line field of a Form', {
  name: z.string(),
  label: z.string(),
  placeholder: z.string().optional(),
  type: z.enum(['text', 'number', 'date', 'time', 'email', 'url']).optional(),
  value: z.string().optional(),
  hint: z.string().optional(),
});
const Textarea = def('Textarea', 'A field for several lines', {
  name: z.string(),
  label: z.string(),
  placeholder: z.string().optional(),
  value: z.string().optional(),
});
const Select = def('Select', 'Pick one from a menu', {
  name: z.string(),
  label: z.string(),
  options: z.array(z.string()),
  value: z.string().optional(),
});
const RadioGroup = def('RadioGroup', 'Pick one of a few, all visible', {
  name: z.string(),
  label: z.string(),
  options: z.array(z.string()),
  value: z.string().optional(),
});
const CheckboxGroup = def('CheckboxGroup', 'Pick any of a few', {
  name: z.string(),
  label: z.string(),
  options: z.array(z.string()),
  values: z.array(z.string()).optional(),
});
const Switch = def('Switch', 'One yes or no', {
  name: z.string(),
  label: z.string(),
  value: z.boolean().optional(),
  hint: z.string().optional(),
});
const Slider = def('Slider', 'A number between min and max', {
  name: z.string(),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  value: z.number().optional(),
  step: z.number().optional(),
});
const Form = def(
  'Form',
  'Fields the user fills in, and a button that sends you what they entered as their next message',
  {
    fields: z.array(z.any()),
    submit: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
  }
);

// — The home page's widgets (ADR-0048) —
// Live parts of nomad://desktop. They take no data: the page fills them with the user's own things,
// so a layout can place them and never see what is in them. Anywhere else they draw a placeholder.

const limit = { limit: z.number().optional() };
const HomeGreeting = def('HomeGreeting', 'The greeting, the date and the Space', {});
const HomePins = def('HomePins', "The Space's pinned pages as thumbnails, and the button that adds one", {});
const HomeNeedsYou = def(
  'HomeNeedsYou',
  "What waits on the user's answer, with its buttons. Shows only when something does; the page adds it at the top when a layout leaves it out",
  {}
);
const HomeNotifications = def('HomeNotifications', 'Job results, notices and unread Messages', limit);
const HomeJobs = def('HomeJobs', 'The Jobs running now and the ones up next', limit);
const HomeEvents = def('HomeEvents', 'The calendar from now on', limit);
const HomeNotes = def('HomeNotes', 'The newest Notes', limit);
const HomeFiles = def('HomeFiles', 'The newest files in Assets', limit);
const HomeCards = def(
  'HomeCards',
  'Every card pinned to the home page, each as its own child of the Grid, Columns or Stack this is in',
  {}
);

export const HOME_WIDGETS = [
  'HomeGreeting',
  'HomePins',
  'HomeNeedsYou',
  'HomeNotifications',
  'HomeJobs',
  'HomeEvents',
  'HomeNotes',
  'HomeFiles',
  'HomeCards',
];

const ICON_NOTE = `- An icon is one of these names; any other draws nothing: ${Object.values(ICON_GROUPS)
  .map((names) => names.join(', '))
  .join(', ')}.`;

// Every group, in the order the full prompt teaches them. `core` are the components every sidebar
// turn is taught; the rest are named there and taught by guide:genui-components.
const GROUPS = [
  {
    name: 'Layout',
    core: ['Stack', 'Card', 'CardHeader', 'Tabs', 'TabItem', 'Separator'],
    more: ['Grid', 'GridItem', 'Columns', 'Accordion', 'AccordionItem', 'Collapsible', 'Carousel', 'Header'],
    notes: [
      '- The sidebar is narrow (about 300-600px). Stack in a column; put at most 2-3 short items (Stats, Tags, Buttons) in a row.',
      '- Wrap each chart, map or table in a Card with a CardHeader that names it.',
    ],
    moreNotes: [
      '- A slot is an argument that takes a component: Card([body], "card", [Buttons([Button("Open")])]) has a footer; CardHeader("Sales", "This week", "chart-line", Tag("Live", "success")) has a Tag at its right.',
      '- Grid([a, b, c], 3) for equal columns, GridItem([chart], 2) for a child two columns wide; Columns([a, b, c, d]) packs cards of different heights. Both drop to fewer columns in the narrow sidebar.',
    ],
  },
  {
    name: 'Content',
    core: ['TextContent', 'Callout', 'Tag', 'TagBlock'],
    more: ['Icon', 'Avatar', 'AvatarGroup', 'User', 'Kbd', 'Link', 'Breadcrumb', 'CodeBlock', 'Empty', 'Feature'],
    notes: [],
    moreNotes: [
      ICON_NOTE,
      '- color is the hue and style how strong it is: Tag("Paid", "success", "check", "solid"), Callout("warning", "Low stock", "3 left", "box", [Button("Reorder")], "outline").',
    ],
  },
  {
    name: 'Lists',
    core: ['Steps', 'StepsItem'],
    more: ['List', 'ListItem', 'DataList', 'Tree', 'TreeItem'],
    notes: [],
    moreNotes: [
      '- List([ListItem("Buy milk", "Today", Icon("shopping-cart"), Tag("2", "info")), ListItem("Call Ana", null, Avatar("Ana Diaz"), Button("Call", @OpenUrl("tel:…")))], "divided")',
      '- Tree([TreeItem("src", [TreeItem("index.js"), TreeItem("lib", [TreeItem("a.js")])], "folder", true)])',
    ],
  },
  {
    name: 'Numbers',
    core: ['Stat', 'Progress'],
    more: ['Sparkline', 'Calendar', 'CalendarMark'],
    notes: ['- Stats in a row: Stack([s1, s2, s3], "row", "s", "stretch", true)'],
    moreNotes: [
      '- Stat("Revenue", "$12.4k", "+8%", "up", "vs last week", "dollar-sign", "success", [9, 10, 9.5, 11, 12.4])',
      '- Calendar("2026-11", [CalendarMark("2026-11-14", "Dentist", "warning"), CalendarMark("2026-11-20", "Trip")])',
    ],
  },
  {
    name: 'Tables',
    core: ['Table', 'Col'],
    more: [],
    notes: [
      '- Table is COLUMN-oriented: Table([Col("Name", names), Col("Stars", stars, "number")]).',
      '- A cell can be a Tag: Col("Status", [Tag("open", "success"), Tag("closed", "neutral")]).',
    ],
    moreNotes: [
      '- A cell can also be an Icon, an Avatar, a User, a Link, a Progress, a Sparkline or a Button.',
    ],
  },
  {
    name: 'Charts',
    core: [
      'BarChart',
      'HorizontalBarChart',
      'LineChart',
      'AreaChart',
      'Series',
      'PieChart',
      'ScatterChart',
      'ScatterSeries',
      'Point',
    ],
    more: [],
    notes: [
      '- Every Series has one number per label: LineChart(["Mon", "Tue"], [Series("Visits", [120, 98])]).',
      '- At most 4 series per chart. Numbers only: no units or commas inside values; put units in yLabel.',
    ],
  },
  {
    name: 'Maps',
    core: ['Map', 'MapMarker'],
    more: [],
    notes: [
      '- Map([MapMarker(48.8584, 2.2945, "Eiffel Tower"), MapMarker(48.8606, 2.3376, "Louvre")], true)',
      '- Use coordinates you are sure of; leave zoom out and the map fits its markers.',
    ],
  },
  {
    name: 'Cards',
    core: [
      'EntityCard',
      'Field',
      'LinkCard',
      'ProductCard',
      'EventCard',
      'QuoteCard',
      'ProsCons',
      'Timeline',
      'TimelineItem',
      'CardGrid',
    ],
    more: [],
    notes: [
      '- Several results of one kind: CardGrid([LinkCard(...), LinkCard(...)]). Give every card in a grid the same fields.',
      '- EntityCard("Hypercore", "Append-only log", [Field("License", "MIT"), Field("Language", "JavaScript")], null, ["p2p"], "code")',
      `- An icon argument takes a name from a fixed list; any other name draws nothing. Common ones: ${CARD_ICONS.join(', ')}. The whole list is in guide:genui-components.`,
      '- ProductCard("Widget Pro", "$29", "Fast and quiet", 4.5, ["USB-C"], "Best value", @ToAssistant("Tell me about Widget Pro"))',
      '- Only give a url you got from the page, a tool or the user.',
    ],
  },
  {
    name: 'Forms',
    core: [],
    more: ['Form', 'Input', 'Textarea', 'Select', 'RadioGroup', 'CheckboxGroup', 'Switch', 'Slider'],
    notes: [],
    moreNotes: [
      '- Use a Form when you need several answers at once: Form([Input("city", "City"), Select("when", "When", ["This week", "Next month"]), Slider("budget", "Budget ($)", 100, 2000, 500, 50)], "Plan it", "Trip")',
      '- Submit sends "Trip" and each label with its value as the user\'s next message. Never ask for a password, a card number or another secret in one.',
    ],
  },
  {
    name: 'Buttons',
    core: ['Button', 'Buttons'],
    more: [],
    notes: [
      '- Offer next steps as Buttons: Button("Compare prices", @ToAssistant("Compare their prices")).',
      '- Link out with @OpenUrl("https://…"); it opens in a new tab when the user clicks. A Note, Job or Mod a tool gave a nomad:// url for opens the same way.',
    ],
  },
];

const HOME_GROUP = {
  name: 'Home page widgets',
  components: HOME_WIDGETS,
  notes: [
    '- Only a home page layout uses these (setDashboard). Each fills itself with the user\'s own things; you place it, you never pass it data.',
    '- limit is how many rows a widget shows, from 1 to 20: HomeNotes(10).',
  ],
};

const COMPONENTS = [
  Stack,
  Grid,
  GridItem,
  Columns,
  Card,
  CardHeader,
  Tabs,
  TabItem,
  Accordion,
  AccordionItem,
  Collapsible,
  Carousel,
  Separator,
  Header,
  TextContent,
  Callout,
  Tag,
  TagBlock,
  Icon,
  Avatar,
  AvatarGroup,
  User,
  Kbd,
  Link,
  Breadcrumb,
  CodeBlock,
  Empty,
  Feature,
  Steps,
  StepsItem,
  List,
  ListItem,
  DataList,
  Tree,
  TreeItem,
  Stat,
  Progress,
  Sparkline,
  Calendar,
  CalendarMark,
  Table,
  Col,
  BarChart,
  HorizontalBarChart,
  LineChart,
  AreaChart,
  Series,
  PieChart,
  ScatterChart,
  ScatterSeries,
  Point,
  MapView,
  MapMarker,
  EntityCard,
  Field,
  LinkCard,
  ProductCard,
  EventCard,
  QuoteCard,
  ProsCons,
  Timeline,
  TimelineItem,
  CardGrid,
  Form,
  Input,
  Textarea,
  Select,
  RadioGroup,
  CheckboxGroup,
  Switch,
  Slider,
  Button,
  Buttons,
];
const WIDGETS = [
  HomeGreeting,
  HomePins,
  HomeNeedsYou,
  HomeNotifications,
  HomeJobs,
  HomeEvents,
  HomeNotes,
  HomeFiles,
  HomeCards,
];
const byName = new Map([...COMPONENTS, ...WIDGETS].map((c) => [c.name, c]));
const named = (names) => names.map((n) => byName.get(n));

export const CORE_COMPONENTS = GROUPS.flatMap((g) => g.core);
export const MORE_COMPONENTS = GROUPS.flatMap((g) => g.more);

const groupsOf = (pick, notes) =>
  GROUPS.map((g) => ({ name: g.name, components: pick(g), notes: notes(g) })).filter(
    (g) => g.components.length
  );

// What the shell window parses against (schema.json): every component, the widgets too.
export const genuiLibrary = createLibrary({
  root: 'Stack',
  components: [...COMPONENTS, ...WIDGETS],
  componentGroups: [
    ...groupsOf(
      (g) => [...g.core, ...g.more],
      (g) => [...g.notes, ...(g.moreNotes || [])]
    ),
    HOME_GROUP,
  ],
});

const coreLibrary = createLibrary({
  root: 'Stack',
  components: named(CORE_COMPONENTS),
  componentGroups: groupsOf(
    (g) => g.core,
    (g) => g.notes
  ),
});

const fullLibrary = createLibrary({
  root: 'Stack',
  components: COMPONENTS,
  componentGroups: groupsOf(
    (g) => [...g.core, ...g.more],
    (g) => [...g.notes, ...(g.moreNotes || [])]
  ),
});

// Only the second set, for guide:genui-components: a turn that opens it has the rest already.
const moreLibrary = createLibrary({
  root: 'Stack',
  components: COMPONENTS,
  componentGroups: groupsOf(
    (g) => g.more,
    (g) => g.moreNotes || []
  ),
});

const PREAMBLE = `## Drawing UI in your answer

Your answers are Markdown. When a picture says it better — numbers to compare, a trend, places, a step-by-step plan, choices for the user — you can also draw UI in the answer with openui-lang, a small declarative UI language. Put each program in a fenced code block tagged \`${GENUI_FENCE}\`; text outside the fence is shown as Markdown:

\`\`\`${GENUI_FENCE}
root = Stack([card])
card = Card([CardHeader("Visits this week"), chart])
chart = LineChart(["Mon", "Tue", "Wed"], [Series("Visits", [120, 98, 143])])
\`\`\`

Use UI only when it helps; most answers are plain Markdown. For a list of things (results, places, products, people, events), a card per thing reads better than a table. Show real data: the user's files, the page, what a tool returned, or facts you know well. Never make up numbers. You can't style it or add images. The rest of this section is the language.`;

const RULES = [
  'Write a sentence or two of Markdown before the fence, and keep commentary outside it.',
  'One fence per answer is usually enough. Each fence is its own program with its own root.',
  'Answer questions about a UI you drew in plain text; draw again only to change it.',
  `There are more components: ${MORE_COMPONENTS.filter((n) => !/Item$|Mark$/.test(n)).join(', ')}. Their arguments are in guide:genui-components; open it with search before you use one, and never guess an argument order.`,
  'The user can pin a drawing to their home page with the button under it. To pin one yourself or change the home page, see guide:dashboard.',
];

const OPTIONS = { toolCalls: false, bindings: false };
const cache = {};
const once = (key, make) => (cache[key] ??= make());

// The sidebar turn's system prompt section (app/bg/web-apis/bg/ai.ts runChat, `genUi`): the
// language and the core components.
export function genuiPrompt() {
  return once('core', () =>
    coreLibrary.prompt({ preamble: PREAMBLE, additionalRules: RULES, ...OPTIONS })
  );
}

// The language with every component (guide:genui-pages, and under guide:dashboard).
export function genuiFullPrompt(preamble = PREAMBLE) {
  return once('full:' + preamble, () =>
    fullLibrary.prompt({ preamble, additionalRules: RULES.slice(0, 1), ...OPTIONS })
  );
}

// The signatures between two of the generated prompt's headings.
function signatures(prompt) {
  const from = prompt.indexOf('## Component Signatures');
  const to = prompt.indexOf('## Action');
  if (from < 0) return prompt;
  return prompt
    .slice(from, to < 0 ? undefined : to)
    .replace(/^## Component Signatures\n+/, '')
    .trim();
}

// The components past the core ones, for a turn that already has the language (guide:genui-components).
export function genuiMoreSignatures() {
  return once('more', () => {
    // The library needs every component a slot names; the ones in no group land under "Other".
    const text = signatures(moreLibrary.prompt(OPTIONS));
    const at = text.indexOf('### Other');
    return (at < 0 ? text : text.slice(0, at)).trim();
  });
}

// The home page's widgets (guide:dashboard).
export function genuiHomeSignatures() {
  return once('home', () => {
    const text = signatures(genuiLibrary.prompt(OPTIONS));
    const at = text.indexOf(`### ${HOME_GROUP.name}`);
    return at < 0 ? '' : text.slice(at).trim();
  });
}

// What a live program can do with its data (guide:dashboard's live cards, shared/home-live.mjs):
// lang-core's expression rules and its @ functions, as it teaches them to a turn with tools. The
// Query statement itself is taught there, with Nomad's sources.
export function genuiLivePrompt() {
  return once('live', () => {
    const p = genuiLibrary.prompt({ toolCalls: true, bindings: false, tools: [] });
    const rules = p
      .slice(p.indexOf('## Syntax Rules'), p.indexOf('## Component Signatures'))
      .split('\n')
      .filter((l) => /^(8|9|1[0-5])\. /.test(l))
      .map((l) => '- ' + l.replace(/^\d+\. /, '').replace('"text" + $var + "more"', '"Next: " + today.items[0].title'))
      .join('\n');
    const from = p.indexOf('## Built-in Functions');
    const to = p.indexOf('## Query');
    const fns = p
      .slice(from, to < 0 ? undefined : to)
      .replace(/^## Built-in Functions\n+/, '')
      .trim();
    return `### Expressions\n\n${rules}\n\n### Functions\n\n${fns}`;
  });
}

export function genuiSchema() {
  return genuiLibrary.toJSONSchema();
}
