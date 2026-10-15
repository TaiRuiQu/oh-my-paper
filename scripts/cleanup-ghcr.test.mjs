import assert from "node:assert/strict";
import { test } from "node:test";
import {
  obsoleteVersions,
  releaseDigests,
  retainedDigests,
  retainedReleases,
  retainedVersions,
} from "./cleanup-ghcr.mjs";
import { releaseAnnotation } from "./release-manifest.mjs";

test("retention counts tagged versions, not tags or newer untagged child manifests", () => {
  const versions = [1, 2, 3, 4, 5].map((id) => ({
    id,
    name: `sha256:${id}`,
    created_at: `2026-10-14T00:00:0${id}Z`,
    metadata: { container: { tags: id === 5 ? [] : ["sha-example", "v2"] } },
  }));
  assert.deepEqual(
    retainedVersions(versions).map((version) => version.id),
    [4, 3, 2],
  );
});

test("retained OCI indexes protect shared child manifests and attestations recursively", async () => {
  const manifests = {
    root: { manifests: [{ digest: "platform" }, { digest: "attestation" }] },
    platform: { manifests: [{ digest: "nested" }] },
    attestation: {},
    nested: {},
  };
  const digests = await retainedDigests(
    [{ name: "root" }, { name: "platform" }],
    async (digest) => manifests[digest],
  );
  assert.deepEqual([...digests].sort(), ["attestation", "nested", "platform", "root"]);
});

test("manifest lookup failure aborts the deletion plan", async () => {
  await assert.rejects(
    retainedDigests([{ name: "missing" }], async () => {
      throw new Error("HTTP 503");
    }),
    /HTTP 503/,
  );
});

test("retention selects complete releases and protects latest even when newer tags exist", () => {
  const versions = [1, 2, 3, 4, 5].map((id) => ({
    id,
    name: `release-${id}`,
    created_at: `2026-10-14T00:00:0${id}Z`,
    metadata: {
      container: { tags: [`sha-${String(id).repeat(40)}`, ...(id === 1 ? ["latest"] : [])] },
    },
  }));
  versions[4].metadata.container.tags = ["build-999"];
  // A rerun or a named release of the same commit can move its SHA alias while
  // the v2 deployment entry point still points to the older complete index.
  versions[0].metadata.container.tags = ["latest"];
  assert.deepEqual(
    retainedReleases(versions).map((version) => version.id),
    [1, 4, 3],
  );
});

test("release retention follows companion digests across packages and protects OCI children", async () => {
  const digest = (value) => `sha256:${value.repeat(64)}`;
  const annotations = {
    [`${releaseAnnotation}.version`]: "1",
    "org.opencontainers.image.revision": "a".repeat(40),
    [`${releaseAnnotation}.web`]: digest("1"),
    [`${releaseAnnotation}.migrate`]: digest("2"),
    [`${releaseAnnotation}.ai-worker`]: digest("3"),
  };
  const retained = await releaseDigests(
    [{ name: "release" }],
    "TaiRuiQu/oh-my-paper",
    async (target, name) => {
      if (target === "web" && name === "release")
        return { annotations, manifests: [{ digest: digest("1") }] };
      if (target === "ai-worker" && name === digest("3"))
        return { manifests: [{ digest: "worker-child" }] };
      return {};
    },
  );
  assert.deepEqual([...retained.web].sort(), ["release", digest("1")].sort());
  assert.deepEqual([...retained.migrate], [digest("2")]);
  assert.deepEqual([...retained["ai-worker"]].sort(), [digest("3"), "worker-child"].sort());
});

test("cleanup gives in-progress staging images time to finish without retaining incomplete releases", () => {
  const versions = [
    {
      name: "active",
      created_at: "2026-10-15T00:00:00Z",
      metadata: { container: { tags: ["build-2"] } },
    },
    {
      name: "abandoned",
      created_at: "2026-10-10T00:00:00Z",
      metadata: { container: { tags: ["build-1"] } },
    },
    {
      name: "referenced",
      created_at: "2026-10-01T00:00:00Z",
      metadata: { container: { tags: [] } },
    },
    {
      name: "obsolete-release",
      created_at: "2026-10-15T00:00:00Z",
      metadata: { container: { tags: ["v2.0.0"] } },
    },
  ];
  assert.deepEqual(
    obsoleteVersions(versions, new Set(["referenced"]), Date.parse("2026-10-15T01:00:00Z")).map(
      (version) => version.name,
    ),
    ["abandoned", "obsolete-release"],
  );
});
