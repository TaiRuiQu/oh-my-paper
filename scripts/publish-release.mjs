// Publish one OCI index only after all three tested runtime images are available.
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { imageSuffixes, releaseAnnotation, releaseImages } from "./release-manifest.mjs";

export async function publishRelease({ repository, revision, runId, ref, refType }, registry) {
  const image = repository.toLowerCase();
  const annotations = {
    [`${releaseAnnotation}.version`]: "1",
    "org.opencontainers.image.revision": revision,
  };
  let web;
  // Resolve every staging tag before writing any release tag.
  for (const [target, suffix] of Object.entries(imageSuffixes)) {
    const descriptor = await registry(`${image}${suffix}`, `build-${runId}`);
    annotations[`${releaseAnnotation}.${target}`] = descriptor.digest;
    if (target === "web") web = descriptor;
  }
  releaseImages({ annotations }, repository);
  // Docker-loaded images use Docker media types. Buildx preserves that format
  // and silently drops index annotations, so write an explicit OCI index.
  const index = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{ ...web, platform: { architecture: "amd64", os: "linux" } }],
    annotations,
  };
  const tags = [`sha-${revision}`];
  if (refType === "tag") tags.push(ref);
  if (refType === "branch" && ref === "v2") tags.push("latest");
  for (const tag of tags) await registry(image, tag, index);
}

export function createRegistry({ actor, token }, request = fetch) {
  const tokens = new Map();
  return async (repository, reference, manifest) => {
    if (!tokens.has(repository)) {
      const response = await request(
        `https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull,push`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${actor}:${token}`).toString("base64")}`,
          },
        },
      );
      if (!response.ok) throw new Error(`Registry authentication: HTTP ${response.status}`);
      const credentials = await response.json();
      const bearer = credentials.token ?? credentials.access_token;
      if (!bearer) throw new Error("Missing registry token");
      tokens.set(repository, bearer);
    }
    const headers = {
      Authorization: `Bearer ${tokens.get(repository)}`,
      Accept:
        "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json",
    };
    if (manifest) headers["Content-Type"] = manifest.mediaType;
    const response = await request(`https://ghcr.io/v2/${repository}/manifests/${reference}`, {
      method: manifest ? "PUT" : "GET",
      headers,
      ...(manifest ? { body: JSON.stringify(manifest) } : {}),
    });
    if (!response.ok)
      throw new Error(`Registry ${repository}:${reference}: HTTP ${response.status}`);
    if (manifest) return;
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      mediaType: JSON.parse(bytes.toString()).mediaType,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      size: bytes.length,
    };
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await publishRelease(
    {
      repository: process.env.GITHUB_REPOSITORY,
      revision: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      ref: process.env.GITHUB_REF_NAME,
      refType: process.env.GITHUB_REF_TYPE,
    },
    createRegistry({ actor: process.env.GITHUB_ACTOR, token: process.env.GH_TOKEN }),
  );
}
