// src/modules/homeVisits/ReasonsField.tsx
// Motivos da visita (módulo 24b): caixas por grupo do domínio (`fieldset` com `legend` = `group_label`), na ordem do domínio. Só com
// visita realizada (quem chama decide). Indisponível fica desabilitado com o porquê ao lado; ao chegar em `reasons_max` (Q36) as
// caixas não marcadas param. Recusa do api em `reasons[i]` marca a caixa do i-ésimo motivo escolhido; em `reasons`, o grupo todo.
import type { ReactNode } from "react";
import { REASONS_MAX_TEXT, type OfferedReason } from "../../lib/homeVisits";
import { checkLabel, fieldset, legend, muted } from "../exams/styles";

type Aria = { "aria-invalid"?: true; "aria-describedby"?: string };

export function ReasonsField({ offered, chosen, max, disabled, onToggle, aria, errNode }: {
  offered: OfferedReason[]; chosen: number[]; max: number; disabled: boolean; onToggle(code: number): void;
  aria(path: string): Aria; errNode(path: string): ReactNode;
}) {
  const full = chosen.length >= max;
  const groups = offered.reduce<{ key: string; label: string; rows: OfferedReason[] }[]>((acc, r) => {
    const g = acc.find((x) => x.key === r.group);
    if (g) g.rows.push(r); else acc.push({ key: r.group, label: r.group_label, rows: [ r ] });
    return acc;
  }, []);
  return (
    <fieldset data-reasons="true" style={fieldset} {...aria("reasons")}>
      <legend style={legend}>Motivos da visita</legend>
      {full && <p role="status" style={muted}>{REASONS_MAX_TEXT(max)}</p>}
      {errNode("reasons")}
      {groups.map((g) => (
        <fieldset key={g.key} style={{ ...fieldset, padding: 8 }}>
          <legend style={{ ...legend, fontWeight: 500 }}>{g.label}</legend>
          {g.rows.map((r) => {
            const checked = chosen.includes(r.code);
            const at = chosen.indexOf(r.code);
            const path = `reasons[${at}]`;
            const why = r.disabled ? `reason-why-${r.code}` : undefined;
            const own = at >= 0 ? aria(path) : {};
            const describedBy = [ why, own["aria-describedby"] ].filter(Boolean).join(" ") || undefined;
            return (
              <div key={r.code} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <label style={checkLabel}>
                  <input type="checkbox" checked={checked} disabled={disabled || !!r.disabled || (full && !checked)}
                    aria-invalid={own["aria-invalid"]} aria-describedby={describedBy} onChange={() => onToggle(r.code)} />
                  {r.label}
                </label>
                {r.disabled && <span id={why} style={muted}>{r.disabled}</span>}
                {at >= 0 && errNode(path)}
              </div>
            );
          })}
        </fieldset>
      ))}
    </fieldset>
  );
}
