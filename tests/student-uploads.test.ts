import { describe, expect, it } from "vitest";
import { groupStudentUploads } from "@/lib/student-uploads";
describe("student document boundaries", () => {
  it("keeps every PDF separate even after an image page count was selected", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      name: `student-${i}.pdf`,
      type: "application/pdf",
    }));
    expect(groupStudentUploads(files, 2)).toEqual(files.map((f) => [f]));
  });
  it("preserves one student's homework images and groups card images explicitly", () => {
    const images = ["front.png", "back.png", "front-2.png", "back-2.png"].map((name) => ({ name }));
    expect(groupStudentUploads(images)).toEqual([images]);
    expect(groupStudentUploads(images, 2)).toEqual([images.slice(0, 2), images.slice(2)]);
    expect(() => groupStudentUploads(images.slice(0, 3), 2)).toThrow("整数倍");
  });
  it("rejects ambiguous mixed uploads and uses detected MIME types on the server", () => {
    expect(() => groupStudentUploads([{ name: "a.pdf" }, { name: "a.png" }])).toThrow("分开提交");
    expect(
      groupStudentUploads([
        { name: "a.png", type: "application/pdf" },
        { name: "b.png", type: "application/pdf" },
      ]),
    ).toHaveLength(2);
  });
});
