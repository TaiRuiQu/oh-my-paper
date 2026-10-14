import assert from "node:assert/strict";
import { test } from "node:test";
import { retainedDigests, retainedVersions } from "./cleanup-ghcr.mjs";

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
