import { writeFileSync } from "node:fs";
import protobuf from "protobufjs";
import { format } from "prettier";

const root = protobuf.loadSync("src/contracts/ai-progress.proto");
writeFileSync(
  "src/contracts/ai-progress.schema.json",
  await format(JSON.stringify(root.toJSON()), { parser: "json" }),
);
