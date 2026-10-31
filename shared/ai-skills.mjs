// nomad/shared/ai-skills.mjs
//
// AI skills (ADR-0034): instructions the user gives their own assistant for one kind of task, like
// "weekly-report: how I want my weekly report written" or "recipe-card: turn a recipe page into a
// Note". One set per user, kept in the Vault so every linked Device has them:
//
//   /.vault/ai-skills/<id>.json   { type, id, name, description, instructions, enabled, createdAt, updatedAt }
//
// A personal turn's system prompt lists every enabled skill by name and description (skillsPrompt);
// the model opens one it needs with search { entity: 'skill:<name>' }, which returns its
// instructions. So a long skill costs nothing on a turn that doesn't use it. The user lists, adds,
// edits, turns on and off, and deletes skills on nomad://ai/skills. The AI can read them, not change
// them. A skill reads and writes as a SKILL.md (front matter `name` and `description`, then the
// instructions), the format other assistants use, so the user can bring theirs along.
//
// Pure: no imports. Used by app/bg/ai/skills.js, search-execute.mjs, the AI page and the tests.

export const SKILL_PREFIX = '/.vault/ai-skills/';
export const SKILL_TYPE = 'nomad/ai-skill';

export const MAX_SKILL_NAME = 64;
// The description is what the model reads on every turn to decide whether to open the skill.
export const MAX_SKILL_DESCRIPTION = 1024;
// The instructions are read only when the skill is opened.
export const MAX_SKILL_INSTRUCTIONS = 20000;
export const MAX_SKILLS = 100;
// The part of every personal turn's system prompt the skill list may take, in characters.
export const MAX_SKILLS_PROMPT_CHARS = 6000;

export function newSkillId(now = Date.now(), rand = Math.random) {
  const tail = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return 's' + now.toString(36).padStart(9, '0') + '-' + tail;
}

export function isSkillId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
}

export function skillPath(id) {
  if (!isSkillId(id)) throw new Error('Not a skill id: ' + id);
  return SKILL_PREFIX + id + '.json';
}

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSkillName(name) {
  return typeof name === 'string' && name.length <= MAX_SKILL_NAME && NAME_RE.test(name);
}

// A name as stored: lowercase words joined by hyphens ("Weekly Report" -> "weekly-report").
// Throws when nothing is left or it's too long.
export function cleanSkillName(name) {
  const s = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) throw new Error('A skill needs a name, like weekly-report');
  if (s.length > MAX_SKILL_NAME)
    throw new Error(`A skill name is at most ${MAX_SKILL_NAME} characters`);
  return s;
}

// The description as stored: one line, trimmed.
export function cleanSkillDescription(text) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) throw new Error('A skill needs a description that says when to use it');
  if (s.length > MAX_SKILL_DESCRIPTION) {
    throw new Error(`A skill description is at most ${MAX_SKILL_DESCRIPTION} characters`);
  }
  return s;
}

// The instructions as stored: Markdown, with line breaks kept and the ends trimmed.
export function cleanSkillInstructions(text) {
  const s = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!s) throw new Error('A skill needs instructions');
  if (s.length > MAX_SKILL_INSTRUCTIONS) {
    throw new Error(
      `A skill's instructions are at most ${MAX_SKILL_INSTRUCTIONS.toLocaleString('en-US')} characters`
    );
  }
  return s;
}

// A new skill (prev null) or changes to one. Fields left undefined keep their values; a new skill is on.
export function makeSkill(fields, prev = null, now = new Date().toISOString()) {
  const f = {
    ...prev,
    ...Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined)),
  };
  if (!isSkillId(f.id)) throw new Error('Not a skill id: ' + f.id);
  return {
    type: SKILL_TYPE,
    id: f.id,
    name: cleanSkillName(f.name),
    description: cleanSkillDescription(f.description),
    instructions: cleanSkillInstructions(f.instructions),
    enabled: f.enabled !== false,
    createdAt: (prev && prev.createdAt) || now,
    updatedAt: now,
  };
}

export function isSkill(rec) {
  return (
    !!rec &&
    rec.type === SKILL_TYPE &&
    isSkillId(rec.id) &&
    isSkillName(rec.name) &&
    typeof rec.description === 'string' &&
    rec.description.trim().length > 0 &&
    typeof rec.instructions === 'string' &&
    rec.instructions.trim().length > 0
  );
}

// By name, the order the AI page and the prompt list them in.
export function sortSkills(list) {
  return [...(list || [])].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1
  );
}

// The skill with this name, or null. `exceptId` skips the skill being renamed.
export function findSkillByName(list, name, exceptId = null) {
  let n;
  try {
    n = cleanSkillName(name);
  } catch {
    return null;
  }
  return (list || []).find((s) => s.name === n && s.id !== exceptId) || null;
}

const key = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

// Skills whose name, description or instructions have every word of `query`, by name.
export function searchSkills(list, query) {
  const words = key(query).split(' ').filter(Boolean);
  const rows = sortSkills((list || []).filter(isSkill));
  if (!words.length) return rows;
  return rows.filter((s) => {
    const k = key(`${s.name} ${s.description} ${s.instructions}`);
    return words.every((w) => k.includes(w));
  });
}

// The block a personal turn's system prompt gets: every enabled skill's name and description, up
// to maxChars. '' when none is on.
export function skillsPrompt(list, { maxChars = MAX_SKILLS_PROMPT_CHARS } = {}) {
  const rows = sortSkills((list || []).filter((s) => isSkill(s) && s.enabled !== false));
  if (!rows.length) return '';
  const lines = [];
  let used = 0;
  let left = 0;
  for (const s of rows) {
    const line = `- ${s.name}: ${s.description}`;
    if (used + line.length + 1 > maxChars) {
      left++;
      continue;
    }
    lines.push(line);
    used += line.length + 1;
  }
  const more = left
    ? `\n(${left} more ${left === 1 ? 'skill is' : 'skills are'} not listed here. search { "domain": "skill" } lists every one.)`
    : '';
  return (
    "Skills: instructions the user wrote for kinds of tasks. When a request matches a skill's description, open " +
    'it first with search { "entity": "skill:<name>" } and follow its instructions as the user\'s own, within your ' +
    'other rules. Open only the skills the request needs. The user manages them on the AI page.\n' +
    lines.join('\n') +
    more
  );
}

// SKILL.md
// =

// A SKILL.md's text as { name, description, instructions }: YAML-ish front matter with `name` and
// `description` (plain, quoted, or a folded > / | block), then the instructions. Text without front
// matter is all instructions. Fields that are missing are ''.
export function parseSkillMd(text) {
  const src = String(text ?? '')
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src);
  if (!m) return { name: '', description: '', instructions: src.trim() };
  const fields = {};
  const lines = m[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) {
        block.push(lines[++i].trim());
      }
      value = value[0] === '>' ? block.filter(Boolean).join(' ') : block.join('\n').trim();
    } else {
      value = unquote(value);
    }
    fields[kv[1].toLowerCase()] = value;
  }
  return {
    name: typeof fields.name === 'string' ? fields.name : '',
    description: typeof fields.description === 'string' ? fields.description : '',
    instructions: src.slice(m[0].length).trim(),
  };
}

function unquote(v) {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    return v.slice(1, -1).replace(/''/g, "'");
  return v.replace(/\s+#.*$/, '');
}

// A skill as SKILL.md text.
export function skillMd(skill) {
  return `---\nname: ${skill.name}\ndescription: ${yamlString(skill.description)}\n---\n\n${skill.instructions.trim()}\n`;
}

function yamlString(s) {
  const str = String(s || '');
  return /^[\s'"[\]{}>|*&!%@`#,?-]|: |\s#|\s$/.test(str) ? JSON.stringify(str) : str;
}
