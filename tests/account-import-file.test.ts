import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  parseAccountFile,
  accountTemplate,
  accountCredentialsWorkbook,
} from "@/server/auth/account-import-file";
import { MAX_IMPORT_ROWS, validateImportRows } from "@/contracts/account-import";

const csv = (value: string) => parseAccountFile(Buffer.from(value), "csv", "STUDENT");
describe("account import files", () => {
  it("reads BOM, quoted commas/newlines, blank lines, Chinese headers and leading zeroes", async () => {
    const rows = await csv(
      '\uFEFF姓名,学号\r\n"张,三",000001\r\n\r\n"李\n四",000002\r\n王五,000003\r\n',
    );
    expect(rows.map((row) => [row.row, row.name, row.studentNumber])).toEqual([
      [2, "张,三", "000001"],
      [4, "李\n四", "000002"],
      [6, "王五", "000003"],
    ]);
  });
  it("accepts GB18030 CSV and keeps student numbers as text", async () => {
    // 姓名,学号\r\n张三,000001 encoded in GB18030.
    const bytes = Buffer.from("d0d5c3fb2cd1a7bac50d0ad5c5c8fd2c303030303031", "hex");
    expect((await parseAccountFile(bytes, "csv", "STUDENT"))[0]).toMatchObject({
      name: "张三",
      studentNumber: "000001",
    });
  });
  it("reads XLSX text and zero-padded numbers from the first sheet", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("学生");
    sheet.addRow(["学号", "姓名"]);
    sheet.addRow(["000001", "张三"]);
    sheet.addRow([2, "李四"]);
    sheet.getCell("A3").numFmt = "000000";
    const other = book.addWorksheet("说明");
    other.addRow(["忽略此表"]);
    const rows = await parseAccountFile(
      Buffer.from(await book.xlsx.writeBuffer()),
      "xlsx",
      "STUDENT",
    );
    expect(rows.map((row) => row.studentNumber)).toEqual(["000001", "000002"]);
  });
  it("preserves teacher passwords including spaces and normalizes usernames during validation", async () => {
    const rows = await parseAccountFile(
      Buffer.from('账号,密码,姓名\nTeacher.A," password! ",张老师'),
      "csv",
      "TEACHER",
    );
    expect(rows[0].password).toBe(" password! ");
    expect(validateImportRows("TEACHER", rows)).toEqual([]);
    expect(
      validateImportRows("TEACHER", [...rows, { ...rows[0], row: 3, username: "teacher.a" }]),
    ).toEqual([{ row: 3, message: "账号或学号与第 2 行重复。" }]);
  });
  it("reports invalid rows and duplicate student numbers without rejecting automatic numbers", async () => {
    const rows = await csv("姓名,学号\n张三,000001\n李四,000001\n,abc\n王五,\n赵六,");
    const issues = validateImportRows("STUDENT", rows);
    expect(issues).toHaveLength(2);
    expect(issues[0].row).toBe(3);
    expect(issues[1].row).toBe(4);
  });
  it("rejects empty files, missing/duplicate headers, malformed CSV, old XLS and too many rows", async () => {
    for (const content of [
      "",
      "姓名,学号\n",
      "姓名,姓名\n张三,李四",
      "名字,编号\n张三,1",
      '姓名,学号\n"未闭合,1',
    ])
      await expect(csv(content)).rejects.toThrow();
    await expect(parseAccountFile(Buffer.from("data"), "xls", "STUDENT")).rejects.toThrow(".xlsx");
    await expect(
      csv(
        "姓名,学号\n" +
          Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `学生${i},${i}`).join("\n"),
      ),
    ).rejects.toThrow("最多导入");
  });
  it("rejects formulas and inaccurate numeric identifiers in XLSX", async () => {
    for (const value of [{ formula: "1+1", result: 2 }, 1234567890123456]) {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("学生");
      sheet.addRow(["姓名", "学号"]);
      sheet.addRow(["张三", value]);
      await expect(
        parseAccountFile(Buffer.from(await book.xlsx.writeBuffer()), "xlsx", "STUDENT"),
      ).rejects.toThrow("第 2 行");
    }
  });
  it("produces editable text-formatted XLSX and UTF-8 CSV templates", async () => {
    for (const role of ["STUDENT", "TEACHER"] as const) {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load((await accountTemplate(role, "xlsx")) as never);
      expect(book.worksheets[0].getColumn(2).numFmt).toBe("@");
      expect((await accountTemplate(role, "csv")).subarray(0, 3)).toEqual(
        Buffer.from([239, 187, 191]),
      );
    }
  });
  it("preserves exact credentials in text cells without executing formulas", async () => {
    const accounts = [
      { row: 2, name: '=HYPERLINK("bad")', username: "000001", password: "-@Password123" },
    ];
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await accountCredentialsWorkbook(accounts)) as never);
    const sheet = book.worksheets[0];
    expect(sheet.getCell("A2").value).toBe(accounts[0].name);
    expect(sheet.getCell("B2").value).toBe("000001");
    expect(sheet.getCell("C2").value).toBe("-@Password123");
    expect(sheet.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell("B2").numFmt).toBe("@");
  });
});
