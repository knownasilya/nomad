// Which terminal commands the AI may run (runTerminalCommand, from `ai` / `?`): ones that only look
// run at once, ones that change the drive wait for the user's yes, and the rest are refused.
// Pure, so tests/unit/webterm.test.js runs it.

import { splitCommands, splitRedirect } from './line.js';

export const LOOK = new Set([
  'ls',
  'tree',
  'pwd',
  'cd',
  'cat',
  'head',
  'tail',
  'stat',
  'wc',
  'readlink',
  'find',
  'grep',
  'search',
  'query',
  'versions',
  'diff',
  'info',
  'echo',
  'help',
]);

export const CHANGE = new Set(['write', 'touch', 'mkdir', 'mv', 'cp', 'rm', 'ln', 'meta', 'restore']);

// Flags that turn a looking command into one that opens something.
const OPENS = { versions: /(^|\s)(-o|--open)(\s|=|$)/ };

// { kind: 'look' | 'change' | 'refuse', reason? }. `expand` turns an alias into its command
// (ll → ls -l); `known` says whether a name is one of the terminal's commands.
export function classifyAiLine(input, { expand = (s) => s, known = () => true } = {}) {
  const text = String(input || '').trim();
  if (!text) return { kind: 'refuse', reason: 'There is no command to run' };
  if (/[\r\n]/.test(text)) return { kind: 'refuse', reason: 'Run one line at a time' };
  let parts;
  try {
    parts = splitCommands(text);
  } catch (err) {
    return { kind: 'refuse', reason: err.message };
  }
  if (!parts.length) return { kind: 'refuse', reason: 'There is no command to run' };
  let change = false;
  for (const part of parts) {
    let one;
    let redirect;
    try {
      ({ line: one, redirect } = splitRedirect(part.line));
    } catch (err) {
      return { kind: 'refuse', reason: err.message };
    }
    const expanded = expand(one.trim());
    const name = expanded.split(/\s+/)[0];
    if (name.startsWith('@')) return { kind: 'refuse', reason: `The page's own commands (${name}) are for the user to run` };
    if (name.startsWith('!')) return { kind: 'refuse', reason: 'History expansion (!) is for the user' };
    if (!known(name)) return { kind: 'refuse', reason: `Command not found: ${name}` };
    if (CHANGE.has(name)) change = true;
    else if (LOOK.has(name)) {
      if (OPENS[name] && OPENS[name].test(expanded)) {
        return { kind: 'refuse', reason: `${name} --open is for the user; link nomad://versions in your answer instead` };
      }
    } else {
      return { kind: 'refuse', reason: `${name} is for the user to run. You can run: ${[...LOOK, ...CHANGE].join(', ')}` };
    }
    if (redirect) change = true;
  }
  return { kind: change ? 'change' : 'look' };
}
