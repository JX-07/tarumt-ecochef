"use client";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
export type DownloadResult = {
  success: boolean;
  message: string;
  title?: string;
  downloadName?: string;
};
export function DownloadOutcome({
  outcome,
  close,
}: {
  outcome?: DownloadResult;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (outcome && !dialog.current?.open) dialog.current?.showModal();
    else if (!outcome) dialog.current?.close();
  }, [outcome]);
  return (
    <dialog
      ref={dialog}
      className={`modal-card dashboard-export-dialog dashboard-result-dialog${outcome?.success ? " success" : " error"}`}
      aria-labelledby="download-outcome-title"
      aria-describedby="download-outcome-description"
      onCancel={close}
      onClose={close}
    >
      <header>
        <h2 id="download-outcome-title">
          {outcome?.success ? <CheckCircle2 size={24} /> : <CircleAlert size={24} />}{" "}
          {outcome?.success ? "Successful download" : (outcome?.title ?? "Download unsuccessful")}
        </h2>
        <button type="button" aria-label="Close download message" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <p id="download-outcome-description">
        {outcome?.success
          ? `The ${outcome.downloadName ?? "report"} has been downloaded successfully!`
          : outcome?.message}
      </p>
      <footer>
        <button type="button" className="cta" autoFocus onClick={close}>
          Okay
        </button>
      </footer>
    </dialog>
  );
}
