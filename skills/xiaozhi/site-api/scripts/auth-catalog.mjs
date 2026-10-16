/** Read installed Better Auth endpoint definitions without initializing auth, DB,
 * sessions, or HTTP. Keep enabled plugins/options in sync with server/auth/index.ts. */
import { getEndpoints } from "better-auth/api";
import { username } from "better-auth/plugins";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { format, resolveConfig } from "prettier";
const root = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const referenceRoot = resolve(root, "skills/xiaozhi/site-api/references");
const { api } = getEndpoints(Promise.resolve({}), {
  plugins: [
    username({
      displayUsername: false,
      minUsernameLength: 1,
      maxUsernameLength: 254,
      immutableUsername: true,
      usernameValidator: (value) => /^[a-zA-Z0-9_.@+\-]+$/.test(value),
    }),
  ],
});
const inputSchema = (schema) =>
  schema ? z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) : null;
const entries = Object.entries(api)
  .filter(([, endpoint]) => endpoint.path && !endpoint.options.metadata?.SERVER_ONLY)
  .map(([operation, endpoint]) => ({
    operation,
    path: `/api/auth${endpoint.path}`,
    methods: Array.isArray(endpoint.options.method)
      ? endpoint.options.method
      : [endpoint.options.method],
    requireHeaders: endpoint.options.requireHeaders ?? false,
    body: inputSchema(endpoint.options.body),
    query: inputSchema(endpoint.options.query),
    description: endpoint.options.metadata?.openapi?.description ?? null,
    responses: endpoint.options.metadata?.openapi?.responses ?? null,
  }))
  .sort((a, b) => a.path.localeCompare(b.path));
const targets = new Map();
for (let i = 0; i < entries.length; i += 8) {
  const name = `auth-schemas-${Math.floor(i / 8) + 1}.json`;
  const content = await format(
    JSON.stringify(
      {
        note: "Registered library routes; app configuration may disable operations. See frontend.md for availability and auth.md for index.",
        endpoints: entries.slice(i, i + 8),
      },
      null,
      2,
    ),
    {
      ...(await resolveConfig(resolve(referenceRoot, name))),
      filepath: resolve(referenceRoot, name),
    },
  );
  if (content.length > 40000) throw Error(`${name} exceeds resource limit`);
  targets.set(name, content);
}
let failed = false;
for (const [name, content] of targets) {
  if (process.argv.includes("--write")) await writeFile(resolve(referenceRoot, name), content);
  else if (
    !isDeepStrictEqual(
      await readFile(resolve(referenceRoot, name), "utf8")
        .then((text) => JSON.parse(text))
        .catch(() => null),
      JSON.parse(content),
    )
  ) {
    console.error(
      `Stale registered auth schema: ${name}; review auth reference and run auth-catalog.mjs --write`,
    );
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    `Auth catalog verified: ${entries.length} delegated paths, ${entries.reduce((n, e) => n + e.methods.length, 0)} method bindings, ${targets.size} resources.`,
  );
