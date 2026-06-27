// NotificationCenter — sino + badge + dropdown (NAVBAR.md §4.4 + COMPONENTS.md).
// Limitações conhecidas sempre visíveis (§5 do brief).

import { useEffect, useRef, useState } from "react";
import { type Alert, worstSeverity } from "../lib/alerts";
import { StatusDot } from "../components/StatusDot";
import type { ModuleId } from "./modules";

interface Props {
  active: Alert[];
  limitations: Alert[];
  onNavigate?: (id: ModuleId) => void;
}

export function NotificationCenter({ active, limitations, onNavigate }: Props) {
  const [ open, setOpen ] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const worst = worstSeverity(active);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ open ]);

  const accessibleLabel =
    active.length > 0
      ? `Notificações — ${active.length} ${active.length === 1 ? "alerta ativo" : "alertas ativos"}`
      : "Notificações";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={accessibleLabel}
        aria-expanded={open}
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: open ? "var(--sunken)" : "transparent",
          border: open ? "1px solid var(--rule2)" : "1px solid transparent",
          color: "var(--ink2)",
          cursor: "pointer",
          position: "relative",
          padding: 0,
          flexShrink: 0
        }}
      >
        <BellIcon />
        {active.length > 0 && <Badge count={active.length} level={worst} />}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 30,
            width: 384,
            maxHeight: "78vh",
            overflowY: "auto",
            background: "var(--panel)",
            border: "1px solid var(--rule2)",
            borderRadius: 12,
            padding: 6,
            boxShadow: "var(--shadow-notif)"
          }}
        >
          <Header active={active.length} />
          <Section title="Alertas ativos" count={active.length}>
            {active.length === 0 ? (
              <EmptyLine>nenhum alerta no escopo atual</EmptyLine>
            ) : (
              active.map((a) => (
                <AlertRow key={a.id} alert={a} onClick={onNavigate} onClose={() => setOpen(false)} />
              ))
            )}
          </Section>
          <Section title="Limitações conhecidas" count={limitations.length} muted>
            {limitations.map((a) => (
              <AlertRow key={a.id} alert={a} onClick={onNavigate} onClose={() => setOpen(false)} />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Header({ active }: { active: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px 10px"
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Notificações</span>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 999,
          background: "var(--sunken)",
          color: "var(--ink3)"
        }}
      >
        {active} ativos
      </span>
    </div>
  );
}

function Section({ title, count, muted, children }: { title: string; count: number; muted?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: muted ? 4 : 0 }}>
      <div
        className="mono"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: muted ? "var(--sunken)" : "transparent",
          borderTop: muted ? "1px solid var(--rule)" : undefined,
          borderRadius: muted ? 6 : 0,
          fontSize: 10.5,
          color: "var(--ink3)",
          textTransform: "uppercase",
          letterSpacing: 0.6
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--ink2)" }}>{title}</span>
        <span>{count}</span>
      </div>
      <div style={{ padding: 2 }}>{children}</div>
    </div>
  );
}

function AlertRow({ alert, onClick, onClose }: { alert: Alert; onClick?: (id: ModuleId) => void; onClose: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={() => {
        if (alert.to && onClick) onClick(alert.to as ModuleId);
        onClose();
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        width: "100%",
        background: "transparent",
        border: "none",
        borderRadius: 8,
        textAlign: "left",
        cursor: alert.to ? "pointer" : "default",
        transition: "background 80ms ease"
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--sunken)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ marginTop: 4 }}>
        <StatusDot level={alert.severity} size={8} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>
          {alert.title}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "var(--ink2)", marginTop: 2 }}>
          {alert.body}
        </span>
      </span>
      {alert.to && (
        <span className="mono" style={{ fontSize: 10.5, color: "var(--accent)", whiteSpace: "nowrap" }}>
          ir →
        </span>
      )}
    </button>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mono" style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--ink3)" }}>
      {children}
    </div>
  );
}

function Badge({ count, level }: { count: number; level: Alert["severity"] | null }) {
  const color =
    level === "down" ? "var(--down)" :
    level === "warn" ? "var(--warn)" :
    level === "info" ? "var(--info)" :
    "var(--accent)";
  return (
    <span
      className="mono"
      style={{
        position: "absolute",
        top: -3,
        right: -3,
        minWidth: 15,
        height: 15,
        padding: "0 3px",
        borderRadius: 999,
        background: color,
        color: "white",
        fontSize: 9.5,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1.5px solid var(--panel)",
        lineHeight: 1
      }}
    >
      {count}
    </span>
  );
}

function BellIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 8a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
