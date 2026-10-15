"use client";
import { useRef, useState } from "react";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  type ImportPreview,
  type ImportResult,
  type ImportRole,
} from "@/contracts/account-import";
import { apiRequest, jsonBody } from "@/lib/http-client";
import { Field } from "./primitives";
import styles from "./account-import.module.css";

export function AccountImport({
  role,
  classroomId,
  refresh,
  onClose,
}: {
  role: ImportRole;
  classroomId?: string;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ImportPreview>();
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filename, setFilename] = useState("");
  const working = useRef(false);
  const label = role === "STUDENT" ? "学生" : "教师";
  const query = new URLSearchParams({ role, ...(classroomId ? { classroomId } : {}) });
  const endpoint = "/api/platform/accounts/import";
  async function upload(file?: File) {
    if (working.current) return;
    setPreview(undefined);
    setError("");
    setFilename(file?.name ?? "");
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx", "csv"].includes(extension)) {
      setError("请选择 Excel（.xlsx）或 CSV（.csv）文件；旧版 .xls 请另存为 .xlsx。");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError("文件不能超过 2 MB，请拆分后上传。");
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      setPreview(
        await apiRequest<ImportPreview>(`${endpoint}?${query}&extension=${extension}`, {
          method: "POST",
          body: file,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取失败，请重新选择文件。");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview || preview.issues.length || working.current || result) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await apiRequest<ImportResult>(endpoint, {
        method: "PUT",
        ...jsonBody({ role, classroomId, rows: preview.rows }),
      });
      // Keep credentials even if refreshing the directory fails after the commit.
      setResult(saved);
      setPreview(undefined);
      try {
        await refresh();
      } catch {
        setError("账号已导入，名单刷新失败。请先下载登录信息，再刷新页面。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败，请重试。");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function download() {
    if (!result || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}?${query}&download=credentials`, {
        method: "POST",
        ...jsonBody(result),
      });
      if (!response.ok) {
        const problem = await response.json();
        throw new Error(problem.error ?? "下载失败，请重试。");
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${label}登录信息.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败，请重试。");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="p-form" aria-label={`批量导入${label}`} aria-busy={busy}>
      <h3>批量导入{label}</h3>
      {result ? (
        <>
          <p role="status">
            已成功导入 {result.accounts.length} 个{label}账号{classroomId ? "，并加入当前班级" : ""}
            。
          </p>
          <p>
            请下载并保存登录信息，再分发给账号使用者。关闭此导入面板后，初始密码将无法再次查看。
          </p>
          <div className="p-actions">
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => void download()}
            >
              下载登录信息（Excel）
            </button>
            <button className="button secondary" type="button" disabled={busy} onClick={onClose}>
              关闭导入面板
            </button>
          </div>
        </>
      ) : (
        <>
          <p>每次最多 {MAX_IMPORT_ROWS} 行，文件不超过 2 MB。先下载模板，填写后上传并检查预览。</p>
          <p className="p-muted">
            {role === "STUDENT"
              ? "姓名必填；学号可留空，系统会生成六位学号和初始密码。"
              : "账号、密码必填，姓名可选；密码为 10 至 128 个字符，账号不区分大小写。"}{" "}
            请将学号、账号和密码列设为文本，保留前导零。
          </p>
          <div className="p-actions">
            <a className="button secondary" href={`${endpoint}?${query}&format=xlsx`} download>
              下载 Excel 模板
            </a>
            <a className="button secondary" href={`${endpoint}?${query}&format=csv`} download>
              下载 CSV 模板
            </a>
          </div>
          <Field
            label="上传 Excel 或 CSV"
            hint="支持 .xlsx、.csv；Excel 读取第一个工作表。CSV 支持 UTF-8 和 GB18030 编码。"
          >
            <input
              type="file"
              accept=".xlsx,.csv"
              disabled={busy}
              onChange={(event) => void upload(event.target.files?.[0])}
            />
          </Field>
          {busy && <p role="status">{preview ? "正在导入，请稍候…" : "正在读取并校验文件…"}</p>}
          {preview && (
            <>
              <p role="status">
                {filename}：共 {preview.rows.length} 行，
                {preview.issues.length
                  ? `${preview.issues.length} 处错误。请修正文件后重新上传，整批尚未导入。`
                  : "校验通过，确认后创建账号。"}
              </p>
              {preview.issues.length > 0 && (
                <div role="alert" className={styles.issues} tabIndex={0} aria-label="导入错误">
                  <ul>
                    {preview.issues.map((issue, index) => (
                      <li key={index}>
                        第 {issue.row} 行：{issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="p-table" role="region" aria-label="导入预览" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th>文件行</th>
                      <th>姓名</th>
                      <th>{role === "STUDENT" ? "学号" : "账号"}</th>
                      {role === "TEACHER" && <th>密码</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 20).map((row) => (
                      <tr key={row.row}>
                        <td>{row.row}</td>
                        <td>{row.name || (role === "STUDENT" ? "未填写" : "使用账号名")}</td>
                        <td>
                          {(role === "STUDENT" ? row.studentNumber : row.username) || "自动生成"}
                        </td>
                        {role === "TEACHER" && <td>{row.password ? "已填写" : "未填写"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 20 && (
                <p className="p-muted">仅展示前 20 行，确认后导入全部 {preview.rows.length} 行。</p>
              )}
            </>
          )}
          <div className="p-actions">
            <button
              type="button"
              className="button"
              disabled={busy || !preview || preview.issues.length > 0}
              onClick={() => void commit()}
            >
              {busy && preview
                ? "正在导入…"
                : `确认导入${preview ? ` ${preview.rows.length} 个账号` : ""}`}
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              取消
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}
