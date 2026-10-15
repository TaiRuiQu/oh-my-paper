// Publish one OCI index only after all three tested runtime images are available.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  digestPattern,
  imageSuffixes,
  releaseAnnotation,
  releaseImages,
} from "./release-manifest.mjs";

export function publishRelease({ repository, revision, runId, ref, refType }, docker) {
  const image = `ghcr.io/${repository.toLowerCase()}`;
  const annotations = {
    [`${releaseAnnotation}.version`]: "1",
    "org.opencontainers.image.revision": revision,
  };
  // Resolve every staging tag before writing any release tag. Each workflow run
  // has its own staging tag, including when a failed job is rerun.
  for (const [target, suffix] of Object.entries(imageSuffixes)) {
    const manifest = JSON.parse(
      docker([
        "buildx",
        "imagetools",
        "inspect",
        `${image}${suffix}:build-${runId}`,
        "--format",
        "{{json .Manifest}}",
      ]),
    );
    if (!digestPattern.test(manifest.digest ?? "")) throw new Error(`Invalid ${target} digest`);
    annotations[`${releaseAnnotation}.${target}`] = manifest.digest;
  }
  releaseImages({ annotations }, repository);
  const tags = [`${image}:sha-${revision}`];
  if (refType === "tag") tags.push(`${image}:${ref}`);
  if (refType === "branch" && ref === "v2") tags.push(`${image}:latest`);
  docker([
    "buildx",
    "imagetools",
    "create",
    ...Object.entries(annotations).flatMap(([key, value]) => [
      "--annotation",
      `index:${key}=${value}`,
    ]),
    ...tags.flatMap((tag) => ["--tag", tag]),
    `${image}@${annotations[`${releaseAnnotation}.web`]}`,
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishRelease(
    {
      repository: process.env.GITHUB_REPOSITORY,
      revision: process.env.GITHUB_SHA,
      runId: process.env.GITHUB_RUN_ID,
      ref: process.env.GITHUB_REF_NAME,
      refType: process.env.GITHUB_REF_TYPE,
    },
    (args) =>
      execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
  );
}
