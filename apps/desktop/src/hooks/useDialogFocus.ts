import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

/** Keeps keyboard focus inside an active dialog and returns it to the opener. */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  initialSelector?: string,
) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusInitial = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const initial = initialSelector ? dialog.querySelector<HTMLElement>(initialSelector) : null;
      (initial ?? dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
    };
    const frame = window.requestAnimationFrame(focusInitial);

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const current = document.activeElement;
      const index = focusable.indexOf(current as HTMLElement);
      const next = event.shiftKey
        ? focusable[(index <= 0 ? focusable.length : index) - 1]
        : focusable[(index + 1) % focusable.length];
      if (index === -1 || (!event.shiftKey && index === focusable.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        next?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [initialSelector, open]);

  return dialogRef;
}
