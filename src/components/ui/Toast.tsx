import { useAppStore } from "../../store/app";
import { ToastPill } from "./ToastPill";

export function Toast() {
  const msg = useAppStore((s) => s.toastMessage);
  const action = useAppStore((s) => s.toastAction);
  if (!msg) return null;

  return (
    <ToastPill>
      <span className="text-center">{msg}</span>
      {action && (
        <button
          onClick={() => {
            action.onAction();
            // Dismiss the toast as soon as its action runs.
            useAppStore.setState({ toastMessage: null, toastAction: null });
          }}
          className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
          style={{ color: "var(--accent)" }}
        >
          {action.label}
        </button>
      )}
    </ToastPill>
  );
}
