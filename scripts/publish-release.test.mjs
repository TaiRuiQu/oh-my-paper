import assert from "node:assert/strict";
import { test } from "node:test";
import { publishRelease } from "./publish-release.mjs";
import { releaseAnnotation, releaseImages } from "./release-manifest.mjs";

const revision = "a".repeat(40);
const digests = ["1", "2", "3"].map((value) => `sha256:${value.repeat(64)}`);
const context = {
  repository: "TaiRuiQu/oh-my-paper",
  revision,
  runId: "123",
  ref: "v2",
  refType: "branch",
};

test("one release index pins all three digests after all staging images resolve", () => {
  const calls = [];
  publishRelease(context, (args) => {
    calls.push(args);
    return JSON.stringify({ digest: digests[calls.length - 1] });
  });
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.slice(0, 3).map((args) => args[3]),
    [
      "ghcr.io/tairuiqu/oh-my-paper:build-123",
      "ghcr.io/tairuiqu/oh-my-paper-migrate:build-123",
      "ghcr.io/tairuiqu/oh-my-paper-ai-worker:build-123",
    ],
  );
  const create = calls[3];
  assert.deepEqual(create.slice(0, 3), ["buildx", "imagetools", "create"]);
  const annotations = Object.fromEntries(
    create.flatMap((value, index) =>
      create[index - 1] === "--annotation" ? [value.slice("index:".length).split("=")] : [],
    ),
  );
  assert.deepEqual(releaseImages({ annotations }, context.repository), {
    web: `ghcr.io/tairuiqu/oh-my-paper@${digests[0]}`,
    migrate: `ghcr.io/tairuiqu/oh-my-paper-migrate@${digests[1]}`,
    "ai-worker": `ghcr.io/tairuiqu/oh-my-paper-ai-worker@${digests[2]}`,
  });
  assert.equal(annotations["org.opencontainers.image.revision"], revision);
  assert.ok(create.includes(`ghcr.io/tairuiqu/oh-my-paper:sha-${revision}`));
  assert.ok(create.includes("ghcr.io/tairuiqu/oh-my-paper:latest"));
  assert.equal(create.at(-1), `ghcr.io/tairuiqu/oh-my-paper@${digests[0]}`);
});

test("a missing or invalid image prevents every release tag from advancing", () => {
  for (const failure of ["missing", "invalid"]) {
    const calls = [];
    assert.throws(() =>
      publishRelease(context, (args) => {
        calls.push(args);
        assert.equal(args[2], "inspect");
        if (calls.length === 3) {
          if (failure === "missing") throw new Error("manifest unknown");
          return JSON.stringify({ digest: "latest" });
        }
        return JSON.stringify({ digest: digests[calls.length - 1] });
      }),
    );
    assert.equal(calls.length, 3);
  }
});

test("a named release never moves the v2 latest entry point", () => {
  let create;
  publishRelease({ ...context, ref: "v2.0.2", refType: "tag" }, (args) => {
    if (args[2] === "create") create = args;
    return JSON.stringify({ digest: digests[0] });
  });
  assert.ok(create.includes("ghcr.io/tairuiqu/oh-my-paper:v2.0.2"));
  assert.ok(!create.includes("ghcr.io/tairuiqu/oh-my-paper:latest"));
});

test("a complete release rejects missing companions and invalid revisions", () => {
  const annotations = {
    [`${releaseAnnotation}.version`]: "1",
    "org.opencontainers.image.revision": revision,
    [`${releaseAnnotation}.web`]: digests[0],
    [`${releaseAnnotation}.migrate`]: digests[1],
  };
  assert.throws(() => releaseImages({ annotations }, context.repository), /ai-worker/);
  annotations[`${releaseAnnotation}.ai-worker`] = digests[2];
  annotations["org.opencontainers.image.revision"] = "short";
  assert.throws(() => releaseImages({ annotations }, context.repository), /complete release/);
});
