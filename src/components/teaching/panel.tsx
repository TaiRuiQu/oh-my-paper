import type { ComponentProps } from "react";
import { Panel } from "@/components/platform/primitives";
import styles from "./teaching.module.css";

export function TeachingPanel({ children, ...props }: ComponentProps<typeof Panel>) {
  return (
    <Panel {...props}>
      <div className={styles.panelBody}>{children}</div>
    </Panel>
  );
}
