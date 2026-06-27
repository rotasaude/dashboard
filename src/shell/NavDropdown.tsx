// NavDropdown — grupo da navbar. Item único = botão direto; grupo = toggle +
// menu suspenso. Open state é controlado pelo AppHeader (apenas um aberto
// por vez). Spec: NAVBAR.md §3.

import type { ModuleId, NavItem } from "./modules";

interface Props {
  label: string;
  items: NavItem[];
  active: ModuleId;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (id: ModuleId) => void;
}

export function NavDropdown({ label, items, active, isOpen, onToggle, onClose, onSelect }: Props) {
  // Item único — botão direto (NAVBAR.md §3.2)
  if (items.length === 1) {
    const only = items[0];
    const isActive = only.id === active;
    return (
      <button
        onClick={() => { onSelect(only.id); onClose(); }}
        style={{
          padding: "7px 12px",
          borderRadius: 7,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          whiteSpace: "nowrap",
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          fontWeight: isActive ? 600 : 500,
          color: isActive ? "var(--accent)" : "var(--ink2)",
          background: isActive ? "var(--accent-bg)" : "transparent",
          lineHeight: 1.2,
          flexShrink: 0
        }}
      >
        <span
          aria-hidden
          className="mono"
          style={{ fontSize: 12, color: isActive ? "var(--accent)" : "var(--ink4)" }}
        >
          {only.icon}
        </span>
        <span>{label}</span>
      </button>
    );
  }

  // Grupo com vários itens — toggle + menu (NAVBAR.md §3.3)
  const containsActive = items.some((i) => i.id === active);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        style={{
          padding: "7px 12px",
          borderRadius: 7,
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 7,
          whiteSpace: "nowrap",
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          fontWeight: containsActive ? 600 : 500,
          color: containsActive ? "var(--accent)" : "var(--ink2)",
          background: isOpen ? "var(--sunken)" : "transparent",
          lineHeight: 1.2,
          flexShrink: 0
        }}
      >
        <span>{label}</span>
        {containsActive && (
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: "var(--accent)",
              flexShrink: 0
            }}
          />
        )}
        <Chevron open={isOpen} />
      </button>

      {isOpen && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 20,
            minWidth: 208,
            background: "var(--panel)",
            border: "1px solid var(--rule2)",
            borderRadius: 10,
            padding: 6,
            boxShadow: "var(--shadow-dropdown)",
            display: "flex",
            flexDirection: "column",
            gap: 2
          }}
        >
          {items.map((it) => {
            const itemActive = it.id === active;
            return (
              <button
                key={it.id}
                role="menuitem"
                onClick={() => { onSelect(it.id); onClose(); }}
                style={{
                  padding: "8px 10px",
                  borderRadius: 7,
                  border: "none",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-sans)",
                  fontSize: 12.5,
                  fontWeight: itemActive ? 600 : 500,
                  color: itemActive ? "var(--accent)" : "var(--ink2)",
                  background: itemActive ? "var(--accent-bg)" : "transparent",
                  transition: "background 80ms ease"
                }}
                onMouseEnter={(e) => {
                  if (!itemActive) e.currentTarget.style.background = "var(--sunken)";
                }}
                onMouseLeave={(e) => {
                  if (!itemActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  aria-hidden
                  className="mono"
                  style={{
                    fontSize: 12,
                    width: 14,
                    textAlign: "center",
                    color: itemActive ? "var(--accent)" : "var(--ink4)",
                    flexShrink: 0
                  }}
                >
                  {it.icon}
                </span>
                <span>{it.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="9"
      height="9"
      viewBox="0 0 10 10"
      style={{
        color: "var(--ink4)",
        transform: open ? "rotate(180deg)" : "rotate(0)",
        transition: "transform 150ms ease",
        flexShrink: 0
      }}
    >
      <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
