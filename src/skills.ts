// 极简 skills 支持: 仅扫描 <cwd>/.agents/skills
// 规则: 目录含 SKILL.md 即 skill 根(不再递归);否则递归子目录
// SKILL.md 头部 `---` 包裹的 frontmatter 取 name / description(单行)
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export interface Skill {
  name: string;
  description: string;
  filePath: string;
}

export function loadSkills(dir: string): Skill[] {
  return loadSkillsInternal(dir, true);
}

function loadSkillsInternal(dir: string, isRoot: boolean): Skill[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });

  // 本目录是 skill 根
  if (entries.some((e) => e.name === "SKILL.md")) {
    const skill = loadSkillFile(join(dir, "SKILL.md"));
    return skill ? [skill] : [];
  }

  const skills: Skill[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      skills.push(...loadSkillsInternal(full, false));
    } else if (isRoot && entry.name.endsWith(".md")) {
      // 仅根目录下的散 .md 算 skill;子目录只认 SKILL.md
      const skill = loadSkillFile(full);
      if (skill) skills.push(skill);
    }
  }
  return skills;
}

function loadSkillFile(filePath: string): Skill | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const { name, description } = parseFrontmatter(raw);
  if (!description) return null; // description 必填
  return { name: name ?? basename(filePath), description, filePath };
}

function parseFrontmatter(raw: string): { name?: string; description?: string } {
  if (!raw.startsWith("---")) return {};
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return {};
  const fm = raw.slice(3, end);
  const out: { name?: string; description?: string } = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    if (m[1] === "name") out.name = m[2].trim();
    if (m[1] === "description") out.description = m[2].trim();
  }
  return out;
}

// 参照 Agent Skills 规范: XML 块注入 system prompt
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the bash tool to read a skill's file (cat <location>) when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md) and use that absolute path in bash commands.",
    "",
    "<available_skills>",
  ];
  for (const s of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(s.name)}</name>`);
    lines.push(`    <description>${escapeXml(s.description)}</description>`);
    lines.push(`    <location>${escapeXml(s.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
