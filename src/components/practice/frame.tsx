"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./practice.module.css";
export function PracticeFrame({
  title,
  description,
  children,
  back,
}: {
  title: string;
  description: string;
  children: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className={styles.workspace}>
      <div className="p-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {back && (
          <Link className="button secondary" href={back.href}>
            {back.label}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}
