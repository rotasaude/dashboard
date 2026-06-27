// AppHeader — navbar sticky (NAVBAR.md §1).
// 4 zonas: marca · divisor · nav (grupos com dropdown) · controles à direita
// (cidade, período, divisor, sino, relógio, usuário).
//
// Adaptações vs. admin:
// - Subtítulo: "Dashboard" (não "Admin Console")
// - Sem ScopePicker: cidade lida da sessão (single-tenant) como chip estático
// - Nav sem filtro de visibilidade (NavItem do dashboard não tem `visible`)
// - Único dropdown de nav aberto por vez: estado vive aqui e desce para
//   NavDropdown via props (NAVBAR.md §3.4).

import { useEffect, useRef, useState } from "react";
import { NavDropdown } from "./NavDropdown";
import { SegmentedControl } from "./SegmentedControl";
import { NotificationCenter } from "./NotificationCenter";
import { NAV_GROUPS, type ModuleId } from "./modules";
import { PERIOD_OPTIONS, useScope } from "../lib/scope";
import type { Alert } from "../lib/alerts";
import { useAuth } from "../lib/auth";

interface Props {
  active: ModuleId;
  onSelect: (id: ModuleId) => void;
  alerts: { active: Alert[]; limitations: Alert[] };
}

export function AppHeader({ active, onSelect, alerts }: Props) {
  const scope = useScope();
  const auth = useAuth();
  const [ openGroup, setOpenGroup ] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  // Click-fora + Esc fecham qualquer dropdown de nav aberto.
  useEffect(() => {
    if (!openGroup) return;
    function onDoc(e: MouseEvent) {
      if (!navRef.current?.contains(e.target as Node)) setOpenGroup(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenGroup(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ openGroup ]);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "var(--panel)",
        borderBottom: "1px solid var(--rule)",
        flexShrink: 0
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "10px 22px",
          width: "100%"
        }}
      >
        <Brand />
        <VerticalDivider height={26} />

        <nav
          ref={navRef}
          data-navroot
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flex: 1,
            minWidth: 0
          }}
        >
          {NAV_GROUPS.map((g) => {
            // Dashboard's NavItem has no `visible` field — render all items.
            const items = g.items;
            if (items.length === 0) return null;
            return (
              <NavDropdown
                key={g.label}
                label={g.label}
                items={items}
                active={active}
                isOpen={openGroup === g.label}
                onToggle={() => setOpenGroup((cur) => (cur === g.label ? null : g.label))}
                onClose={() => setOpenGroup(null)}
                onSelect={onSelect}
              />
            );
          })}
        </nav>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0
          }}
        >
          <TenantChip user={auth.user} />
          <SegmentedControl
            options={PERIOD_OPTIONS}
            value={scope.period}
            onChange={scope.setPeriod}
          />
          <VerticalDivider height={22} />
          <NotificationCenter
            active={alerts.active}
            limitations={alerts.limitations}
            onNavigate={onSelect}
          />
          <LiveClock />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

// ─── Chip estático de cidade (single-tenant) ──────────────────────────────────

function TenantChip({ user }: { user: import("../lib/api").SessionUser | null }) {
  if (!user) return null;
  const m = user.memberships[0];
  if (!m) return null;
  const label = m.municipality_uf ? `${m.municipality_name} · ${m.municipality_uf}` : m.municipality_name;
  return (
    <span
      className="mono"
      style={{
        padding: "5px 10px",
        background: "var(--sunken)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        fontSize: 11,
        color: "var(--ink3)",
        whiteSpace: "nowrap",
        flexShrink: 0
      }}
    >
      {label}
    </span>
  );
}

// ─── Menu do usuário (email + logout) ────────────────────────────────────────

function UserMenu() {
  const auth = useAuth();
  const [ open, setOpen ] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ open ]);

  if (!auth.user) return null;
  const initials = auth.user.email_address.slice(0, 2).toUpperCase();

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conta"
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: open ? "var(--sunken)" : "var(--ink)",
          color: open ? "var(--ink)" : "var(--panel)",
          border: open ? "1px solid var(--rule2)" : "none",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.4,
          cursor: "pointer"
        }}
      >
        {initials}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 30,
            width: 240,
            background: "var(--panel)",
            border: "1px solid var(--rule2)",
            borderRadius: 12,
            padding: 8,
            boxShadow: "var(--shadow-dropdown)"
          }}
        >
          <div
            className="mono"
            style={{
              padding: "8px 10px",
              fontSize: 11,
              color: "var(--ink2)",
              borderBottom: "1px solid var(--rule)",
              marginBottom: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
          >
            {auth.user.email_address}
          </div>
          <button
            role="menuitem"
            onClick={() => { setOpen(false); void auth.logout(); }}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 7,
              border: "none",
              background: "transparent",
              textAlign: "left",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              fontSize: 12.5,
              color: "var(--ink2)"
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--sunken)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Marca (NAVBAR.md §2) ────────────────────────────────────────────────────

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          background: "var(--ink)",
          color: "var(--panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0
        }}
      >
        <CompassPath />
      </div>
      <div style={{ lineHeight: 1.12 }}>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            fontWeight: 700,
            color: "var(--ink)"
          }}
        >
          Rota Saúde
        </div>
        <div
          className="mono"
          style={{
            marginTop: 1,
            fontSize: 10.5,
            color: "var(--ink3)",
            textTransform: "uppercase",
            letterSpacing: 0.8
          }}
        >
          Dashboard
        </div>
      </div>
    </div>
  );
}

function CompassPath() {
  return (
    <svg width="19" height="19" viewBox="0 0 48 48" fill="none" stroke="currentColor">
      <circle cx="24" cy="24" r="18" strokeWidth="3" />
      <path
        d="M8 24 H16 L19 18 L24 30 L29 18 L32 24 H40"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Divisor vertical ────────────────────────────────────────────────────────

function VerticalDivider({ height }: { height: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height,
        background: "var(--rule)",
        flexShrink: 0
      }}
    />
  );
}

// ─── Relógio "ao vivo" (NAVBAR.md §4.5) ──────────────────────────────────────

function LiveClock() {
  const [ time, setTime ] = useState(() => formatNow());
  useEffect(() => {
    const id = setInterval(() => setTime(formatNow()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "5px 10px",
        background: "var(--sunken)",
        border: "1px solid var(--rule)",
        borderRadius: 8,
        flexShrink: 0
      }}
      aria-live="off"
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: "var(--ok)",
          color: "var(--ok)",
          animation: "pulse-dot 1.6s ease-in-out infinite",
          flexShrink: 0
        }}
      />
      <span className="mono" style={{ fontSize: 11, color: "var(--ink3)", whiteSpace: "nowrap" }}>
        {time} <span style={{ color: "var(--ink4)" }}>BRT</span>
      </span>
    </span>
  );
}

function formatNow(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date());
}
