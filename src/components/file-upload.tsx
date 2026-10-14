"use client";
import { useState } from "react";
import { FileUp, FileText, X } from "lucide-react";
import { mergeExamFiles } from "@/lib/exam-upload";
export function FileUpload({
  id,
  files,
  onChange,
  disabled,
  label = "选择文件或拖放到这里",
  student = true,
  onError,
  limitsLabel,
  groupingLabel,
}: {
  id: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
  label?: string;
  student?: boolean;
  onError: (error: string) => void;
  limitsLabel?: string;
  groupingLabel?: string;
}) {
  const [dragging, setDragging] = useState(false);
  function add(incoming: File[]) {
    if (disabled) return;
    try {
      onChange(mergeExamFiles(files, incoming));
      onError("");
    } catch (error) {
      onError(error instanceof Error ? error.message : "请选择支持的文件。");
    }
  }
  return (
    <>
      <div
        className={`upload-dropzone${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          add(Array.from(event.dataTransfer.files));
        }}
      >
        <FileUp size={30} aria-hidden="true" />
        <label htmlFor={id}>{label}</label>
        <p className="hint" id={`${id}-hint`}>
          PDF、JPG、PNG · 单个文件不超过 40 MB
        </p>
        <input
          id={id}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          disabled={disabled}
          aria-describedby={`${id}-hint ${id}-limits`}
          onChange={(event) => {
            add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>
      <p className="upload-limits hint" id={`${id}-limits`}>
        {limitsLabel ?? "最多 20 个文件，共 100 MB。"}
        {groupingLabel ?? `多页按文件列表顺序处理。${student ? "每次上传一位学生的答卷。" : ""}`}
      </p>
      {!!files.length && (
        <ol className="file-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <FileText size={17} aria-hidden="true" />
              <span>
                {index + 1}. {file.name}
              </span>
              <button
                className="icon-button"
                type="button"
                disabled={disabled}
                aria-label={`移除 ${file.name}`}
                onClick={() => onChange(files.filter((_, position) => position !== index))}
              >
                <X size={17} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
