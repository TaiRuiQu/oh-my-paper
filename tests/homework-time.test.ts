import { describe, expect, it } from "vitest";
import { resolveHomeworkDeadline } from "@/lib/homework-time";

describe("school homework deadlines", () => {
  it.each([
    ["2026-10-15T08:00", "Asia/Shanghai", "2026-10-15T00:00:00.000Z"],
    ["2026-10-15T08:00", "America/Los_Angeles", "2026-10-15T15:00:00.000Z"],
    ["2026-12-15T08:00", "America/Los_Angeles", "2026-12-15T16:00:00.000Z"],
    ["2028-02-29T00:00", "UTC", "2028-02-29T00:00:00.000Z"],
    ["2026-10-15T08:00", "Asia/Kathmandu", "2026-10-15T02:15:00.000Z"],
    ["2026-10-15T08:00", "Pacific/Kiritimati", "2026-10-14T18:00:00.000Z"],
  ])("resolves %s in %s independently of the process timezone", (local, zone, expected) => {
    expect(resolveHomeworkDeadline(local, zone).toISOString()).toBe(expected);
  });

  it.each([
    ["2026-03-08T02:30", "America/New_York"],
    ["2026-10-04T02:15", "Australia/Lord_Howe"],
    ["2011-12-30T12:00", "Pacific/Apia"],
  ])("rejects nonexistent %s in %s instead of changing the teacher's time", (local, zone) => {
    expect(() => resolveHomeworkDeadline(local, zone)).toThrow("不存在");
  });

  it.each([
    ["2026-11-01T01:30", "America/New_York"],
    ["2026-04-05T01:45", "Australia/Lord_Howe"],
  ])("rejects ambiguous %s in %s", (local, zone) => {
    expect(() => resolveHomeworkDeadline(local, zone)).toThrow("两次");
  });

  it.each([
    "2026-02-29T10:00",
    "2026-13-01T08:00",
    "2026-10-15T24:00",
    "2026-10-15T08:60",
    "2026-10-15",
    "2026-10-15T08:00Z",
    "0099-10-15T08:00",
  ])("rejects invalid wall-clock input %s", (local) =>
    expect(() => resolveHomeworkDeadline(local, "UTC")).toThrow(),
  );

  it.each(["", "Mars/Olympus", "+03:00"])("rejects invalid school timezone %s", (zone) => {
    expect(() => resolveHomeworkDeadline("2026-10-15T08:00", zone)).toThrow("IANA");
  });
});
