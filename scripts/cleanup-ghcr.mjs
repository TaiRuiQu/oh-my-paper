// Keep three published versions per package, including their OCI child manifests.
import { pathToFileURL } from "node:url";

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
  const plans = [];
  for (const suffix of ["", "-migrate", "-ai-worker"]) {
    const name = `${repository}${suffix}`.toLowerCase();
    const endpoint = `https://api.github.com/${scope}/${owner}/packages/container/${encodeURIComponent(name)}/versions`;
    const versions = [];
    for (let page = 1; ; page++) {
      const batch = await request(`${endpoint}?per_page=100&page=${page}`, headers);
      versions.push(...batch);
      if (batch.length < 100) break;
    }
    const retained = retainedVersions(versions);
    if (!retained.length) throw new Error(`${name}: no published tagged version found`);
    const image = `${owner.toLowerCase()}/${name}`;
    const auth = await request(
      `https://ghcr.io/token?service=ghcr.io&scope=repository:${image}:pull`,
      {
        Authorization: `Basic ${Buffer.from(`${process.env.GITHUB_ACTOR}:${token}`).toString("base64")}`,
      },
    );
    const digests = await retainedDigests(retained, (digest) =>
      request(`https://ghcr.io/v2/${image}/manifests/${digest}`, {
        Authorization: `Bearer ${auth.token ?? auth.access_token}`,
        Accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json",
      }),
    );
    plans.push({
      endpoint,
      name,
      retained,
      remove: versions.filter((version) => !digests.has(version.name)),
    });
  }
  for (const plan of plans) {
    console.log(
      `${plan.name}: retaining ${plan.retained.length} versions; deleting ${plan.remove.length} obsolete manifests`,
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
