import { describe, expect, it, vi } from "vitest";
import type { Classroom } from "@/contracts/platform";
import { renderBarcodeLabelPages, renderStudentBarcodeSvg } from "@/server/platform/barcodes";
import { GET } from "@/app/api/platform/barcodes/route";

const mocks = vi.hoisted(() => ({ session: vi.fn(), state: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/server/platform/service", () => ({ loadState: mocks.state }));
const classroom: Classroom = {
  id: "class",
  ownerId: "teacher",
  name: "高一（1）班",
  stage: "高中",
  cohort: "2027届",
  students: [
    {
      id: "student",
      classroomId: "class",
      userId: null,
      name: "张三<script>",
      studentNumber: "000123",
    },
  ],
};
describe("student barcode labels", () => {
  it("escapes student names, retains leading zeros, and paginates copies on separate A4 sheets", () => {
    const classes = {
      ...classroom,
      students: Array.from({ length: 21 }, (_, i) => ({
        ...classroom.students[0],
        id: String(i),
        studentNumber: String(i).padStart(6, "0"),
      })),
    };
    const pages = renderBarcodeLabelPages(classes, 2);
    expect(pages).toHaveLength(2);
    expect(pages[0].match(/viewBox="0 0 160 90"/g)).toHaveLength(40);
    expect(pages[1].match(/viewBox="0 0 160 90"/g)).toHaveLength(2);
    expect(pages[0]).toContain("&lt;script&gt;");
    expect(pages[0]).not.toContain("<script>");
    expect(renderStudentBarcodeSvg(classroom.students[0], classroom.name)).toContain(
      ">000123</text>",
    );
    expect(
      renderStudentBarcodeSvg({ ...classroom.students[0], studentNumber: "123" }, classroom.name),
    ).toContain(">000123</text>");
    expect(() =>
      renderStudentBarcodeSvg(
        { ...classroom.students[0], studentNumber: "1234567" },
        classroom.name,
      ),
    ).toThrow();
    expect(() => renderBarcodeLabelPages(classroom, 0)).toThrow();
  });
  it("restricts generation to teachers and their visible classes, with bounded copy counts", async () => {
    mocks.session.mockResolvedValue({ user: { id: "teacher" } });
    mocks.state.mockResolvedValue({ actor: { role: "STUDENT" }, classrooms: [classroom] });
    const request = (params = "classroomId=class&copies=2") =>
      GET(new Request(`http://localhost/api/platform/barcodes?${params}`));
    expect((await request()).status).toBe(403);
    mocks.state.mockResolvedValue({ actor: { role: "TEACHER" }, classrooms: [classroom] });
    expect((await request("classroomId=other")).status).toBe(404);
    expect((await request("classroomId=class&copies=21")).status).toBe(400);
    const result = await request();
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await result.json()).pages).toHaveLength(1);
  });
});
