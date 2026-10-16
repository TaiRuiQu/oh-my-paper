import type { ComponentProps } from "react";
import { Panel } from "@/components/platform/primitives";
import styles from "./school.module.css";

export function SchoolPanel({ children, ...props }: ComponentProps<typeof Panel>) {
  return (
    <Panel {...props}>
      <div className={styles.panelBody}>{children}</div>
    </Panel>
  );
}
