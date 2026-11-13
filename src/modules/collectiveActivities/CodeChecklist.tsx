// src/modules/collectiveActivities/CodeChecklist.tsx
// Uma lista de códigos da atividade coletiva (temas, público, práticas): um `fieldset` com uma caixa por código, na ordem do domínio.
// A regra vem do dado (`fieldRule`): `required` põe "(obrigatório)" na legenda, `forbidden` não desenha nada (quem chama já tirou
// o que estava marcado). No limite da lista (`rules.list_max`, Q36) as caixas desmarcadas ficam indisponíveis.
// As recusas do campo (`path`) e dos itens (`path[i]`) aparecem sob a lista; o grupo fica `aria-invalid` e o foco vai à 1ª caixa.
import { useId } from "react";
import type { CodeLabel, FieldRule } from "../../lib/api";
import { LIST_MAX_TEXT } from "../../lib/collectiveActivities";
import type { Problem } from "../../lib/pharmacy";
import { alert, checkLabel, fieldset, legend as legendStyle, muted } from "../exams/styles";

export function CodeChecklist({ legend, rule, codes, value, max, disabled, path, problems, onToggle }: {
  legend: string; rule: FieldRule; codes: CodeLabel[]; value: number[]; max?: number; disabled: boolean; path: string; problems: Problem[];
  onToggle(code: number): void;
}) {
  const id = useId();
  if (rule === "forbidden") return null;
  const texts = [ ...new Set(problems.filter((p) => p.path === path || p.path.startsWith(`${path}[`)).map((p) => p.text)) ];
  const full = max !== undefined && value.length >= max;
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const described = [ full ? hintId : "", texts.length > 0 ? errId : "" ].filter(Boolean).join(" ");
  return (
    <fieldset style={fieldset} {...(texts.length > 0 ? { "aria-invalid": true as const } : {})} {...(described ? { "aria-describedby": described } : {})}>
      <legend style={legendStyle}>{rule === "required" ? `${legend} (obrigatório)` : legend}</legend>
      {codes.map((c) => {
        const checked = value.includes(c.code);
        return (
          <label key={c.code} style={checkLabel}>
            <input type="checkbox" checked={checked} disabled={disabled || (full && !checked)} onChange={() => onToggle(c.code)} />
            {c.label}
          </label>
        );
      })}
      {full && <p id={hintId} style={muted}>{LIST_MAX_TEXT(max ?? 0)}</p>}
      {texts.length > 0 && (
        <div id={errId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {texts.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
        </div>
      )}
    </fieldset>
  );
}
