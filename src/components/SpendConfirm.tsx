type Row = { label: string; value: string };

export default function SpendConfirm({
  open,
  title,
  rows,
  confirmLabel = "Confirm and send",
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  rows: Row[];
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 p-3">
      <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="text-white text-base font-semibold mb-3">{title}</h2>
        <dl className="space-y-2 mb-4">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] uppercase tracking-wide text-zinc-500">
                {row.label}
              </dt>
              <dd className="text-sm text-white break-all font-mono">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex gap-2">
          <button
            type="button"
            className="defi-compact-btn flex-1"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="defi-btn-primary flex-1"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Sending…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
