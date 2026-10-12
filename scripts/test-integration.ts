import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvironment } from "./load-env.mjs";

loadEnvironment();

async function main() {
  const { getDb, disconnectDatabase } = await import("../src/server/db/client");
  const { getEnv } = await import("../src/server/config/env");
  const base = getEnv().BETTER_AUTH_URL;
  const ids: string[] = [];
  const password = `Framework-${randomUUID()}`;
  const suffix = randomUUID();
  async function request(path: string, cookie = "", body?: object) {
    return fetch(new URL(path, base), {
      method: body ? "POST" : "GET",
      headers: {
        Origin: new URL(base).origin,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  }
  async function signup(label: string) {
    const email = `framework-${label}-${suffix}@example.com`;
    const response = await request("/api/auth/sign-up/email", "", {
      name: label,
      email,
      password,
      role: "ADMIN",
    });
    assert.equal(response.status, 200, "Registration should succeed");
    const data = await response.json();
    ids.push(data.user.id);
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.ok(cookie, "Registration should establish a session");
    assert.equal(
      (await getDb().user.findUniqueOrThrow({ where: { id: data.user.id } })).role,
      "USER",
      "Client input must not grant administrator access",
    );
    return { id: data.user.id as string, email, cookie };
  }

  try {
    assert.equal((await request("/api/health")).status, 200);
    assert.equal((await request("/api/me")).status, 401);
    assert.equal((await request("/dashboard")).status, 307);
    const first = await signup("first");
    const second = await signup("second");
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => request("/api/me", first.cookie)),
    );
    for (const response of responses)
      assert.equal(response.status, 200, "Concurrent workspace provisioning should succeed");
    const firstMe = await responses[0].json();
    const workspaceId = firstMe.workspaces[0].id;
    assert.equal(await getDb().workspace.count({ where: { ownerId: first.id } }), 1);
    assert.equal(await getDb().workspaceMember.count({ where: { userId: first.id } }), 1);
    assert.equal((await request(`/api/workspaces/${workspaceId}`, first.cookie)).status, 200);
    assert.equal((await request(`/api/workspaces/${workspaceId}`, second.cookie)).status, 404);
    assert.equal((await request(`/api/workspaces/${workspaceId}`)).status, 401);
    assert.equal((await request("/api/admin/status", first.cookie)).status, 403);
    await getDb().user.update({ where: { id: first.id }, data: { role: "ADMIN" } });
    assert.equal((await request("/api/admin/status", first.cookie)).status, 200);
    await getDb().user.update({ where: { id: first.id }, data: { role: "USER" } });
    assert.equal((await request("/api/admin/status", first.cookie)).status, 403);
    assert.equal(
      (
        await request("/api/auth/sign-in/email", "", {
          email: first.email,
          password: "incorrect-password",
        })
      ).status,
      401,
    );
    const login = await request("/api/auth/sign-in/email", "", { email: first.email, password });
    assert.equal(login.status, 200);
    const loginCookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.equal((await request("/api/me", loginCookie)).status, 200);
    assert.equal((await request("/api/auth/sign-out", loginCookie, {})).status, 200);
    assert.equal((await request("/api/me", loginCookie)).status, 401);
    console.log(
      "Integration passed: health, registration, sessions, role protection, workspace isolation, concurrent provisioning, login, and logout.",
    );
  } finally {
    await getDb().user.deleteMany({ where: { id: { in: ids } } });
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  if (error instanceof assert.AssertionError)
    console.error(`Integration assertion failed: ${error.message}`);
  else
    console.error(
      "Integration failed. Ensure the Web server is running at BETTER_AUTH_URL and migrations are applied.",
    );
  process.exitCode = 1;
});
