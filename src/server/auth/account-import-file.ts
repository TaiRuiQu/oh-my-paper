import "server-only";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportResult,
  type ImportRole,
  type ImportRow,
} from "@/contracts/account-import";
import { RequestError } from "@/server/http/errors";

const columns = {
  STUDENT: { 姓名: "name", 学号: "studentNumber", name: "name", studentNumber: "studentNumber" },
  TEACHER: {
    姓名: "name",
    账号: "username",
    密码: "password",
    name: "name",
    username: "username",
    password: "password",
  },
} as const;

export async function parseAccountFile(
  bytes: Buffer,
  extension: string,
  role: ImportRole,
): Promise<ImportRow[]> {
  if (!bytes.length) throw new RequestError(400, "文件为空，请填写模板后上传。");
  if (bytes.length > MAX_IMPORT_BYTES) throw new RequestError(413, "文件不能超过 2 MB。");
  let table: { row: number; values: string[] }[];
  try {
    if (extension === "csv") {
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        content = new TextDecoder("gb18030", { fatal: true }).decode(bytes);
      }
      const records = parse(content, {
        bom: true,
        skip_empty_lines: false,
        relax_column_count: true,
        max_record_size: 8192,
        info: true,
      }) as unknown as { record: string[]; info: { lines: number } }[];
      let nextLine = 1;
      table = records.map(({ record, info }) => {
        const entry = { row: nextLine, values: record };
        nextLine = info.lines + 1;
        return entry;
      });
    } else if (extension === "xlsx") {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(bytes as never);
      const sheet = book.worksheets[0];
      if (!sheet) throw new RequestError(400, "Excel 中没有工作表。");
      table = [];
      sheet.eachRow((row, index) => {
        if (table.length > MAX_IMPORT_ROWS + 1)
          throw new RequestError(400, `每次最多导入 ${MAX_IMPORT_ROWS} 行，请拆分文件。`);
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, column) => {
          if (column > 20) throw new RequestError(400, "表格列数过多，请使用导入模板。");
          if (
            cell.type === ExcelJS.ValueType.Formula ||
            cell.type === ExcelJS.ValueType.Error ||
            cell.type === ExcelJS.ValueType.Date
          )
            throw new RequestError(400, `第 ${index} 行包含公式、错误或日期，请改为文本。`);
          if (
            typeof cell.value === "number" &&
            (!Number.isSafeInteger(cell.value) || Math.abs(cell.value) >= 1e15)
          )
            throw new RequestError(
              400,
              `第 ${index} 行的数字无法准确读取，请将账号、学号和密码设为文本。`,
            );
          values[column - 1] =
            typeof cell.value === "number" && /^0+$/.test(cell.numFmt)
              ? String(cell.value).padStart(cell.numFmt.length, "0")
              : cell.text;
        });
        table.push({ row: index, values });
      });
    } else
      throw new RequestError(
        400,
        "请上传 Excel（.xlsx）或 CSV（.csv）文件；旧版 .xls 请另存为 .xlsx。",
      );
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "文件无法读取，请检查 CSV 引号、编码或 Excel 格式后重新上传。");
  }
  table = table.filter((row) => row.values.some((value) => value?.trim()));
  const header = table.shift();
  if (!header) throw new RequestError(400, "文件为空，请填写模板后上传。");
  const mapping = columns[role] as Record<string, keyof Omit<ImportRow, "row">>;
  const fields = header.values.map((value) =>
    Object.hasOwn(mapping, value?.trim()) ? mapping[value.trim()] : undefined,
  );
  const required = role === "STUDENT" ? ["name"] : ["username", "password"];
  if (required.some((field) => !fields.includes(field as (typeof fields)[number])))
    throw new RequestError(
      400,
      role === "STUDENT"
        ? "表头必须包含「姓名」，可选「学号」。"
        : "表头必须包含「账号」「密码」，可选「姓名」。",
    );
  if (fields.some((field, index) => field && fields.indexOf(field) !== index))
    throw new RequestError(400, "表头包含重复字段，请每个字段只保留一列。");
  if (!table.length) throw new RequestError(400, "表格只有表头，请填写账号后上传。");
  if (table.length > MAX_IMPORT_ROWS)
    throw new RequestError(400, `每次最多导入 ${MAX_IMPORT_ROWS} 行，请拆分文件。`);
  return table.map(({ row, values }) => {
    const result: ImportRow = { row, name: "", username: "", studentNumber: "", password: "" };
    values.forEach((value, index) => {
      const field = fields[index];
      if (field) result[field] = field === "password" ? value : value.trim();
    });
    if (Object.values(result).some((value) => typeof value === "string" && value.length > 200))
      throw new RequestError(400, `第 ${row} 行字段过长，请检查内容。`);
    return result;
  });
}

export async function accountTemplate(role: ImportRole, format: string) {
  const headers = role === "STUDENT" ? ["姓名", "学号"] : ["姓名", "账号", "密码"];
  if (format === "csv") return Buffer.from("\uFEFF" + headers.join(",") + "\r\n", "utf8");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(role === "STUDENT" ? "学生" : "教师");
  sheet.columns = headers.map((header) => ({ header, width: 26, style: { numFmt: "@" } }));
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}

export async function accountCredentialsWorkbook(accounts: ImportResult["accounts"]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("登录信息");
  sheet.columns = [
    { header: "姓名", key: "name", width: 24 },
    { header: "账号 / 学号", key: "username", width: 28 },
    { header: "初始密码", key: "password", width: 40 },
  ].map((column) => ({ ...column, style: { numFmt: "@" } }));
  sheet.addRows(accounts.map(({ name, username, password }) => ({ name, username, password })));
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await book.xlsx.writeBuffer());
}
