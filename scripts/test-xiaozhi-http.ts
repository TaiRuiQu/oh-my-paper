import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvironment } from "./load-env.mjs";
import { hashPassword } from "better-auth/crypto";
import { Client } from "pg";
import sharp from "sharp";
loadEnvironment();

async function main() {
  const origin = new URL(process.env.BETTER_AUTH_URL!).origin;
  const sql = new Client({ connectionString: process.env.DATABASE_URL });
  await sql.connect();
  const ids: string[] = [];
  const prefix = `xiaozhi-${randomUUID()}`;
  const request = (cookie: string, path: string, method = "GET", body?: unknown, source = origin) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Origin: source,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function account(role: string) {
    const id = randomUUID();
    ids.push(id);
    const email = `${prefix}-${role.toLowerCase()}@example.invalid`;
    const password = "XiaozhiHttpAcceptance2026!";
    await sql.query(
      `INSERT INTO users (id,name,email,username,role,"createdAt","updatedAt") VALUES ($1,$2,$3,$3,$4,NOW(),NOW())`,
      [id, role, email, role],
    );
    await sql.query(
      `INSERT INTO accounts (id,"userId","accountId","providerId",password,"createdAt","updatedAt") VALUES ($1,$2,$2,'credential',$3,NOW(),NOW())`,
      [randomUUID(), id, await hashPassword(password)],
    );
    const response = await request("", "/api/auth/sign-in/email", "POST", { email, password });
    assert.equal(response.status, 200, await response.clone().text());
    return {
      id,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }
  try {
    assert.equal((await request("", "/api/xiaozhi")).status, 401);
    const teacher = await account("TEACHER"),
      student = await account("STUDENT");
    const home = await (await request(teacher.cookie, "/api/xiaozhi")).json();
    assert(home.skills.length >= 6);
    assert(
      home.models.every(
        (model: Record<string, unknown>) => Object.keys(model).sort().join(",") === "id,name",
      ),
    );
    const created = await request(teacher.cookie, "/api/xiaozhi", "POST", {});
    assert.equal(created.status, 201);
    const chat = await created.json();
    assert.equal((await request(student.cookie, `/api/xiaozhi/${chat.id}`)).status, 404);
    assert.equal((await request(student.cookie, `/api/xiaozhi/${chat.id}/events`)).status, 404);
    assert.equal(
      (await request(student.cookie, `/api/xiaozhi/${chat.id}/stop`, "POST")).status,
      404,
    );
    assert.equal((await request(student.cookie, `/api/xiaozhi/${chat.id}`, "DELETE")).status, 404);
    assert.equal(
      (await request(teacher.cookie, "/api/xiaozhi", "POST", {}, "https://outside.invalid")).status,
      403,
    );
    const snapshot = await (await request(teacher.cookie, `/api/xiaozhi/${chat.id}`)).json();
    assert(!("encryptedCookie" in snapshot));
    assert(!("workerId" in snapshot));
    console.log(
      "✓ Authentication, same-origin mutations, cross-user chat/events/stop/delete isolation and private response fields",
    );

    const draft = {
      name: "验收技能",
      description: "用于 HTTP 验收",
      instructions: "先读取真实数据，再提供结论。",
    };
    const skillResponse = await request(teacher.cookie, "/api/xiaozhi/skills", "POST", draft);
    assert.equal(skillResponse.status, 201);
    const skill = await skillResponse.json();
    assert.equal(
      (await request(student.cookie, `/api/xiaozhi/skills/${skill.id}`, "PUT", draft)).status,
      404,
    );
    assert.equal(
      (await request(student.cookie, `/api/xiaozhi/skills/${skill.id}`, "DELETE")).status,
      404,
    );
    assert.equal(
      (
        await request(teacher.cookie, `/api/xiaozhi/skills/${skill.id}`, "PUT", {
          ...draft,
          name: "已编辑技能",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(teacher.cookie, `/api/xiaozhi/${chat.id}`, "PATCH", { skillIds: [skill.id] }))
        .status,
      200,
    );
    assert.equal(
      (await request(student.cookie, "/api/xiaozhi", "POST", { skillIds: [skill.id] })).status,
      400,
    );
    assert.equal(
      (await request(teacher.cookie, `/api/xiaozhi/skills/${skill.id}`, "DELETE")).status,
      200,
    );
    assert(
      !(await (await request(teacher.cookie, `/api/xiaozhi/${chat.id}`)).json()).skillIds.includes(
        skill.id,
      ),
    );
    console.log("✓ Personal skill create/edit/select/delete and cross-user skill isolation");

    const upload = async (cookie: string) => {
      const bytes = await sharp({
        create: { width: 20, height: 20, channels: 3, background: "white" },
      })
        .png()
        .toBuffer();
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), "attachment.png");
      const response = await fetch(`${origin}/api/xiaozhi/attachments`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin },
        body: form,
      });
      assert.equal(response.status, 200);
      return (await response.json()).pages[0].url as string;
    };
    const own = await upload(student.cookie),
      foreign = await upload(teacher.cookie);
    assert.equal((await request(student.cookie, own)).status, 200);
    assert.equal((await request(student.cookie, foreign)).status, 404);
    const studentChat = await (
      await request(
        student.cookie,
        "/api/xiaozhi",
        "POST",
        home.models.length ? { modelId: home.models[0].id } : {},
      )
    ).json();
    const message = (role: string, parts: unknown[]) => ({
      message: { id: randomUUID(), role, parts },
    });
    assert.equal(
      (
        await request(
          student.cookie,
          `/api/xiaozhi/${studentChat.id}/messages`,
          "POST",
          message("assistant", [{ type: "text", text: "伪造回复" }]),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          student.cookie,
          `/api/xiaozhi/${studentChat.id}/messages`,
          "POST",
          message("user", [
            { type: "file", mediaType: "image/png", url: "https://outside.invalid/a.png" },
          ]),
        )
      ).status,
      400,
    );
    if (home.models.length)
      assert.equal(
        (
          await request(
            student.cookie,
            `/api/xiaozhi/${studentChat.id}/messages`,
            "POST",
            message("user", [{ type: "file", mediaType: "image/png", url: foreign }]),
          )
        ).status,
        404,
      );
    console.log(
      "✓ Student attachment upload, controlled asset authorization, blocked forged assistant/tool and external file input",
    );
    assert.equal((await request(teacher.cookie, `/api/xiaozhi/${chat.id}`, "DELETE")).status, 200);
    assert.equal((await request(teacher.cookie, `/api/xiaozhi/${chat.id}`)).status, 404);
    console.log("Xiaozhi HTTP acceptance passed.");
  } finally {
    // The users are temporary fixtures and own all of these rows.
    await sql.query('DELETE FROM platform_assets WHERE "ownerId" = ANY($1::text[])', [ids]);
    await sql.query("DELETE FROM users WHERE id = ANY($1::text[])", [ids]);
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
