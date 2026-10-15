import "server-only";
import { readFile, readdir, realpath } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { parse } from "yaml";
import type { XiaozhiSkill } from "@/contracts/xiaozhi";
import { getDb } from "@/server/db/client";
import { RequestError } from "@/server/http/errors";

type LoadedSkill = XiaozhiSkill & { directory?: string };
export async function loadSkillCatalog(userId: string): Promise<LoadedSkill[]> {
  const roots = [
    resolve("skills/xiaozhi"),
    ...(process.env.XIAOZHI_SKILLS_DIR ? [resolve(process.env.XIAOZHI_SKILLS_DIR)] : []),
  ];
  const skills = new Map<string, LoadedSkill>();
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.name)) continue;
      const directory = await realpath(join(root, entry.name));
      if (!directory.startsWith((await realpath(root)) + sep)) continue;
      const markdown = await readFile(join(directory, "SKILL.md"), "utf8");
      if (markdown.length > 40000) throw new Error(`Skill ${entry.name} exceeds 40000 characters`);
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
      if (!match) throw new Error(`Skill ${entry.name} needs YAML frontmatter`);
      const meta = parse(match[1]);
      if (!meta || typeof meta.name !== "string" || typeof meta.description !== "string")
        throw new Error(`Invalid skill ${entry.name}`);
      skills.set(entry.name, {
        id: entry.name,
        name: meta.name,
        description: meta.description,
        instructions: match[2].trim(),
        builtin: true,
        directory,
      });
    }
  }
  const custom = await getDb().xiaozhiSkill.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  for (const { id, name, description, instructions } of custom)
    skills.set(id, { id, name, description, instructions, builtin: false });
  return [...skills.values()];
}
export async function listSkills(userId: string): Promise<XiaozhiSkill[]> {
  return (await loadSkillCatalog(userId)).map(
    ({ id, name, description, instructions, builtin }) => ({
      id,
      name,
      description,
      instructions,
      builtin,
    }),
  );
}
export async function readSkillResource(userId: string, id: string, path: string) {
  const skill = (await loadSkillCatalog(userId)).find((skill) => skill.id === id);
  if (!skill?.directory) throw new RequestError(400, "此技能没有文件资源目录。");
  const target = await realpath(resolve(skill.directory, path));
  if (!target.startsWith(skill.directory + sep) || !/\.(md|txt|json|csv)$/i.test(target))
    throw new RequestError(400, "只能读取当前技能目录中的文本资源。");
  const content = await readFile(target, "utf8");
  if (content.length > 40000) throw new RequestError(413, "技能资源过大，请拆分成多个文件。");
  return { content };
}
