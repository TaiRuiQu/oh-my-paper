import { expect, it } from "vitest";
import { readFormData } from "@/server/http/mutations";

it("accepts a bounded streamed multipart image without Content-Length", async () => {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "作答.png", { type: "image/png" }));
  const request = new Request("https://school.invalid/upload", { method: "POST", body: form });
  expect(request.headers.has("content-length")).toBe(false);
  const parsed = await readFormData(request, 1000);
  const file = parsed.get("file") as File;
  expect(file.name).toBe("作答.png");
  expect(file.size).toBe(3);
});

it("cancels an oversized chunked upload before parsing or consuming remaining bytes", async () => {
  let cancelled = false;
  let reads = 0;
  const stream = new ReadableStream(
    {
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(20));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("https://school.invalid/upload", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await expect(readFormData(request, 30)).rejects.toMatchObject({ status: 413 });
  expect(reads).toBe(2);
  expect(cancelled).toBe(true);
});

it("rejects declared oversized or malformed multipart input with business errors", async () => {
  await expect(
    readFormData(
      new Request("https://school.invalid/upload", {
        method: "POST",
        headers: { "Content-Length": "200" },
        body: "data",
      }),
      100,
    ),
  ).rejects.toMatchObject({ status: 413 });
  await expect(
    readFormData(
      new Request("https://school.invalid/upload", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=missing" },
        body: "not multipart",
      }),
      100,
    ),
  ).rejects.toMatchObject({ status: 400 });
});
