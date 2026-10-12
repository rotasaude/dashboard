// Chip estático de cidade (single-tenant), extraído do AppHeader.
import type { SessionUser } from "../lib/api";

export function TenantChip({ user }: { user: SessionUser | null }) {
  if (!user) return null;
  const m = user.memberships[0];
  if (!m) return null;
  const label = m.city_uf ? `${m.city_name} · ${m.city_uf}` : m.city_name;
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
