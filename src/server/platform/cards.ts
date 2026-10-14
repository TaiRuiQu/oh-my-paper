export * from "@/lib/cards";

/** Printed machine code binds each page to its persisted template and page number. */
export function cardPageCode(templateId: string, page: number): string {
  let signature = 2166136261;
  for (let i = 0; i < templateId.length; i++)
    signature = Math.imul(signature ^ templateId.charCodeAt(i), 16777619);
  return `101${(signature >>> 0).toString(2).padStart(32, "0")}${page.toString(2).padStart(8, "0")}110`;
}
