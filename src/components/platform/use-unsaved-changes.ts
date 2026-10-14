"use client";
import { useEffect } from "react";

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const navigation = (
      window as Window & {
        navigation?: {
          currentEntry?: { index: number };
          addEventListener: (type: string, listener: (event: Event) => void) => void;
          removeEventListener: (type: string, listener: (event: Event) => void) => void;
        };
      }
    ).navigation;
    const editingIndex = navigation?.currentEntry?.index;
    let restoring = false;
    let approvedTraversal = false;
    const beforeTraverse = (event: Event) => {
      const traversal = event as Event & { navigationType?: string };
      if (traversal.navigationType !== "traverse" || !event.cancelable || restoring) return;
      // navigate precedes popstate and App Router, so cancellation retains the mounted draft.
      if (!window.confirm("有未保存的排版修改，离开后会丢失。确定离开？")) event.preventDefault();
      else approvedTraversal = true;
    };
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      if (!window.confirm("有未保存的排版修改，离开后会丢失。确定离开？")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const traverse = (event: PopStateEvent) => {
      if (approvedTraversal) {
        approvedTraversal = false;
        return;
      }
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      if (window.confirm("有未保存的排版修改，离开后会丢失。确定离开？")) return;
      // Capture before App Router consumes the traversal. Restore the original entry
      // without adding a duplicate URL or replacing the editor's in-memory draft.
      event.stopImmediatePropagation();
      restoring = true;
      const targetIndex = navigation?.currentEntry?.index;
      window.history.go(
        editingIndex !== undefined && targetIndex !== undefined ? editingIndex - targetIndex : 1,
      );
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    window.addEventListener("popstate", traverse, true);
    navigation?.addEventListener("navigate", beforeTraverse);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
      window.removeEventListener("popstate", traverse, true);
      navigation?.removeEventListener("navigate", beforeTraverse);
    };
  }, [dirty]);
}
