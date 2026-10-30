// Splits an assistant answer into Markdown and the OpenUI Lang programs fenced in it
// (```openui-lang … ```), for the AI Sidebar (ADR-0027). An answer that is still streaming can end
// inside a fence; that segment has `closed: false`. A fence inside another code block is left as
// Markdown, so an answer can still show openui-lang source as an example.

const OPEN = /^\s{0,3}```\s*openui(?:-lang)?\s*$/i;
const FENCE = /^\s{0,3}```/;

export function splitGenUi(text) {
  const lines = String(text || '').split('\n');
  const segments = [];
  let md = [];
  let ui = null;
  let inOtherFence = false;

  const flushMd = () => {
    const t = md.join('\n');
    if (t.trim()) segments.push({ type: 'md', text: t });
    md = [];
  };

  for (const line of lines) {
    if (ui) {
      if (FENCE.test(line) && line.trim() === '```') {
        segments.push({ type: 'ui', source: ui.join('\n'), closed: true });
        ui = null;
      } else {
        ui.push(line);
      }
      continue;
    }
    if (!inOtherFence && OPEN.test(line)) {
      flushMd();
      ui = [];
      continue;
    }
    if (FENCE.test(line)) inOtherFence = !inOtherFence;
    md.push(line);
  }
  if (ui) segments.push({ type: 'ui', source: ui.join('\n'), closed: false });
  else flushMd();
  return segments;
}

export function hasGenUi(text) {
  return splitGenUi(text).some((s) => s.type === 'ui');
}
