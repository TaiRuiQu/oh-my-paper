import { requireSession } from "@/server/auth/session";
import { errorResponse, RequestError } from "@/server/http/errors";
import { readJSON, requireSameOrigin } from "@/server/http/mutations";
import {
  accountImportSchema,
  importResultSchema,
  importRoleSchema,
  MAX_IMPORT_BYTES,
} from "@/contracts/account-import";
import {
  authorizeAccountImport,
  checkAccountImport,
  commitAccountImport,
} from "@/server/auth/account-import";
import {
  accountTemplate,
  accountCredentialsWorkbook,
  parseAccountFile,
} from "@/server/auth/account-import-file";

export const runtime = "nodejs";
function options(request: Request) {
  const query = new URL(request.url).searchParams;
  const role = importRoleSchema.safeParse(query.get("role"));
  if (!role.success) throw new RequestError(400, "请选择导入学生或教师。");
  return { role: role.data, classroomId: query.get("classroomId") || undefined, query };
}
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    const session = await requireSession(request.headers);
    const { role, classroomId, query } = options(request);
    await authorizeAccountImport(session.user.id, role, classroomId);
    const format = query.get("format") === "csv" ? "csv" : "xlsx";
    const bytes = await accountTemplate(role, format);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type":
          format === "csv"
            ? "text/csv; charset=utf-8"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${role.toLowerCase()}-template.${format}"`,
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await requireSession(request.headers);
    const { role, classroomId, query } = options(request);
    await authorizeAccountImport(session.user.id, role, classroomId);
    if (query.get("download") === "credentials") {
      const { accounts } = await readJSON(request, importResultSchema, MAX_IMPORT_BYTES);
      const bytes = await accountCredentialsWorkbook(accounts);
      return new Response(new Uint8Array(bytes), {
        headers: {
          ...headers,
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="account-credentials.xlsx"',
        },
      });
    }
    if (!request.body) throw new RequestError(400, "请选择文件。");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_IMPORT_BYTES) {
          await reader.cancel();
          throw new RequestError(413, "文件不能超过 2 MB。");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const rows = await parseAccountFile(Buffer.concat(chunks), query.get("extension") ?? "", role);
    return Response.json(
      { rows, issues: await checkAccountImport({ role, classroomId, rows }) },
      { headers },
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await requireSession(request.headers);
    const input = await readJSON(request, accountImportSchema, MAX_IMPORT_BYTES);
    return Response.json(await commitAccountImport(session.user.id, input), { headers });
  } catch (error) {
    return errorResponse(error, request);
  }
}
