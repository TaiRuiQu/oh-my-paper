"use client";
import Image from "next/image";
import type { ScanSubmission } from "@/contracts/platform";
import { Panel, Empty } from "./primitives";
import { scanPageRecognition } from "@/lib/scan-recognition";

export function SubmissionScanDetails({ submission }: { submission: ScanSubmission }) {
  return (
    <section id="scan-materials" aria-label="扫描原图与识别信息">
      <Panel
        title="扫描原图与识别信息"
        description={`${submission.kind === "CARD" ? "答题卡" : "练习册"} · 保存 ${submission.sourceFiles.length} 页原图 · 录入 ${submission.answers.length} 道作答`}
      >
        <div className="p-panel-content">
          {submission.sourceFiles.length ? (
            submission.sourceFiles.map((url, index) => {
              const recognition = scanPageRecognition(submission, index);
              const studentNumber = recognition?.studentNumber;
              const mode =
                studentNumber && typeof studentNumber === "object"
                  ? (studentNumber as Record<string, unknown>).mode
                  : undefined;
              const omr =
                studentNumber && typeof studentNumber === "object" && "columns" in studentNumber;
              return (
                <details key={`${index}-${url}`}>
                  <summary>第 {index + 1} 页原图与识别结果</summary>
                  <p className="p-muted">
                    {recognition?.manual === true
                      ? "按手动框选区域切题"
                      : recognition?.corrected === true
                        ? "已完成页面定位与校正"
                        : "未记录页面校正信息"}
                    {mode === "BARCODE"
                      ? " · 使用条码识别学号"
                      : mode === "OMR" || omr
                        ? " · 使用填涂识别学号"
                        : ""}
                    {typeof recognition?.needsReview === "boolean" &&
                      (recognition.needsReview
                        ? " · 识别结果待复核，请核对原图与逐题作答"
                        : " · 未标记识别异常")}
                  </p>
                  <a href={url} target="_blank" rel="noreferrer">
                    在新窗口查看第 {index + 1} 页原图
                    <Image
                      unoptimized
                      width={1000}
                      height={1400}
                      className="p-scan-image"
                      src={url}
                      alt={`扫描原图第 ${index + 1} 页`}
                    />
                  </a>
                </details>
              );
            })
          ) : (
            <Empty>这份答卷没有保存扫描原图，可在下方核对逐题作答。</Empty>
          )}
        </div>
      </Panel>
    </section>
  );
}
