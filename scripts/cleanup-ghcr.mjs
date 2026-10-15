// Keep three complete releases and every runtime/child manifest they reference.
import { pathToFileURL } from "node:url";
import { imageSuffixes, releaseImages } from "./release-manifest.mjs";

export function retainedVersions(versions, count = 3) {
  return versions
    .filter((version) => version.metadata.container.tags.length > 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, count);
}

export async function retainedDigests(versions, loadManifest) {
  const digests = new Set();
  async function protect(digest) {
    if (digests.has(digest)) return;
    digests.add(digest);
    const manifest = await loadManifest(digest);
    for (const child of manifest.manifests ?? []) await protect(child.digest);
  }
  for (const version of versions) await protect(version.name);
  return digests;
}

export function retainedReleases(versions, count = 3) {
  const releases = versions.filter((version) =>
    version.metadata.container.tags.some(
      (tag) => tag === "latest" || /^sha-[a-f0-9]{40}$/.test(tag),
    ),
  );
  const latest = releases.find((version) => version.metadata.container.tags.includes("latest"));
  return [
    ...(latest ? [latest] : []),
    ...retainedVersions(releases, count).filter((version) => version !== latest),
  ].slice(0, count);
}

export async function releaseDigests(releases, repository, loadManifest) {
  const roots = Object.fromEntries(Object.keys(imageSuffixes).map((target) => [target, []]));
  for (const release of releases) {
    const images = releaseImages(await loadManifest("web", release.name), repository);
    roots.web.push({ name: release.name });
    for (const [target, image] of Object.entries(images)) {
      roots[target].push({ name: image.split("@")[1] });
    }
  }
  const retained = {};
  for (const target of Object.keys(roots)) {
    retained[target] = await retainedDigests(roots[target], (digest) =>
      loadManifest(target, digest),
    );
  }
  return retained;
}

export function obsoleteVersions(versions, protectedDigests, now = Date.now()) {
  // Other refs may still be building. Give staging-only images a day to finish
  // before collecting them; they never count as completed rollback releases.
  const stagingCutoff = now - 24 * 60 * 60 * 1000;
  return versions.filter(
    (version) =>
      !protectedDigests.has(version.name) &&
      !(
        version.metadata.container.tags.some((tag) => tag.startsWith("build-")) &&
        Date.parse(version.created_at) >= stagingCutoff
      ),
  );
}

async function request(url, headers, method = "GET") {
  const response = await fetch(url, { headers, method });
  if (!response.ok) throw new Error(`${method} ${url}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function main() {
  const [owner, repository] = process.env.GITHUB_REPOSITORY.split("/");
  const token = process.env.GH_TOKEN;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const scope = process.env.OWNER_TYPE === "Organization" ? "orgs" : "users";
  // Prepare every deletion plan before deleting anything. API or manifest errors
  // abort cleanup, preserving existing images for diagnosis and rollback.
  const packages = {};
  for (const [target, suffix] of Object.entries(imageSuffixes)) {
    const name = `${repository}${suffix}`.toLowerCase();
    const endpoint = `https://api.github.com/${scope}/${owner}/packages/container/${encodeURIComponent(name)}/versions`;
    const versions = [];
    for (let page = 1; ; page++) {
      const batch = await request(`${endpoint}?per_page=100&page=${page}`, headers);
      versions.push(...batch);
      if (batch.length < 100) break;
    }
    const image = `${owner.toLowerCase()}/${name}`;
    const auth = await request(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:${image}:pull`,
      {
        Authorization: `Basic ${Buffer.from(`${process.env.GITHUB_ACTOR}:${token}`).toString("base64")}`,
      },
    );
    const manifests = new Map();
    packages[target] = {
      endpoint,
      name,
      versions,
      loadManifest(digest) {
        if (!manifests.has(digest))
          manifests.set(
            digest,
            request(`https://ghcr.io/v2/${image}/manifests/${digest}`, {
              Authorization: `Bearer ${auth.token ?? auth.access_token}`,
              Accept:
                "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json",
            }),
          );
        return manifests.get(digest);
      },
    };
  }
  const releases = retainedReleases(packages.web.versions);
  if (!releases.length) throw new Error("No complete published release found");
  const digests = await releaseDigests(releases, `${owner}/${repository}`, (target, digest) =>
    packages[target].loadManifest(digest),
  );
  const plans = [];
  for (const [target, data] of Object.entries(packages)) {
    // Protect children of recently staged indexes as well as the indexes.
    const recent = data.versions.filter(
      (version) => !obsoleteVersions([version], digests[target]).length,
    );
    const protectedDigests = await retainedDigests(recent, data.loadManifest);
    plans.push({ ...data, remove: obsoleteVersions(data.versions, protectedDigests) });
  }
  for (const plan of plans) {
    console.log(
      `${plan.name}: retaining ${releases.length} complete releases and recent staging images; deleting ${plan.remove.length} obsolete manifests`,
    );
    for (const version of plan.remove) {
      await request(`${plan.endpoint}/${version.id}`, headers, "DELETE");
      console.log(`Deleted ${plan.name} version ${version.id}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
