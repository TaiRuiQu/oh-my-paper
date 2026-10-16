"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { FileText, Maximize, Minimize, PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import styles from "./document-workbench.module.css";

export function DocumentWorkbench({
  title,
  status,
  actions,
  ribbon,
  notice,
  outline = true,
  properties = true,
  propertiesPanel,
  panelActions,
  children,
}: {
  title: string;
  status: ReactNode;
  actions: ReactNode;
  ribbon?: ReactNode;
  notice?: ReactNode;
  outline?: boolean;
  properties?: boolean;
  propertiesPanel?: ReactNode;
  panelActions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const host = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [showProperties, setShowProperties] = useState(true);

  useEffect(() => {
    if (!fullscreen || !host.current) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Keep keyboard navigation inside the editor without remounting its draft or portals.
    const siblings = new Map<HTMLElement, boolean>();
    let branch: HTMLElement = host.current;
    while (branch.parentElement) {
      // A route-entry transform would make fixed positioning relative to the page.
      branch.getAnimations?.().forEach((animation) => animation.cancel());
      for (const sibling of branch.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          siblings.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    function escape(event: KeyboardEvent) {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"][data-state="open"]')
      )
        return;
      event.preventDefault();
      setFullscreen(false);
      toggle.current?.focus();
    }
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      siblings.forEach((inert, element) => (element.inert = inert));
      document.removeEventListener("keydown", escape);
    };
  }, [fullscreen]);

  return (
    <section
      ref={host}
      id={id}
      aria-label={`${title}排版工作台`}
      className={`${styles.workbench}${fullscreen ? ` ${styles.fullscreen}` : ""}${propertiesPanel ? ` ${styles.withRail}` : ""}`}
      data-fullscreen={fullscreen}
      data-outline={outline && showOutline}
      data-properties={properties && showProperties}
      data-rail={!!propertiesPanel}
    >
      <header className={styles.header}>
        <div className={styles.identity}>
          <FileText size={20} aria-hidden="true" />
          <div>
            <h2 title={title}>{title}</h2>
            <div className={styles.status}>{status}</div>
          </div>
        </div>
        <div className={styles.actions}>
          {(outline || properties) && (
            <div className={styles.viewControls}>
              {outline && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={showOutline}
                  className={styles.outlineToggle}
                  onClick={() => setShowOutline(!showOutline)}
                >
                  <PanelLeft />
                  目录
                </Button>
              )}
              {properties && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={showProperties}
                  onClick={() => setShowProperties(!showProperties)}
                >
                  <PanelRight />
                  属性
                </Button>
              )}
            </div>
          )}
          {actions}
          <Button
            ref={toggle}
            type="button"
            variant="outline"
            aria-pressed={fullscreen}
            aria-controls={id}
            title={fullscreen ? "退出全屏（Esc）" : "全屏排版"}
            onClick={() => {
              if (!fullscreen) {
                setShowOutline(window.innerWidth >= 1280);
                setShowProperties(window.innerWidth >= 1000);
              }
              setFullscreen(!fullscreen);
            }}
          >
            {fullscreen ? <Minimize /> : <Maximize />}
            {fullscreen ? "退出全屏" : "全屏"}
          </Button>
        </div>
      </header>
      {notice && <div className={styles.notice}>{notice}</div>}
      {propertiesPanel ? (
        <div className={styles.body}>
          <div className={styles.content}>{children}</div>
          <aside className={styles.rail} aria-label="制作面板">
            <div className={styles.railTitle}>
              <PanelRight size={16} />
              制作面板
            </div>
            <div className={styles.railScroll} role="region" aria-label="制作属性设置" tabIndex={0}>
              {ribbon && (
                <section className={styles.railSettings}>
                  <h3>纸张与排版</h3>
                  <div className={styles.ribbon}>{ribbon}</div>
                </section>
              )}
              {propertiesPanel}
            </div>
            {panelActions ?? (ribbon && <div className={styles.railActions}>{actions}</div>)}
          </aside>
        </div>
      ) : (
        <>
          {ribbon && <div className={styles.ribbon}>{ribbon}</div>}
          <div className={styles.content}>{children}</div>
        </>
      )}
    </section>
  );
}
