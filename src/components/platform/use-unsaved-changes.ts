"use client";
import { useCallback, useEffect, useRef } from "react";

type Draft = { active: boolean; message: string };
const drafts = new Set<Draft>();

// Several question scores can be edited together. One navigation must ask only once.
function watchNavigation() {
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
  const confirm = () => {
    const active = [...drafts].filter((draft) => draft.active);
    return (
      !active.length ||
      window.confirm(
        active.length === 1 ? active[0].message : "有多处未保存的内容，离开后会丢失。确定离开？",
      )
    );
  };
  const beforeTraverse = (event: Event) => {
    const traversal = event as Event & { navigationType?: string };
    if (traversal.navigationType !== "traverse" || !event.cancelable || restoring) return;
    if (!confirm()) event.preventDefault();
    else approvedTraversal = true;
  };
  const unload = (event: BeforeUnloadEvent) => {
    if ([...drafts].some((draft) => draft.active)) event.preventDefault();
  };
  const navigate = (event: MouseEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    if (!confirm()) {
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
    if (confirm()) return;
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
}
let stopWatching: (() => void) | undefined;

export function useUnsavedChanges(
  dirty: boolean,
  message = "有未保存的排版修改，离开后会丢失。确定离开？",
) {
  const draft = useRef<Draft>({ active: false, message });
  useEffect(() => {
    const entry = draft.current;
    entry.active = dirty;
    entry.message = message;
    if (!dirty) return;
    drafts.add(entry);
    stopWatching ??= watchNavigation();
    return () => {
      drafts.delete(entry);
      if (!drafts.size) {
        stopWatching?.();
        stopWatching = undefined;
      }
    };
  }, [dirty, message]);
  const markSaved = useCallback(() => {
    draft.current.active = false;
  }, []);
  const confirmDiscard = useCallback(() => {
    if (draft.current.active && !window.confirm(draft.current.message)) return false;
    draft.current.active = false;
    return true;
  }, []);
  return { confirmDiscard, markSaved };
}
