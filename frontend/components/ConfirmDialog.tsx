"use client";

import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation modal instead of window.confirm: focus moves inside, Esc and the backdrop close it. */
export function ConfirmDialog({ open, title, text, confirmLabel, danger, busy, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text"
        onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title" className="modal-title">
          {title}
        </h2>
        <p id="confirm-text" className="small" style={{ margin: 0 }}>
          {text}
        </p>
        <div className="row gap-sm" style={{ justifyContent: "flex-end" }}>
          <button ref={cancelRef} className="btn btn-sm" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
