import { describe, it, expect } from 'vitest';
import { genuiPrompt, genuiSchema, GENUI_FENCE } from '../../app/lib/genui/library.mjs';
import { splitGenUi, hasGenUi } from '../../app/lib/genui/segments.mjs';
import { parseGenUi as parse } from '../../app/lib/genui/parse.mjs';
import schemaJson from '../../app/lib/genui/schema.json';
import { linkOf, dateParts } from '../../app/fg/shell-window/genui/cards.js';
import {
  niceTicks,
  valueDomain,
  stack,
  pieSlices,
  labelStride,
  truncate,
} from '../../app/fg/shell-window/genui/chart-math.js';

describe('genui library', () => {
  it('keeps schema.json in step with the library (run scripts/gen-genui-schema.mjs)', () => {
    expect(JSON.parse(JSON.stringify(genuiSchema()))).toEqual(schemaJson);
  });

  it('teaches the fence and every component, in a prompt of bounded size', () => {
    const prompt = genuiPrompt();
    expect(prompt).toContain('```' + GENUI_FENCE);
    for (const name of Object.keys(schemaJson.properties)) {
      expect(prompt).toContain(`${name}(`);
    }
    // Every sidebar turn carries it.
    expect(prompt.length).toBeLessThan(12000);
  });

  it('has no Image: a model-chosen image URL would load as soon as the answer renders', () => {
    expect(schemaJson.properties.Image).toBeUndefined();
    expect(schemaJson.properties.ImageBlock).toBeUndefined();
  });
});

describe('parsing programs against the library', () => {
  it('parses charts, a map, a table and buttons with their actions', () => {
    const { root, meta } = parse(`root = Stack([stats, card, places, tbl, btns])
stats = Stack([Stat("Users", "1,204", "+3%", "up"), Stat("Churn", "1.8%")], "row")
card = Card([CardHeader("Visits"), chart])
chart = BarChart(["Mon", "Tue"], [Series("Visits", [120, 98]), Series("Signups", [4, 7])], "stacked")
places = Map([MapMarker(48.8584, 2.2945, "Eiffel Tower"), MapMarker(48.8606, 2.3376, "Louvre")], true)
tbl = Table([Col("Name", ["a", "b"]), Col("State", [Tag("open", "success"), Tag("closed")])])
btns = Buttons([Button("More", @ToAssistant("Tell me more")), Button("Map", @OpenUrl("https://www.openstreetmap.org"))])`);
    expect(meta.errors).toEqual([]);
    expect(root.typeName).toBe('Stack');
    const [stats, card, places, tbl, btns] = root.props.children;
    expect(stats.props.children[0].props).toMatchObject({ label: 'Users', trend: 'up' });
    expect(card.props.children[1].props.variant).toBe('stacked');
    expect(places.props.route).toBe(true);
    expect(places.props.markers[1].props).toMatchObject({ lat: 48.8606, label: 'Louvre' });
    expect(tbl.props.columns[1].props.data[0].typeName).toBe('Tag');
    expect(btns.props.buttons.map((b) => b.props.action.steps)).toEqual([
      [{ type: 'continue_conversation', message: 'Tell me more' }],
      [{ type: 'open_url', url: 'https://www.openstreetmap.org' }],
    ]);
  });

  it('parses the cards for a purpose', () => {
    const { root, meta } = parse(`root = Stack([grid, product, event, quote, pc, tl])
grid = CardGrid([e1, l1])
e1 = EntityCard("Hypercore", "Append-only log", [Field("License", "MIT")], null, ["p2p"], "code", "https://github.com/holepunchto/hypercore")
l1 = LinkCard("Nomad docs", "hyper://nomad.dev/docs/", "How drives work")
product = ProductCard("Widget Pro", "$29", "Quiet", 4.5, ["USB-C"], "Best value", @ToAssistant("Tell me about Widget Pro"))
event = EventCard("Launch", "2026-11-04", "18:00", "Lisbon")
quote = QuoteCard("Simple things should be simple.", "Alan Kay")
pc = ProsCons(["Fast"], ["Pricey"], "Widget Pro")
tl = Timeline([TimelineItem("2024", "1.0", null, "success"), TimelineItem("2026", "2.0")])`);
    expect(meta.errors).toEqual([]);
    const [grid, product, event, quote, pc, tl] = root.props.children;
    expect(grid.props.cards[0].props).toMatchObject({ title: 'Hypercore', icon: 'code' });
    expect(grid.props.cards[0].props.fields[0].props).toEqual({ label: 'License', value: 'MIT' });
    expect(grid.props.cards[1].props.url).toBe('hyper://nomad.dev/docs/');
    expect(product.props).toMatchObject({ price: '$29', rating: 4.5, badge: 'Best value' });
    expect(product.props.action.steps[0].type).toBe('continue_conversation');
    expect(event.props).toMatchObject({ date: '2026-11-04', location: 'Lisbon' });
    expect(quote.props.source).toBe('Alan Kay');
    expect(pc.props.cons).toEqual(['Pricey']);
    expect(tl.props.items[0].props.variant).toBe('success');
  });

  it('renders what has arrived of a program that is still streaming', () => {
    const { root, meta } = parse(`root = Stack([title, chart])
title = TextContent("Rainfall", "large-heavy")
chart = LineChart(["Jan", "Fe`);
    expect(meta.incomplete).toBe(true);
    expect(root.props.children[0].props.text).toBe('Rainfall');
  });

  it('drops components the library does not have', () => {
    const { meta } = parse(`root = Stack([img])
img = Image("cat", "https://example.com/cat.png")`);
    expect(meta.errors.some((e) => e.code === 'unknown-component')).toBe(true);
  });
});

describe('splitGenUi', () => {
  it('splits Markdown from fenced programs', () => {
    const text = 'Here it is:\n\n```openui-lang\nroot = Stack([])\n```\n\nThat is all.';
    expect(splitGenUi(text)).toEqual([
      { type: 'md', text: 'Here it is:\n' },
      { type: 'ui', source: 'root = Stack([])', closed: true },
      { type: 'md', text: '\nThat is all.' },
    ]);
    expect(hasGenUi(text)).toBe(true);
  });

  it('marks a fence the stream has not closed yet', () => {
    expect(splitGenUi('Look:\n```openui-lang\nroot = Sta')).toEqual([
      { type: 'md', text: 'Look:' },
      { type: 'ui', source: 'root = Sta', closed: false },
    ]);
  });

  it('leaves openui-lang shown inside another code block as Markdown', () => {
    const text = '````md\n```openui-lang\nroot = Stack([])\n```\n````';
    expect(hasGenUi('```js\nconst a = 1\n```')).toBe(false);
    expect(splitGenUi('```markdown\n```openui-lang\nx\n```').every((s) => s.type === 'md')).toBe(
      true
    );
    expect(splitGenUi(text).length).toBe(1);
  });

  it('is plain Markdown when there is no fence', () => {
    expect(splitGenUi('Just **text**.')).toEqual([{ type: 'md', text: 'Just **text**.' }]);
    expect(splitGenUi('')).toEqual([]);
  });
});

describe('cards', () => {
  it('opens only web and hyper:// urls, and labels them short', () => {
    expect(linkOf('https://www.example.com/a?b')).toMatchObject({ label: 'example.com' });
    expect(linkOf('hyper://' + 'a'.repeat(64) + '/notes.md').label).toBe(
      'hyper://aaaaaa…/notes.md'
    );
    expect(linkOf('javascript:alert(1)')).toBe(null);
    expect(linkOf('file:///etc/passwd')).toBe(null);
    expect(linkOf('not a url')).toBe(null);
  });

  it('reads a YYYY-MM-DD date, and nothing else', () => {
    expect(dateParts('2026-11-04')).toMatchObject({ day: '4' });
    expect(dateParts('2026-02-30')).toBe(null);
    expect(dateParts('next Tuesday')).toBe(null);
  });
});

describe('chart math', () => {
  it('picks round ticks that cover the data', () => {
    expect(niceTicks(0, 143)).toEqual([0, 50, 100, 150]);
    expect(niceTicks(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(-12, 30)).toEqual([-20, 0, 20, 40]);
    const t = niceTicks(5, 5);
    expect(t[0]).toBeLessThanOrEqual(5);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(5);
  });

  it('starts bars at zero but not lines', () => {
    expect(valueDomain([40, 60]).slice(0, 2)).toEqual([0, 60]);
    expect(valueDomain([40, 60], { zero: false })[0]).toBeGreaterThan(0);
  });

  it('stacks positives up and negatives down', () => {
    expect(stack([{ values: [2, -1] }, { values: [3, -2] }], 2)).toEqual([
      [
        [0, 2],
        [-1, 0],
      ],
      [
        [2, 5],
        [-3, -1],
      ],
    ]);
  });

  it('folds small pie slices into Other', () => {
    const labels = 'abcdefghij'.split('');
    const values = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const slices = pieSlices(labels, values, 8);
    expect(slices.length).toBe(8);
    expect(slices[7]).toEqual({ label: 'Other', value: 6, index: -1 });
    expect(pieSlices(['a', 'b'], [1, 0])).toEqual([{ label: 'a', value: 1, index: 0 }]);
  });

  it('thins and shortens axis labels', () => {
    expect(labelStride(30, 10)).toBe(3);
    expect(labelStride(5, 10)).toBe(1);
    expect(truncate('September', 4)).toBe('Sep…');
  });
});
