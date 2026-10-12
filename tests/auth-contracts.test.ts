import { describe, expect, it } from "vitest";
import { authFormSchema } from "@/contracts/auth";

describe("auth form contracts", () => {
  it("requires a name, a valid email, and a long password for registration", () => {
    const schema = authFormSchema("register");
    expect(schema.safeParse({ name: " ", email: "broken", password: "short" }).success).toBe(false);
    expect(
      schema.parse({ name: " 林老师 ", email: "teacher@example.com", password: "long-password" })
        .name,
    ).toBe("林老师");
  });

  it("allows existing passwords at login without imposing new signup requirements", () => {
    expect(
      authFormSchema("login").safeParse({ name: "", email: "user@example.com", password: "old" })
        .success,
    ).toBe(true);
  });

  it("rejects empty and oversized passwords", () => {
    const schema = authFormSchema("login");
    for (const password of ["", "x".repeat(129)]) {
      expect(schema.safeParse({ name: "", email: "user@example.com", password }).success).toBe(
        false,
      );
    }
  });
});
