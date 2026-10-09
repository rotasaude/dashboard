// src/modules/consultation/ProblemsEditor.tsx
// Lista de problemas na consulta (módulo 19; spec §3 e §7; ADR 0031): o
// profissional avalia, resolve ou corrige o início dos problemas ativos e
// inclui novos pela busca CIAP-2 (ou CID-10, quando o CBO pode). A lista do
// paciente só muda pelo api, na finalização ou no adendo; aqui se monta o
// pedido (`evaluated_problems`).
import { useState, type CSSProperties } from "react";
import { searchTerminology, type CodedOption, type EvaluatedProblem, type PatientProblem, type Terminology } from "../../lib/api";
import {
  ACTION_LABEL, TERMINOLOGY_LABEL, addProblem, consultationError, correctOnset, markProblem, onsetLabel, problemKey,
  removeItem, setItemOnset
} from "../../lib/consultation";
import { Tag } from "../../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CodeSearch } from "./CodeSearch";
import { OnsetInput } from "./OnsetInput";

interface Props {
  patientProblems: PatientProblem[];
  items: EvaluatedProblem[];
  onChange(next: EvaluatedProblem[]): void;
  cid10Allowed: boolean;
  today: string;
  searchDelayMs?: number;
}

export function ProblemsEditor({ patientProblems, items, onChange, cid10Allowed, today, searchDelayMs }: Props) {
  const [ terminology, setTerminology ] = useState<Terminology>("ciap2");
  const [ editingOnset, setEditingOnset ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const active = patientProblems.filter((p) => p.status === "active");
  const added = items.filter((i) => i.problem_id === null);

  function pick(ref: CodedOption) {
    const result = addProblem(items, patientProblems, terminology, ref);
    setNotice(result.notice);
    if (result.items !== items) onChange(result.items);
  }

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Problemas e condições</legend>
      {notice && <p role="status" style={muted}>{notice}</p>}

      <strong style={sub}>Lista do paciente</strong>
      {active.length === 0 ? <p style={muted}>nenhum problema ativo</p> : (
        <ul aria-label="problemas ativos do paciente" style={list}>
          {active.map((p) => {
            const item = items.find((i) => i.problem_id === p.id);
            return (
              <li key={p.id} style={row}>
                <span><span className="mono">{p.code}</span>{` — ${p.label} · ${onsetLabel(p.onset_on, p.onset_precision)}`}</span>
                {item && <Tag tone="info">{ACTION_LABEL[item.action]}</Tag>}
                {item?.action === "correct_onset" && (
                  <span style={muted}>{`novo início: ${onsetLabel(item.onset_on, item.onset_precision)}`}</span>
                )}
                <span style={actions}>
                  <button type="button" aria-label={`Avaliar ${p.code}`} style={secondaryButtonStyle}
                    onClick={() => onChange(markProblem(items, p, "evaluate"))}>Avaliar</button>
                  <button type="button" aria-label={`Resolver ${p.code}`} style={secondaryButtonStyle}
                    onClick={() => onChange(markProblem(items, p, "resolve"))}>Resolver</button>
                  <button type="button" aria-label={`Corrigir início ${p.code}`} style={secondaryButtonStyle}
                    onClick={() => setEditingOnset(p.id)}>Corrigir início</button>
                  {item && (
                    <button type="button" aria-label={`Desfazer ${p.code}`} style={secondaryButtonStyle}
                      onClick={() => onChange(removeItem(items, problemKey(item)))}>Desfazer</button>
                  )}
                </span>
                {editingOnset === p.id && (
                  <OnsetInput code={p.code} today={today}
                    initial={p.onset_on && p.onset_precision ? { onset_on: p.onset_on, onset_precision: p.onset_precision } : null}
                    onApply={(onset) => { onChange(correctOnset(items, p, onset)); setEditingOnset(null); }}
                    onCancel={() => setEditingOnset(null)} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <strong style={sub}>Incluídos nesta consulta</strong>
      {added.length === 0 ? <p style={muted}>nenhum problema novo</p> : (
        <ul aria-label="problemas incluídos nesta consulta" style={list}>
          {added.map((i) => {
            const key = problemKey(i);
            return (
              <li key={key} style={row}>
                <span>
                  <span className="mono">{i.code}</span>
                  {` — ${i.label} · ${TERMINOLOGY_LABEL[i.terminology]} · ${onsetLabel(i.onset_on, i.onset_precision)}`}
                </span>
                <span style={actions}>
                  <button type="button" aria-label={`Informar início ${i.code}`} style={secondaryButtonStyle}
                    onClick={() => setEditingOnset(key)}>Informar início</button>
                  <button type="button" aria-label={`Remover ${i.code}`} style={secondaryButtonStyle}
                    onClick={() => onChange(removeItem(items, key))}>Remover</button>
                </span>
                {editingOnset === key && (
                  <OnsetInput code={i.code} today={today}
                    onApply={(onset) => { onChange(setItemOnset(items, key, onset)); setEditingOnset(null); }}
                    onCancel={() => setEditingOnset(null)} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <label style={{ ...labelStyle, maxWidth: 200 }}>
        Terminologia
        <select value={terminology} style={inputStyle} onChange={(e) => setTerminology(e.target.value as Terminology)}>
          <option value="ciap2">CIAP-2</option>
          {cid10Allowed && <option value="cid10">CID-10</option>}
        </select>
      </label>
      <CodeSearch key={terminology} label={`Incluir problema (${TERMINOLOGY_LABEL[terminology]})`}
        placeholder="nome ou código, ex.: diabetes, T90" queryKey={`terminologySearch:${terminology}`}
        search={(q) => searchTerminology(q, terminology)} errorText={consultationError} onPick={pick} delayMs={searchDelayMs} />
    </fieldset>
  );
}

const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--rule)", borderRadius: 8, padding: 12 };
const legend: CSSProperties = { fontSize: 12.5, fontWeight: 600 };
const sub: CSSProperties = { fontSize: 12 };
const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 };
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12.5 };
const actions: CSSProperties = { display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
