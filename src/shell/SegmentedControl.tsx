// SegmentedControl — seletor de período (NAVBAR.md §4.2).

interface Props<T extends string> {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        background: "var(--sunken)",
        border: "1px solid var(--rule)",
        borderRadius: 8
      }}
    >
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className="mono"
            style={{
              padding: "4px 11px",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.3,
              color: active ? "var(--ink)" : "var(--ink3)",
              background: active ? "var(--panel)" : "transparent",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,.06)" : undefined
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
