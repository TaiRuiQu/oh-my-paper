import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createRegistry, publishRelease } from "./publish-release.mjs";
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

test("one explicit OCI index pins all three Docker image digests after staging resolves", async () => {
  const calls = [];
  await publishRelease(context, async (image, tag, index) => {
    calls.push({ image, tag, index });
    return {
      digest: digests[calls.length - 1],
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      size: 123,
    };
  });
  assert.equal(calls.length, 5);
  assert.deepEqual(
    calls.slice(0, 3).map(({ image, tag }) => `${image}:${tag}`),
    [
      "tairuiqu/oh-my-paper:build-123",
      "tairuiqu/oh-my-paper-migrate:build-123",
      "tairuiqu/oh-my-paper-ai-worker:build-123",
    ],
  );
  const index = calls[3].index;
  assert.equal(index.mediaType, "application/vnd.oci.image.index.v1+json");
  assert.deepEqual(index.manifests, [
    {
      digest: digests[0],
      mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      size: 123,
      platform: { architecture: "amd64", os: "linux" },
    },
  ]);
  assert.deepEqual(releaseImages(index, context.repository), {
    web: `ghcr.io/tairuiqu/oh-my-paper@${digests[0]}`,
    migrate: `ghcr.io/tairuiqu/oh-my-paper-migrate@${digests[1]}`,
    "ai-worker": `ghcr.io/tairuiqu/oh-my-paper-ai-worker@${digests[2]}`,
  });
  assert.deepEqual(
    calls.slice(3).map(({ tag }) => tag),
    [`sha-${revision}`, "latest"],
  );
  assert.deepEqual(calls[4].index, index);
});

test("a missing or invalid image prevents every release tag from advancing", async () => {
  for (const failure of ["missing", "invalid"]) {
    let calls = 0;
    await assert.rejects(
      publishRelease(context, async (_image, _tag, index) => {
        assert.equal(index, undefined);
        calls++;
        if (calls === 3) {
          if (failure === "missing") throw new Error("manifest unknown");
          return { digest: "latest" };
        }
        return { digest: digests[calls - 1] };
      }),
    );
    assert.equal(calls, 3);
  }
});

test("a named release never moves the v2 latest entry point", async () => {
  const tags = [];
  await publishRelease(
    { ...context, ref: "v2.0.2", refType: "tag" },
    async (_image, tag, index) => {
      if (index) tags.push(tag);
      return { digest: digests[0] };
    },
  );
  assert.deepEqual(tags, [`sha-${revision}`, "v2.0.2"]);
});

test("registry preserves the exact OCI bytes and annotations when publishing Docker images", async () => {
  const raw = JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: {},
    layers: [],
  });
  const digest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  const writes = [];
  let authentications = 0;
  const registry = createRegistry({ actor: "actor", token: "test-token" }, async (url, options) => {
    if (url.startsWith("https://ghcr.io/token?")) {
      authentications++;
      assert.match(url, /:pull,push$/);
      return Response.json({ token: "registry-token" });
    }
    assert.equal(options.headers.Authorization, "Bearer registry-token");
    if (options.method === "PUT") {
      assert.equal(options.headers["Content-Type"], "application/vnd.oci.image.index.v1+json");
      writes.push(JSON.parse(options.body));
      return new Response(null, { status: 201 });
    }
    return new Response(raw);
  });
  await publishRelease(context, registry);
  assert.equal(authentications, 3);
  assert.equal(writes.length, 2);
  for (const index of writes) {
    assert.equal(index.manifests[0].digest, digest);
    assert.equal(index.manifests[0].size, Buffer.byteLength(raw));
    assert.equal(index.annotations[`${releaseAnnotation}.version`], "1");
    assert.equal(index.annotations[`${releaseAnnotation}.web`], digest);
    assert.equal(Object.keys(releaseImages(index, context.repository)).length, 3);
  }
});

test("registry failures abort publication", async () => {
  const registry = createRegistry(
    { actor: "actor", token: "test" },
    async () => new Response(null, { status: 503 }),
  );
  await assert.rejects(publishRelease(context, registry), /authentication: HTTP 503/);
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
