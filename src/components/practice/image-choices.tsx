"use client";
import { QuestionMaterialGallery } from "@/components/platform/question-materials";
import styles from "./practice.module.css";
export function PracticeImageChoices({
  label,
  urls,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  urls: string[];
  selected: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-label={`${label}学生可见图片选择`}>
      <h4>{label}</h4>
      <p className={styles.help}>
        默认不开放图片。请核对原图用途，仅开放必要题面材料，不能把解题或评分图作为题面发放。
      </p>
      {urls.map((url, index) => (
        <div key={url} className={styles.question}>
          <label>
            <input
              type="checkbox"
              checked={selected.includes(url)}
              disabled={disabled}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, url]
                    : selected.filter((candidate) => candidate !== url),
                )
              }
            />{" "}
            向学生开放{label}图 {index + 1}
          </label>
          <details>
            <summary>
              查看{label}候选图 {index + 1}
            </summary>
            <QuestionMaterialGallery images={[url]} label={`${label}候选图 ${index + 1}核对材料`} />
          </details>
        </div>
      ))}
      {!urls.length && <p className={styles.help}>没有待确认图片。</p>}
    </section>
  );
}
