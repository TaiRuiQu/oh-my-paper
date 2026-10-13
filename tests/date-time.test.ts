import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "@/lib/date-time";

describe("timezone-independent display dates", () => {
  it("uses Beijing time across a UTC date boundary and midnight", () => {
    const timestamp = "2026-10-12T23:29:47.557Z";
    expect(formatDate(timestamp)).toBe("2026/10/13");
    expect(formatTime(timestamp)).toBe("07:29:47");
    expect(formatDateTime(timestamp)).toBe("2026/10/13 07:29:47");
    expect(formatTime("2026-10-12T16:00:00Z")).toBe("00:00:00");
  });
  it("renders identical text in processes with different default timezones", () => {
    const results = ["UTC", "America/Los_Angeles", "Asia/Shanghai"].map((TZ) =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          'import { formatDateTime } from "./src/lib/date-time.ts"; process.stdout.write(formatDateTime("2026-10-12T23:29:47.557Z"));',
        ],
        { cwd: process.cwd(), env: { ...process.env, TZ }, encoding: "utf8" },
      ),
    );
    expect(results).toEqual(Array(3).fill("2026/10/13 07:29:47"));
  });
});
