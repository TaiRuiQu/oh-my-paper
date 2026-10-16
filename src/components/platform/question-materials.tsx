"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import styles from "./question-materials.module.css";

function MaterialImage({
  url,
  index,
  compact = false,
}: {
  url: string;
  index: number;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Keep authentication on the existing private asset route; do not proxy images through an optimizer.
  const valid = /^\/api\/platform\/assets\/[a-f0-9-]{36}$/.test(url);
  return (
    <figure className={compact ? styles.preview : styles.material}>
      <figcaption>图像材料 {index + 1}</figcaption>
      {!valid ? (
        <p role="alert">材料引用无效，请联系题目所有者重新上传。</p>
      ) : failed ? (
        <div className={styles.failure} role="alert">
          <p>图像材料 {index + 1} 暂时无法加载，请检查网络或访问权限后重试。</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            重试材料 {index + 1}
          </Button>
        </div>
      ) : (
        <Image
          key={`${url}/${attempt}`}
          unoptimized
          src={url}
          width={1000}
          height={1000}
          loading="lazy"
          decoding="async"
          alt={`题目图像材料 ${index + 1}（未提供文字描述）`}
          className={styles.image}
          onError={() => setFailed(true)}
        />
      )}
      {valid && (
        <a href={url} target="_blank" rel="noreferrer" className={styles.original}>
          新窗口查看材料 {index + 1} 原图
        </a>
      )}
    </figure>
  );
}

export function QuestionMaterialSummary({
  images,
  detailHref,
}: {
  images: string[];
  detailHref: string;
}) {
  const [previewing, setPreviewing] = useState(false);
  if (!images.length) return null;
  return (
    <div
      className={styles.summary}
      role="group"
      aria-label={`题目图像材料，共 ${images.length} 张`}
    >
      <div className={styles.actions}>
        <strong>图像材料 · {images.length} 张</strong>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={previewing}
          onClick={() => setPreviewing((value) => !value)}
        >
          {previewing ? "收起材料预览" : "预览首张材料"}
        </Button>
        <Link href={`${detailHref}#question-materials`}>查看全部材料（{images.length} 张）</Link>
      </div>
      {previewing && (
        <>
          <p className={styles.hint}>此处仅预览第 1 张，请进入试题详情核对完整材料。</p>
          <MaterialImage key={images[0]} url={images[0]} index={0} compact />
        </>
      )}
    </div>
  );
}

export function QuestionMaterialGallery({
  images,
  id,
  label = "题目图像材料",
}: {
  images: string[];
  id?: string;
  label?: string;
}) {
  if (!images.length) return null;
  return (
    <section id={id} aria-label={label} className={styles.gallery}>
      <h3>图像材料（{images.length} 张）</h3>
      <p className={styles.hint}>
        以下材料属于本题，按上传顺序排列；图片未附文字描述，可在新窗口查看原图。
      </p>
      {images.map((url, index) => (
        <MaterialImage key={`${url}/${index}`} url={url} index={index} />
      ))}
    </section>
  );
}
