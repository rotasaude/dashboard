// src/modules/protocolEditor/UrgencyLevelsPanel.tsx
// Painel "Cores e tempos máximos" do protocolo de classificação de risco
// (módulo 32a; contrato §14 Q1). As 5 cores são fixas, na ordem: só o tempo
// muda. Lê `levels` da definição a cada render e devolve uma definição nova a
// cada edição, como o painel de regras. Conteúdo assinado (ADR 0016).
import { useState, type CSSProperties, type ReactNode } from "react";
import type { UrgencyColor } from "../../lib/api";
import { URGENCY_COLOR_LABEL, URGENCY_COLOR_TONE } from "../../lib/urgency";
import { LEVEL_TIME_TEXT, levelProblem, readLevels, writeLevels } from "../../lib/urgencyRules";
import { Tag } from "../../components/Tag";
import { inputStyle } from "../../components/formStyles";

interface Props { definition: unknown | null; onChange(next: unknown): void }

// Texto digitado que ainda não é número (vazio, "abc") fica só aqui, com o
// problema embaixo; o JSON guarda o último número digitado.
const parseMinutes = (text: string): number | null => (text.trim() === "" || !Number.isFinite(Number(text)) ? null : Number(text));

export function UrgencyLevelsPanel({ definition, onChange }: Props) {
  const [ drafts, setDrafts ] = useState<Partial<Record<UrgencyColor, string>>>({});
  if (definition === null) return <Section><p style={hint}>Corrija o JSON para editar as cores e os tempos.</p></Section>;
  const read = readLevels(definition);
  if (!read.ok) return <Section><p role="alert" style={alert}>{read.reason}</p></Section>;
  const levels = read.levels;

  // O rascunho vale enquanto for o que está no JSON (ou ainda não for número);
  // mudança feita direto no JSON prevalece.
  const shown = (color: UrgencyColor, value: number): string => {
    const d = drafts[color];
    if (d === undefined) return String(value);
    const n = parseMinutes(d);
    return n === null || n === value ? d : String(value);
  };

  function edit(i: number, text: string) {
    const color = levels[i].color;
    setDrafts((prev) => ({ ...prev, [color]: text }));
    const n = parseMinutes(text);
    if (n !== null) onChange(writeLevels(definition, levels.map((l, j) => (j === i ? { ...l, max_wait_minutes: n } : l))));
  }

  return (
    <Section>
      <p style={hint}>Vale para o estouro na fila e para o painel do gestor.</p>
      {levels.map((l, i) => {
        const label = URGENCY_COLOR_LABEL[l.color];
        const text = shown(l.color, l.max_wait_minutes);
        const problem = parseMinutes(text) === null ? LEVEL_TIME_TEXT : levelProblem(l, levels[i - 1]);
        const id = `urgency-level-${l.color}`;
        return (
          <div key={l.color} role="group" aria-label={`nível ${label}`} style={row}>
            <Tag tone={URGENCY_COLOR_TONE[l.color]} mono={false}>{label}</Tag>
            <label htmlFor={id} style={fieldLabel}>
              {`Tempo máximo do ${label} (min)`}
              <input id={id} inputMode="numeric" value={text} style={{ ...inputStyle, maxWidth: 120 }}
                aria-invalid={problem !== null} aria-describedby={problem ? `${id}-problem` : undefined}
                onChange={(e) => edit(i, e.target.value)} />
            </label>
            {problem && <small id={`${id}-problem`} style={alert}>{problem}</small>}
          </div>
        );
      })}
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section aria-label="Cores e tempos máximos" style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</section>;
}

const fieldLabel: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
const row: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: 10, border: "1px solid var(--rule)", borderRadius: 8 };
