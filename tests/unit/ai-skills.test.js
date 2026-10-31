import { describe, it, expect } from 'vitest';
import {
  SKILL_PREFIX,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_INSTRUCTIONS,
  newSkillId,
  isSkillId,
  skillPath,
  cleanSkillName,
  cleanSkillDescription,
  cleanSkillInstructions,
  makeSkill,
  isSkill,
  sortSkills,
  findSkillByName,
  searchSkills,
  skillsPrompt,
  parseSkillMd,
  skillMd,
} from '../../shared/ai-skills.mjs';
import { buildCatalog, search, DOMAINS, JOB_CAPS, CAPABILITIES } from '../../app/bg/ai/search-execute.mjs';
import { toolSummary } from '../../app/bg/ai/tool-summary.mjs';

const at = (n) => new Date(Date.UTC(2026, 9, n)).toISOString();
const skill = (id, name, fields = {}, n = 1) =>
  makeSkill(
    {
      id,
      name,
      description: `Use for ${name}`,
      instructions: `Steps for ${name}`,
      ...fields,
    },
    null,
    at(n)
  );

describe('AI skill records', () => {
  it('makes ids that are paths in the Vault', () => {
    const id = newSkillId(Date.UTC(2026, 9, 31), () => 0.5);
    expect(isSkillId(id)).toBe(true);
    expect(skillPath(id)).toBe(`${SKILL_PREFIX}${id}.json`);
    expect(() => skillPath('../x')).toThrow(/Not a skill id/);
  });

  it('turns a name into lowercase words joined by hyphens', () => {
    expect(cleanSkillName('  Weekly Report! ')).toBe('weekly-report');
    expect(cleanSkillName('Café_notes--2')).toBe('cafe-notes-2');
    expect(() => cleanSkillName(' -- ')).toThrow(/needs a name/);
    expect(() => cleanSkillName('a'.repeat(65))).toThrow(/at most 64/);
  });

  it('keeps the description to one line and the instructions as written', () => {
    expect(cleanSkillDescription('Use when\n  I ask ')).toBe('Use when I ask');
    expect(() => cleanSkillDescription(' ')).toThrow(/needs a description/);
    expect(() => cleanSkillDescription('x'.repeat(MAX_SKILL_DESCRIPTION + 1))).toThrow(/at most/);
    expect(cleanSkillInstructions('\r\n# Steps\r\n\r\n1. One\r\n')).toBe('# Steps\n\n1. One');
    expect(() => cleanSkillInstructions('')).toThrow(/needs instructions/);
    expect(() => cleanSkillInstructions('x'.repeat(MAX_SKILL_INSTRUCTIONS + 1))).toThrow(/at most/);
  });

  it('is on when new, keeps createdAt on an edit, and changes only the fields given', () => {
    const a = skill('s1', 'weekly-report');
    expect(a).toMatchObject({ type: 'nomad/ai-skill', id: 's1', enabled: true, createdAt: at(1), updatedAt: at(1) });
    const b = makeSkill({ id: 's1', enabled: false }, a, at(4));
    expect(b).toMatchObject({ name: 'weekly-report', instructions: 'Steps for weekly-report', enabled: false, createdAt: at(1), updatedAt: at(4) });
    expect(isSkill(b)).toBe(true);
    expect(isSkill({ ...b, name: 'Bad Name' })).toBe(false);
    expect(isSkill({ ...b, instructions: ' ' })).toBe(false);
    expect(isSkill({ ...b, type: 'nomad/ai-memory' })).toBe(false);
  });

  it('sorts by name, finds a name taken by another skill, and searches every field', () => {
    const list = [
      skill('s2', 'recipe-card', { instructions: 'Make a Note with the ingredients' }),
      skill('s1', 'weekly-report'),
    ];
    expect(sortSkills(list).map((s) => s.id)).toEqual(['s2', 's1']);
    expect(findSkillByName(list, 'Weekly Report')?.id).toBe('s1');
    expect(findSkillByName(list, 'weekly-report', 's1')).toBe(null);
    expect(findSkillByName(list, '!!')).toBe(null);
    expect(searchSkills(list, 'note ingredients').map((s) => s.id)).toEqual(['s2']);
    expect(searchSkills(list, 'weekly').map((s) => s.id)).toEqual(['s1']);
    expect(searchSkills(list, '').map((s) => s.id)).toEqual(['s2', 's1']);
  });
});

describe('AI skills in the prompt', () => {
  it('is empty with no skill on', () => {
    expect(skillsPrompt([])).toBe('');
    expect(skillsPrompt([skill('s1', 'weekly-report', { enabled: false })])).toBe('');
  });

  it('lists the skills that are on by name and description, and says how to open one', () => {
    const text = skillsPrompt([
      skill('s1', 'weekly-report'),
      skill('s2', 'recipe-card', { enabled: false }),
    ]);
    expect(text).toMatch(/"entity": "skill:<name>"/);
    expect(text).toContain('- weekly-report: Use for weekly-report');
    expect(text).not.toContain('recipe-card');
    // The instructions wait until the skill is opened.
    expect(text).not.toContain('Steps for');
  });

  it('stops at its size and says how many are left out', () => {
    const list = Array.from({ length: 10 }, (_, i) =>
      skill(`s${i}`, `skill-${i}`, { description: `Does task ${i} ${'x'.repeat(40)}` })
    );
    const text = skillsPrompt(list, { maxChars: 200 });
    expect(text).toContain('skill-0');
    expect(text).not.toContain('skill-9');
    expect(text).toMatch(/more skills are not listed/);
  });
});

describe('SKILL.md', () => {
  it('reads front matter and instructions', () => {
    const md = '---\nname: weekly-report\ndescription: "Use when: I ask for my week"\n---\n\n# Steps\n\n1. Read my Notes\n';
    expect(parseSkillMd(md)).toEqual({
      name: 'weekly-report',
      description: 'Use when: I ask for my week',
      instructions: '# Steps\n\n1. Read my Notes',
    });
  });

  it('reads a folded description, single quotes and CRLF', () => {
    const md = "---\r\nname: 'it''s'\r\ndescription: >\r\n  Use when I ask\r\n  for a recipe\r\nlicense: MIT\r\n---\r\nBody";
    expect(parseSkillMd(md)).toEqual({ name: "it's", description: 'Use when I ask for a recipe', instructions: 'Body' });
  });

  it('treats text without front matter as instructions', () => {
    expect(parseSkillMd('Just do it\n')).toEqual({ name: '', description: '', instructions: 'Just do it' });
  });

  it('writes a skill that reads back the same', () => {
    for (const description of ['Use for reports', 'Use when: asked', '- starts with a dash', "It's #1"]) {
      const s = skill('s1', 'weekly-report', { description, instructions: '# Steps\n\n1. One' });
      const back = parseSkillMd(skillMd(s));
      expect(back).toEqual({ name: 'weekly-report', description, instructions: '# Steps\n\n1. One' });
    }
  });
});

describe('the skill domain in search', () => {
  const skills = [
    skill('s1', 'weekly-report', { instructions: 'Group my Notes by project' }),
    skill('s2', 'recipe-card'),
  ];

  it('is only on a personal turn', () => {
    expect(DOMAINS).toContain('skill');
    expect(buildCatalog({ personal: true, skills }).skills).toHaveLength(2);
    expect(buildCatalog({ personal: false, skills }).skills).toBe(null);
    const page = buildCatalog({ personal: false, skills });
    expect(() => search({ domain: 'skill' }, page)).toThrow(/not available/);
    expect(() => search({ entity: 'skill:weekly-report' }, page)).toThrow(/not available/);
    expect(search({}, page).domains.map((d) => d.domain)).not.toContain('skill');
  });

  it('lists, ranks and opens a skill with its instructions', () => {
    const catalog = buildCatalog({ personal: true, skills });
    expect(search({}, catalog).domains.find((d) => d.domain === 'skill')).toMatchObject({ count: 2 });
    expect(search({ domain: 'skill' }, catalog).hits.map((h) => h.entity)).toEqual([
      'skill:weekly-report',
      'skill:recipe-card',
    ]);
    expect(search({ query: 'weekly report' }, catalog).hits[0].entity).toBe('skill:weekly-report');
    const [opened] = search({ entity: 'skill:weekly-report' }, catalog).details;
    expect(opened).toEqual({
      entity: 'skill:weekly-report',
      type: 'skill',
      title: 'weekly-report',
      summary: 'Use for weekly-report',
      instructions: 'Group my Notes by project',
    });
    expect(() => search({ entity: 'skill:nope' }, catalog)).toThrow(/unknown skill/);
  });

  it('gives the AI no way to change skills', () => {
    expect(CAPABILITIES.some((c) => /skill/i.test(c.name))).toBe(false);
    expect([...JOB_CAPS].some((n) => /skill/i.test(n))).toBe(false);
  });

  it('says what the assistant is doing', () => {
    expect(toolSummary('search', { entity: 'skill:weekly-report' })).toBe('Reading your skill “weekly-report”');
    expect(toolSummary('search', { domain: 'skill' })).toBe('Listing your skills');
  });
});
