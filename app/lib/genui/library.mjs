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
// The parser in the shell window takes this library's JSON Schema (schema.json, kept in step by
// tests/unit/genui.test.js and `node scripts/gen-genui-schema.mjs`), so the window bundles neither
// zod nor this file.

import { action, createLibrary, defineComponent } from '@openuidev/lang-core';
import { z } from 'zod';

export const GENUI_FENCE = 'openui-lang';

const def = (name, description, props) =>
  defineComponent({ name, description, props: z.object(props), component: null });

const gap = z.enum(['none', 'xs', 's', 'm', 'l', 'xl']).optional();

// — Layout —

const Stack = def('Stack', 'Lays out children in a column (default) or a row', {
  children: z.array(z.any()),
  direction: z.enum(['row', 'column']).optional(),
  gap,
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  wrap: z.boolean().optional(),
});
const CardHeader = def('CardHeader', 'Title and optional subtitle at the top of a Card', {
  title: z.string().optional(),
  subtitle: z.string().optional(),
});
const Card = def('Card', 'A bordered box that groups related content', {
  children: z.array(z.any()),
  variant: z.enum(['card', 'sunk', 'clear']).optional(),
});
const TabItem = def('TabItem', 'value is a unique id, trigger is the tab label', {
  value: z.string(),
  trigger: z.string(),
  content: z.array(z.any()),
});
const Tabs = def('Tabs', 'Alternative views of the same subject, one visible at a time', {
  items: z.array(TabItem.ref),
});
const Separator = def('Separator', 'A horizontal rule between sections', {});

// — Content —

const TextContent = def('TextContent', 'A paragraph or a heading of plain text', {
  text: z.string(),
  size: z.enum(['small', 'default', 'large', 'small-heavy', 'large-heavy']).optional(),
});
const Callout = def('Callout', 'A colored notice with a title and a description', {
  variant: z.enum(['info', 'warning', 'error', 'success', 'neutral']),
  title: z.string(),
  description: z.string(),
});
const Tag = def('Tag', 'A small colored badge', {
  text: z.string(),
  variant: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).optional(),
});
const TagBlock = def('TagBlock', 'A row of neutral tags', { tags: z.array(z.string()) });
const StepsItem = def('StepsItem', 'One numbered step', {
  title: z.string(),
  details: z.string(),
});
const Steps = def('Steps', 'A numbered step-by-step guide', { items: z.array(StepsItem.ref) });
const Stat = def(
  'Stat',
  'A headline number (KPI). change is a short delta like "+12%"; trend colors it',
  {
    label: z.string(),
    value: z.string(),
    change: z.string().optional(),
    trend: z.enum(['up', 'down', 'flat']).optional(),
    caption: z.string().optional(),
  }
);
const Progress = def('Progress', 'A labelled bar showing value out of max (default 100)', {
  label: z.string(),
  value: z.number(),
  max: z.number().optional(),
});

// — Tables —

const Col = def('Col', 'One table column: a header and one value per row', {
  label: z.string(),
  data: z.array(z.any()),
  type: z.enum(['string', 'number']).optional(),
});
const Table = def('Table', 'A table, column by column. Every Col has one value per row', {
  columns: z.array(Col.ref),
});

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

export const CARD_ICONS = [
  'user',
  'users',
  'building',
  'map-marker-alt',
  'box',
  'book',
  'code',
  'file-alt',
  'folder',
  'globe',
  'calendar-alt',
  'music',
  'film',
  'utensils',
  'plane',
  'star',
];

const Field = def('Field', 'One label and value on an EntityCard', {
  label: z.string(),
  value: z.string(),
});
const EntityCard = def(
  'EntityCard',
  'A person, place, project, package or other thing: its name, facts and tags',
  {
    title: z.string(),
    subtitle: z.string().optional(),
    fields: z.array(Field.ref).optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    icon: z.enum(CARD_ICONS).optional(),
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
});
const Timeline = def('Timeline', 'Dated events in order: history, a changelog, a schedule', {
  items: z.array(TimelineItem.ref),
});
const CardGrid = def('CardGrid', 'Cards in as many columns as fit (one in a narrow sidebar)', {
  cards: z.array(z.any()),
});

// — Buttons —

const Button = def('Button', 'A button. Without an action it sends its label to you', {
  label: z.string(),
  action: action().optional(),
  variant: z.enum(['primary', 'secondary', 'tertiary']).optional(),
});
const Buttons = def('Buttons', 'A group of Buttons', {
  buttons: z.array(Button.ref),
  direction: z.enum(['row', 'column']).optional(),
});

export const genuiLibrary = createLibrary({
  root: 'Stack',
  components: [
    Stack,
    Card,
    CardHeader,
    Tabs,
    TabItem,
    Separator,
    TextContent,
    Callout,
    Tag,
    TagBlock,
    Steps,
    StepsItem,
    Stat,
    Progress,
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
    Button,
    Buttons,
  ],
  componentGroups: [
    {
      name: 'Layout',
      components: ['Stack', 'Card', 'CardHeader', 'Tabs', 'TabItem', 'Separator'],
      notes: [
        '- The sidebar is narrow (about 300-600px). Stack in a column; put at most 2-3 short items (Stats, Tags, Buttons) in a row.',
        '- Wrap each chart, map or table in a Card with a CardHeader that names it.',
      ],
    },
    {
      name: 'Content',
      components: [
        'TextContent',
        'Callout',
        'Tag',
        'TagBlock',
        'Steps',
        'StepsItem',
        'Stat',
        'Progress',
      ],
      notes: ['- Stats in a row: Stack([s1, s2, s3], "row", "s", "stretch", true)'],
    },
    {
      name: 'Tables',
      components: ['Table', 'Col'],
      notes: [
        '- Table is COLUMN-oriented: Table([Col("Name", names), Col("Stars", stars, "number")]).',
        '- A cell can be a Tag: Col("Status", [Tag("open", "success"), Tag("closed", "neutral")]).',
      ],
    },
    {
      name: 'Charts',
      components: [
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
      notes: [
        '- Every Series has one number per label: LineChart(["Mon", "Tue"], [Series("Visits", [120, 98])]).',
        '- At most 4 series per chart. Numbers only: no units or commas inside values; put units in yLabel.',
      ],
    },
    {
      name: 'Maps',
      components: ['Map', 'MapMarker'],
      notes: [
        '- Map([MapMarker(48.8584, 2.2945, "Eiffel Tower"), MapMarker(48.8606, 2.3376, "Louvre")], true)',
        '- Use coordinates you are sure of; leave zoom out and the map fits its markers.',
      ],
    },
    {
      name: 'Cards',
      components: [
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
      notes: [
        '- Several results of one kind: CardGrid([LinkCard(...), LinkCard(...)]). Give every card in a grid the same fields.',
        '- EntityCard("Hypercore", "Append-only log", [Field("License", "MIT"), Field("Language", "JavaScript")], null, ["p2p"], "code")',
        '- ProductCard("Widget Pro", "$29", "Fast and quiet", 4.5, ["USB-C"], "Best value", @ToAssistant("Tell me about Widget Pro"))',
        '- Only give a url you got from the page, a tool or the user.',
      ],
    },
    {
      name: 'Buttons',
      components: ['Button', 'Buttons'],
      notes: [
        '- Offer next steps as Buttons: Button("Compare prices", @ToAssistant("Compare their prices")).',
        '- Link out with @OpenUrl("https://…"); it opens in a new tab when the user clicks. A Note, Job or Mod a tool gave a nomad:// url for opens the same way.',
      ],
    },
  ],
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
];

let prompt = null;

// The sidebar turn's system prompt section (app/bg/web-apis/bg/ai.ts runChat, `genUi`).
export function genuiPrompt() {
  if (!prompt) {
    prompt = genuiLibrary.prompt({
      preamble: PREAMBLE,
      additionalRules: RULES,
      toolCalls: false,
      bindings: false,
    });
  }
  return prompt;
}

export function genuiSchema() {
  return genuiLibrary.toJSONSchema();
}
