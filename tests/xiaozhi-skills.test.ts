import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
vi.mock("@/server/db/client", () => ({
  getDb: () => ({ xiaozhiSkill: { findMany: async () => [] } }),
}));
import { listSkills, readSkillResource } from "@/server/xiaozhi/skills";
describe("extensible 小纸 skills", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("discovers new SKILL.md packages and references without editing the agent, and confines resource reads", async () => {
    const builtinSkills = await listSkills("teacher");
    const root = await mkdtemp(join(tmpdir(), "xiaozhi-skills-"));
    try {
      const directory = join(root, "weekly-lesson");
      await mkdir(join(directory, "references"), { recursive: true });
      await writeFile(
        join(directory, "SKILL.md"),
        "---\nname: 每周备课\ndescription: 按学校习惯备课\n---\n\n按需查看 references/checklist.md。",
      );
      await writeFile(join(directory, "references/checklist.md"), "检查课时和知识点。");
      await writeFile(join(root, "private.txt"), "not a skill resource");
      await symlink(join(root, "private.txt"), join(directory, "escape.txt"));
      vi.stubEnv("XIAOZHI_SKILLS_DIR", root);
      const skills = await listSkills("teacher");
      expect(skills).toHaveLength(builtinSkills.length + 1);
      expect(skills.find((skill) => skill.id === "weekly-lesson")?.instructions).toContain(
        "references/checklist.md",
      );
      expect(
        await readSkillResource("teacher", "weekly-lesson", "references/checklist.md"),
      ).toEqual({ content: "检查课时和知识点。" });
      await expect(
        readSkillResource("teacher", "weekly-lesson", "../private.txt"),
      ).rejects.toThrow();
      await expect(readSkillResource("teacher", "weekly-lesson", "escape.txt")).rejects.toThrow();
      expect(JSON.stringify(skills)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discovers the API and textbook skills and can read every bundled reference through the agent tool boundary", async () => {
    const skills = await listSkills("teacher");
    for (const id of ["site-api", "textbooks"]) {
      const skill = skills.find((entry) => entry.id === id);
      expect(skill?.builtin).toBe(true);
      expect(skill?.instructions.length).toBeGreaterThan(0);
      const directory = resolve("skills/xiaozhi", id);
      const references = await readdir(join(directory, "references"), { recursive: true });
      const readable = references.filter((path) => /\.(md|txt|json|csv)$/i.test(path));
      expect(readable.length).toBeGreaterThan(0);
      for (const path of readable) {
        const resourcePath = relative(directory, join(directory, "references", path));
        const content = await readFile(join(directory, resourcePath), "utf8");
        expect(content.length, `${id}/${resourcePath}`).toBeLessThanOrEqual(40000);
        expect(await readSkillResource("teacher", id, resourcePath)).toEqual({ content });
      }
    }
  }, 30000);
});
