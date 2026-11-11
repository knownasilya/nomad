import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  genuiPrompt,
  genuiFullPrompt,
  genuiMoreSignatures,
  genuiHomeSignatures,
  genuiSchema,
  GENUI_FENCE,
  CORE_COMPONENTS,
  MORE_COMPONENTS,
  HOME_WIDGETS,
  CARD_ICONS,
} from '../../app/lib/genui/library.mjs';
import { ICONS, iconName } from '../../app/lib/genui/icons.mjs';
import { iconNames } from '../../app/lib/genui/page.mjs';
import { FIELDS, initialValue, formMessage } from '../../app/fg/shell-window/genui/forms.js';
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
  sparkGeometry,
  ringDash,
  initials,
  parseMonth,
  monthGrid,
  sortRows,
} from '../../app/fg/shell-window/genui/chart-math.js';

describe('genui library', () => {
  it('keeps schema.json in step with the library (run scripts/gen-genui-schema.mjs)', () => {
    expect(JSON.parse(JSON.stringify(genuiSchema()))).toEqual(schemaJson);
  });

  it('teaches the fence and the core components every turn, in a prompt of bounded size', () => {
    const prompt = genuiPrompt();
    expect(prompt).toContain('```' + GENUI_FENCE);
    for (const name of CORE_COMPONENTS) expect(prompt).toContain(`${name}(`);
    // The rest are named, with the guide that has their arguments (ADR-0048).
    // (their parts, like ListItem, come with them).
    for (const name of MORE_COMPONENTS) {
      expect(prompt).not.toContain(`\n${name}(`);
      if (!/(Item|Mark)$/.test(name)) expect(prompt).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(prompt).toContain('guide:genui-components');
    expect(prompt).toContain('guide:dashboard');
    // Every sidebar turn carries it. The second set of components is why it isn't all of them.
    expect(prompt.length).toBeLessThan(13500);
  });

  it('puts every component in exactly one of the every-turn prompt, the guide, or the home widgets', () => {
    const all = Object.keys(schemaJson.properties).sort();
    expect([...CORE_COMPONENTS, ...MORE_COMPONENTS, ...HOME_WIDGETS].sort()).toEqual(all);
    expect(new Set([...CORE_COMPONENTS, ...MORE_COMPONENTS, ...HOME_WIDGETS]).size).toBe(all.length);
    const more = genuiMoreSignatures();
    for (const name of MORE_COMPONENTS) expect(more).toContain(`\n${name}(`);
    for (const name of CORE_COMPONENTS) expect(more).not.toContain(`\n${name}(`);
    const home = genuiHomeSignatures();
    for (const name of HOME_WIDGETS) expect(home).toContain(`${name}(`);
    // A saved page's guide teaches all of them but the home page's own widgets.
    const full = genuiFullPrompt();
    for (const name of [...CORE_COMPONENTS, ...MORE_COMPONENTS]) expect(full).toContain(`\n${name}(`);
    for (const name of HOME_WIDGETS) expect(full).not.toContain(`${name}(`);
  });

  it('draws only icons the icon font has', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../app/assets/css/fa-all.min.css'), 'utf8');
    expect(new Set(ICONS).size).toBe(ICONS.length);
    for (const name of ICONS) expect(css, name).toContain(`.fa-${name}:before`);
    for (const name of CARD_ICONS) expect(ICONS).toContain(name);
    expect(iconName('rocket')).toBe('rocket');
    expect(iconName(' Rocket ')).toBe('rocket');
    expect(iconName('fa-rocket')).toBe('rocket');
    expect(iconName('rocket fa-spin')).toBe('');
    expect(iconName('x" onclick="alert(1)')).toBe('');
    expect(iconName(null)).toBe('');
    // What the renderer draws by itself in a saved page, which carries only the glyphs it names.
    const builtIn = iconNames('');
    for (const name of ['chevron-down', 'chevron-left', 'chevron-right', 'caret-up', 'caret-down', 'copy', 'folder']) {
      expect(builtIn.has(name), name).toBe(true);
    }
    expect(iconNames('root = Stack([Icon("rocket")])').has('rocket')).toBe(true);
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

  it("opens a link to one of the user's things as the URL Nomad builds", () => {
    expect(linkOf('nomad://notes/abc-123')).toMatchObject({ href: 'nomad://notes/abc-123', label: 'Notes' });
    expect(linkOf('nomad://library/jobs?id=job-abc123&x=1')).toMatchObject({
      href: 'nomad://library/jobs?id=job-abc123',
      label: 'My Library → Jobs',
    });
    expect(linkOf('nomad://reader/?subscribe=https://evil.example/feed')).toMatchObject({ href: 'nomad://reader/' });
    expect(linkOf('nomad://settings')).toBe(null);
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

describe('genui map', () => {
  // The shell window's bundle is its preload, which runs before the page has an <html> element.
  // Leaflet reads document.documentElement as it loads, so importing it as a module threw there
  // and the window started blank (1.26.1). map.js runs Leaflet's source on the first draw instead.
  it('never imports Leaflet as a module in the shell window', () => {
    const dir = path.join(__dirname, '../../app/fg/shell-window');
    const files = fs
      .readdirSync(dir, { recursive: true })
      .filter((f) => f.endsWith('.js') && !f.endsWith('.build.js'));
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/(from|import\(|require\()\s*['"]leaflet(\/[^'"?]*)?['"]/);
    }
  });
});

describe('the second set of components (ADR-0048)', () => {
  it('parses layout, content and list components with their slots', () => {
    const { root, meta } = parse(`root = Stack([head, grid, cols, acc, list, data, tree, cal, tbl], "column", "m", "start", false, "between")
head = Header("Trip", "Lisbon in December", "Plan", "plane", [Button("Share", null, "secondary", "share-alt", "s")])
grid = Grid([GridItem([Stat("Spent", "€1,240", "+€180", "up", "this week", "wallet", "primary", [1, 2, 3])], 2), Progress("Budget", 62, 100, "success", "ring", "of €2,000")], 3, "l")
cols = Columns([Card([CardHeader("A", "sub", "book", Tag("New", "info", "star", "solid"))], "soft", [Buttons([Button("Open")])], "primary"), Empty("Nothing yet", "Add one", "inbox")], 2)
acc = Accordion([AccordionItem("Why", [TextContent("Because", "small", "muted")], "question-circle", true)], true)
list = List([ListItem("Ana", "Host", Avatar("Ana Costa", null, "primary", "m", "online"), Tag("Paid", "success"), "https://example.com")], "divided")
data = DataList([Field("Check-in", "Dec 12")], "columns")
tree = Tree([TreeItem("src", [TreeItem("index.js")], "folder", true)])
cal = Calendar("2026-12", [CalendarMark("2026-12-12", "Fly out", "primary")])
tbl = Table([Col("Name", ["a", "b"])], 5, "striped", "Guests")`);
    expect(meta.errors).toEqual([]);
    const [head, grid, cols, acc, list, data, tree, cal, tbl] = root.props.children;
    expect(root.props.justify).toBe('between');
    expect(head.props).toMatchObject({ title: 'Trip', eyebrow: 'Plan', icon: 'plane' });
    expect(head.props.actions[0].props).toMatchObject({ label: 'Share', icon: 'share-alt', size: 's' });
    expect(grid.props.columns).toBe(3);
    expect(grid.props.children[0].props.span).toBe(2);
    expect(grid.props.children[0].props.children[0].props).toMatchObject({ icon: 'wallet', color: 'primary', spark: [1, 2, 3] });
    expect(grid.props.children[1].props).toMatchObject({ variant: 'ring', color: 'success' });
    const card = cols.props.children[0];
    expect(card.props).toMatchObject({ variant: 'soft', color: 'primary' });
    expect(card.props.footer[0].typeName).toBe('Buttons');
    expect(card.props.children[0].props.trailing.props).toMatchObject({ text: 'New', icon: 'star', style: 'solid' });
    expect(acc.props.items[0].props).toMatchObject({ label: 'Why', open: true });
    expect(list.props.items[0].props.leading.typeName).toBe('Avatar');
    expect(list.props.items[0].props.trailing.typeName).toBe('Tag');
    expect(data.props.layout).toBe('columns');
    expect(tree.props.items[0].props.children[0].props.label).toBe('index.js');
    expect(cal.props.marks[0].props).toMatchObject({ date: '2026-12-12', color: 'primary' });
    expect(tbl.props).toMatchObject({ pageSize: 5, variant: 'striped', caption: 'Guests' });
  });

  it('still parses a program written before the new arguments', () => {
    const { root, meta } = parse(`root = Stack([Card([CardHeader("Old", "card")], "sunk"), Callout("info", "Title", "Text"), Tag("x", "success"), Steps([StepsItem("One", "First")]), Table([Col("A", [1])]), Button("Go")], "row", "s", "center", true)`);
    expect(meta.errors).toEqual([]);
    expect(root.props.children.map((c) => c.typeName)).toEqual(['Card', 'Callout', 'Tag', 'Steps', 'Table', 'Button']);
  });

  it('parses a form and the home page widgets', () => {
    const { root, meta } = parse(`root = Stack([form, HomeGreeting(), board])
form = Form([Input("name", "Name", "Ada", "text"), Textarea("note", "Note"), Select("size", "Size", ["S", "M"], "M"), RadioGroup("when", "When", ["Now", "Later"]), CheckboxGroup("extras", "Extras", ["Bag", "Seat"], ["Bag"]), Switch("news", "Newsletter", true), Slider("qty", "Quantity", 1, 10, 3, 1)], "Book", "Booking")
board = Columns([HomeNotes(10), HomeCards()], 2)`);
    expect(meta.errors).toEqual([]);
    const [form, greeting, board] = root.props.children;
    expect(form.props.fields.map((f) => f.typeName)).toEqual(FIELDS);
    expect(form.props).toMatchObject({ submit: 'Book', title: 'Booking' });
    expect(greeting.typeName).toBe('HomeGreeting');
    expect(board.props.children[0].props.limit).toBe(10);
  });
});

describe('forms', () => {
  it('starts each field from its value, and only from one it offers', () => {
    expect(initialValue('Input', { value: 'Ada' })).toBe('Ada');
    expect(initialValue('Input', { value: { a: 1 } })).toBe('');
    expect(initialValue('Input', { value: 'x'.repeat(5000) })).toHaveLength(2000);
    expect(initialValue('Select', { options: ['S', 'M'], value: 'M' })).toBe('M');
    expect(initialValue('Select', { options: ['S', 'M'], value: 'XL' })).toBe('');
    expect(initialValue('CheckboxGroup', { options: ['a', 'b'], values: ['b', 'z'] })).toEqual(['b']);
    expect(initialValue('Switch', { value: true })).toBe(true);
    expect(initialValue('Switch', { value: 'yes' })).toBe(false);
    expect(initialValue('Slider', { min: 1, max: 10, value: 30 })).toBe(10);
    expect(initialValue('Slider', { min: 5, max: 1 })).toBe(5);
  });

  it('sends the answers as a message the user can read', () => {
    const f = (typeName, props) => ({ type: 'element', typeName, props });
    const fields = [
      f('Input', { name: 'name', label: 'Name' }),
      f('Textarea', { name: 'note', label: 'Note' }),
      f('CheckboxGroup', { name: 'extras', label: 'Extras' }),
      f('Switch', { name: 'news', label: 'Newsletter' }),
      f('Slider', { label: 'Quantity' }),
    ];
    const values = { name: ' Ada ', note: '', extras: ['Bag', 'Seat'], news: false, field5: 3 };
    expect(formMessage('Booking', fields, values)).toBe(
      'Booking:\n- Name: Ada\n- Extras: Bag, Seat\n- Newsletter: no\n- Quantity: 3'
    );
    expect(formMessage('', [], {})).toBe('My answers');
  });
});

describe('math for the new components', () => {
  it('lays a sparkline out in its box', () => {
    const g = sparkGeometry([1, 3, 2], 100, 28, 2);
    expect(g.points).toHaveLength(3);
    expect(g.points[0]).toEqual([0, 26]);
    expect(g.points[1]).toEqual([50, 2]);
    expect(g.points[2][0]).toBe(100);
    expect(g.line).toBe('M0,26L50,2L100,14');
    expect(g.area).toBe('M0,26L50,2L100,14L100,28L0,28Z');
    expect(g.bars).toHaveLength(3);
    expect(g.bars[1]).toMatchObject({ y: 0, h: 28 });
    // One value, or values that are all the same, is a flat line, not a division by zero.
    expect(sparkGeometry([5, 5, 5]).points.map((p) => p[1])).toEqual([14, 14, 14]);
    expect(sparkGeometry([]).points).toEqual([]);
    expect(sparkGeometry(['a', null, 4]).points).toHaveLength(1);
  });

  it('draws a ring by its share', () => {
    const full = 2 * Math.PI * 10;
    expect(ringDash(50, 10)).toBe(`${(full * 50) / 100} ${full}`);
    expect(ringDash(150, 10)).toBe(`${(full * 100) / 100} ${full}`);
    expect(ringDash(-5, 10)).toBe(`0 ${full}`);
    expect(ringDash('half', 10)).toBe(`0 ${full}`);
  });

  it('makes initials for an avatar', () => {
    expect(initials('Ana Costa')).toBe('AC');
    expect(initials('ada')).toBe('A');
    expect(initials('Jean-Luc de la Tour Picard')).toBe('JP');
    expect(initials('Ana María Díaz')).toBe('AD');
    expect(initials('')).toBe('?');
  });

  it('lays a month out in weeks', () => {
    expect(parseMonth('2026-12')).toEqual({ year: 2026, month: 11 });
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('december')).toBeNull();
    const weeks = monthGrid(2026, 1); // February 2026 starts on a Sunday and has 28 days
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0]).toBe(1);
    expect(weeks[3][6]).toBe(28);
    const dec = monthGrid(2026, 11); // starts on a Tuesday
    expect(dec[0].slice(0, 3)).toEqual([null, null, 1]);
    expect(dec.flat().filter(Boolean)).toHaveLength(31);
    expect(dec.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid(2026, 11, 1)[0].slice(0, 2)).toEqual([null, 1]); // Monday first
  });

  it('sorts a table by a column, numbers as numbers', () => {
    const cells = ['10', '9', '1,200', 'n/a'];
    expect(sortRows([0, 1, 2, 3], cells, 'asc')).toEqual([1, 0, 2, 3]);
    expect(sortRows([0, 1, 2, 3], cells, 'desc')).toEqual([3, 2, 0, 1]);
    // An empty cell goes last either way, and a component sorts by the text it shows.
    expect(sortRows([0, 1, 2], ['b', '', 'a'], 'asc')).toEqual([2, 0, 1]);
    expect(sortRows([0, 1, 2], ['b', null, 'a'], 'desc')).toEqual([0, 2, 1]);
    const tag = (text) => ({ type: 'element', typeName: 'Tag', props: { text } });
    expect(sortRows([0, 1], [tag('open'), tag('closed')], 'asc')).toEqual([1, 0]);
    expect(sortRows([0, 1, 2], ['pear', 'Apple', 'fig'], 'asc')).toEqual([1, 2, 0]);

  });
});
