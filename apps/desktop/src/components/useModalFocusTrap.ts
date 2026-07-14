import { useEffect, type RefObject } from "react";
import { isImeComposing } from "../keyboard";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalFocusTrapOptions {
  active?: boolean;
  initialFocusSelector?: string;
  lockScroll?: boolean;
  onEscape?: () => void;
}

let scrollLockCount = 0;
let restoreScrollLock: (() => void) | null = null;

export function useModalFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { active = true, initialFocusSelector, lockScroll = true, onEscape }: ModalFocusTrapOptions = {},
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = lockScroll ? acquireScrollLock() : null;

    const focusInitial = () => {
      const target =
        (initialFocusSelector
          ? container.querySelector<HTMLElement>(initialFocusSelector)
          : null) ??
        getFocusableElements(container)[0] ??
        container;
      target.focus({ preventScroll: true });
    };

    const isTopModal = () => {
      const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-modal-root='true']"));
      return roots.at(-1) === container;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopModal()) return;
      if (isImeComposing(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (!container.contains(activeElement)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
        return;
      }
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
        return;
      }
      if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    const raf = window.requestAnimationFrame(focusInitial);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown, true);
      releaseScrollLock?.();
      if (previouslyFocused && document.contains(previouslyFocused)) {
        window.requestAnimationFrame(() => previouslyFocused.focus({ preventScroll: true }));
      }
    };
  }, [active, containerRef, initialFocusSelector, lockScroll, onEscape]);
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length),
  );
}

function acquireScrollLock(): () => void {
  if (scrollLockCount === 0) {
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousRootPaddingRight = root.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);

    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      root.style.paddingRight = `${scrollbarWidth}px`;
    }
    root.dataset.modalOpen = "true";

    restoreScrollLock = () => {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
      root.style.paddingRight = previousRootPaddingRight;
      delete root.dataset.modalOpen;
      restoreScrollLock = null;
    };
  }

  let released = false;
  scrollLockCount += 1;
  return () => {
    if (released) return;
    released = true;
    scrollLockCount = Math.max(0, scrollLockCount - 1);
    if (scrollLockCount === 0) {
      restoreScrollLock?.();
    }
  };
}
