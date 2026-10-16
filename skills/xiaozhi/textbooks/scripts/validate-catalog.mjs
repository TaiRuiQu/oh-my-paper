import assert from "node:assert/strict";
import { readFile, readdir, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const actualRoot = await realpath(root);
async function readResource(relative) {
  const target = await realpath(resolve(root, relative));
  assert.ok(target.startsWith(actualRoot + sep), `Outside skill: ${relative}`);
  const content = await readFile(target, "utf8");
  assert.ok(content.length <= 40000, `Resource too large: ${relative}`);
  return content;
}
async function json(relative) {
  return JSON.parse(await readResource(relative));
}
const skill = await readFile(resolve(root, "SKILL.md"), "utf8");
assert.ok(skill.length <= 40000);
assert.match(skill, /^---\nname: textbooks\ndescription: .+\n---\n/);
const manifest = await json("references/catalog.json");
assert.equal(manifest.schema_version, 1);
assert.ok(Array.isArray(manifest.unverified) && manifest.unverified.length > 0);
assert.ok(manifest.unverified.every((x) => x.status && x.scope && x.action));
const seen = new Set();
const keys = new Set();
const resources = new Map();
let unitCount = 0;
let headingCount = 0;
let topicsCount = 0;
let mainCount = 0;
function normalizedTopics(node) {
  const title = node.title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:第?[一二三四五六七八九十百零〇\d]+(?:章|节|课|单元|讲)[\s、.．]*)/, "")
    .trim();
  return [title, ...(node.children ?? []).flatMap(normalizedTopics)];
}
function validateNode(node) {
  assert.ok(typeof node.title === "string" && node.title.trim());
  headingCount += 1;
  for (const child of node.children ?? []) validateNode(child);
}
for (const group of manifest.subject_catalogs) {
  const index = await json(group.catalog);
  assert.equal(index.stage, group.stage);
  assert.equal(index.subject, group.subject);
  assert.equal(index.books.length, group.books);
  for (const entry of index.books) {
    assert.ok(!seen.has(entry.id), `Duplicate book ID: ${entry.id}`);
    seen.add(entry.id);
    const key = JSON.stringify([
      index.stage,
      index.subject,
      entry.version,
      entry.revision_label,
      entry.grade,
      entry.volume,
    ]);
    assert.ok(!keys.has(key), `Duplicate version/volume: ${entry.title}`);
    keys.add(key);
    if (!resources.has(entry.resource)) resources.set(entry.resource, await json(entry.resource));
    const book = resources.get(entry.resource).books.find((x) => x.id === entry.id);
    assert.ok(book, `Missing book: ${entry.id}`);
    for (const field of ["title", "version", "revision_label", "grade", "volume", "coverage"])
      assert.equal(book[field], entry[field]);
    assert.equal(book.stage, index.stage);
    assert.equal(book.subject, index.subject);
    assert.equal(book.coverage, "official_tree_complete");
    assert.equal(book.source_kind, "official_course_tree");
    assert.equal(book.retrieved_at, manifest.retrieved_at);
    assert.match(
      book.source,
      new RegExp(
        `^https://s-file-1\\.ykt\\.cbern\\.com\\.cn/zxx/ndrv2/national_lesson/trees/${book.id}\\.json$`,
      ),
    );
    assert.ok(book.edition_status && book.units.length > 0);
    assert.equal(book.units.length, entry.unit_count);
    for (const unit of book.units) {
      validateNode(unit);
      assert.equal(unit.topics_kind, "editorial_from_official_headings");
      assert.ok(
        unit.topics.length > 0 && unit.topics.every((x) => typeof x === "string" && x.trim()),
      );
      assert.deepEqual(
        unit.topics,
        [...new Set(normalizedTopics(unit).filter(Boolean))],
        `Topics must retain all heading concepts without numeral loss: ${book.title} / ${unit.title}`,
      );
      topicsCount += unit.topics.length;
      unitCount += 1;
    }
    if (["小学", "初中", "高中"].includes(book.stage)) mainCount += 1;
  }
}
assert.equal(seen.size, manifest.coverage.official_course_tree_books);
assert.equal(mainCount, manifest.coverage.mainstream_63_and_senior_books);
assert.equal(seen.size - mainCount, manifest.coverage["54_books"]);
for (const [resource, data] of resources)
  assert.ok(
    data.books.every((x) => seen.has(x.id)),
    `Unindexed book in ${resource}`,
  );
async function validateFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await validateFiles(path);
    else if (/\.(json|md)$/.test(entry.name)) {
      const text = await readFile(path, "utf8");
      assert.ok(text.length <= 40000, `Resource too large: ${path}`);
      if (entry.name.endsWith(".json")) JSON.parse(text);
      if (entry.name.endsWith(".md")) {
        for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
          if (!/^(https?:|#)/.test(match[1])) await realpath(resolve(dirname(path), match[1]));
        }
      }
    }
  }
}
await validateFiles(root);
console.log(
  `Textbook catalog valid: ${seen.size} books (${mainCount} mainstream, ${seen.size - mainCount} five-four), ${unitCount} units, ${headingCount} headings, ${topicsCount} topic links.`,
);
