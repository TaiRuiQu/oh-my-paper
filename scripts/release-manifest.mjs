export const releaseAnnotation = "io.oh-my-paper.release";
export const imageSuffixes = { web: "", migrate: "-migrate", "ai-worker": "-ai-worker" };
export const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function releaseImages(manifest, repository) {
  const annotations = manifest.annotations ?? {};
  if (
    annotations[`${releaseAnnotation}.version`] !== "1" ||
    !/^[a-f0-9]{40}$/.test(annotations["org.opencontainers.image.revision"] ?? "")
  ) {
    throw new Error("Missing or invalid complete release manifest");
  }
  return Object.fromEntries(
    Object.entries(imageSuffixes).map(([target, suffix]) => {
      const digest = annotations[`${releaseAnnotation}.${target}`];
      if (!digestPattern.test(digest ?? "")) throw new Error(`Invalid ${target} release digest`);
      return [target, `ghcr.io/${repository.toLowerCase()}${suffix}@${digest}`];
    }),
  );
}
