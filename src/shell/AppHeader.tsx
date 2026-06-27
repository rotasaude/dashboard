// Header do dashboard: nav por módulo + seletor de período + usuário/logout.
// Sem ScopePicker (single-tenant).
import { NAV_GROUPS, type ModuleId } from "./modules";
import { PERIOD_OPTIONS, useScope } from "../lib/scope";
import { useAuth } from "../lib/auth";

interface Props { active: ModuleId; onSelect: (id: ModuleId) => void; }

export function AppHeader({ active, onSelect }: Props) {
  const scope = useScope();
  const auth = useAuth();
  const items = NAV_GROUPS.flatMap(g => g.items);
  return (
    <header style={{ borderBottom: "1px solid var(--line, #e6e6e6)", padding: "10px 24px",
      display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <strong style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 13 }}>
        Rota Saúde — Dashboard
      </strong>
      <nav style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {items.map(item => (
          <button key={item.id} onClick={() => onSelect(item.id)}
            aria-current={active === item.id ? "page" : undefined}
            style={{ border: "none", cursor: "pointer", padding: "4px 10px", borderRadius: 6,
              fontSize: 12, background: active === item.id ? "var(--accent-soft, #eef)" : "transparent",
              color: active === item.id ? "var(--accent, #2b59ff)" : "var(--ink2, #444)" }}>
            <span style={{ marginRight: 6 }}>{item.icon}</span>{item.label}
          </button>
        ))}
      </nav>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {PERIOD_OPTIONS.map(p => (
          <button key={p.key} onClick={() => scope.setPeriod(p.key)}
            aria-pressed={scope.period === p.key}
            style={{ border: "1px solid var(--line, #e6e6e6)", cursor: "pointer", padding: "4px 10px",
              borderRadius: 6, fontSize: 12,
              background: scope.period === p.key ? "var(--accent-soft, #eef)" : "transparent",
              color: scope.period === p.key ? "var(--accent, #2b59ff)" : "var(--ink2, #444)" }}>
            {p.label}
          </button>
        ))}
        {auth.user && (
          <>
            <span style={{ fontSize: 11, color: "var(--ink3, #888)" }}>{auth.user.email_address}</span>
            <button onClick={() => void auth.logout()}
              style={{ border: "1px solid var(--line, #e6e6e6)", cursor: "pointer", padding: "4px 10px",
                borderRadius: 6, fontSize: 12, background: "transparent", color: "var(--ink2, #444)" }}>
              Sair
            </button>
          </>
        )}
      </div>
    </header>
  );
}
