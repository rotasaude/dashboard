// src/modules/protocols/ConditionBuilder.tsx
// Construtor visual de condições (módulo 15; spec §7). Um componente só para
// a elegibilidade, as sugestões e a restrição da cidade: o que muda entre
// eles é a lista de campos (fieldsFor). A frase em português fica sempre à
// vista; árvore fora do subconjunto aparece como "regra avançada", só em frase.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ConditionTree } from "../../lib/api";
import {
  OP_LABELS, appendTo, fromTree, newGroup, newRow, opsFor, removeNode, rowProblem, toTree, treeKey, updateNode, withOp,
  type ConditionField, type ConditionGroup, type ConditionNode, type ConditionRow, type ParsedCondition, type RowOp
} from "../../lib/condition";
import { describeCondition } from "../../lib/conditionPhrase";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";

export interface ConditionBuilderProps {
  label: string;
  fields: ConditionField[];
  value: unknown;
  emptyText: string;
  onChange(next: ConditionTree | null): void;
}

type Fields = Map<string, ConditionField>;

export function ConditionBuilder({ label, fields, value, emptyText, onChange }: ConditionBuilderProps) {
  const [ parsed, setParsed ] = useState<ParsedCondition>(() => fromTree(value, fields));
  const emitted = useRef(treeKey(value));
  const fieldsKey = fields.map((f) => f.id).join("|");
  const seenFields = useRef(fieldsKey);

  // Relê só o que não veio daqui: o eco do próprio onChange não pode apagar
  // uma linha incompleta que ainda não tem árvore.
  useEffect(() => {
    const key = treeKey(value);
    const fieldsChanged = seenFields.current !== fieldsKey;
    seenFields.current = fieldsKey;
    if (key === emitted.current && !(fieldsChanged && !parsed.ok)) return;
    emitted.current = key;
    setParsed(fromTree(value, fields));
  }, [ value, fieldsKey ]);

  function emit(root: ConditionGroup) {
    setParsed({ ok: true, root });
    const tree = toTree(root);
    emitted.current = treeKey(tree);
    onChange(tree);
  }

  const byId: Fields = new Map(fields.map((f) => [ f.id, f ]));
  const sentence = describeCondition(parsed.ok ? toTree(parsed.root) : value, fields, emptyText);

  return (
    <fieldset aria-label={label} style={box}>
      <legend style={legend}>{label}</legend>
      <p style={phraseStyle}><span style={{ color: "var(--ink3)" }}>Em frase: </span>{sentence}</p>
      {!parsed.ok && <p style={hint}>Regra avançada: o construtor não edita esta regra. Altere no JSON.</p>}
      {parsed.ok && (
        <GroupEditor group={parsed.root} root={parsed.root} isRoot index={0} fields={fields} byId={byId} onRoot={emit} />
      )}
    </fieldset>
  );
}

interface EditorProps { root: ConditionGroup; fields: ConditionField[]; byId: Fields; onRoot(root: ConditionGroup): void }

function GroupEditor({ group, root, isRoot, index, fields, byId, onRoot }:
  EditorProps & { group: ConditionGroup; isRoot: boolean; index: number }) {
  const set = (fn: (g: ConditionGroup) => ConditionGroup) =>
    onRoot(updateNode(root, group.key, (n) => fn(n as ConditionGroup)));
  const first = fields[0];

  return (
    <div role="group" aria-label={isRoot ? "regras" : `grupo ${index}`} style={isRoot ? stack : subgroup}>
      <div style={line}>
        <select aria-label="combinar" value={group.mode} style={select}
          onChange={(e) => set((g) => ({ ...g, mode: e.target.value as "all" | "any" }))}>
          <option value="all">todas (E)</option>
          <option value="any">qualquer uma (OU)</option>
        </select>
        <label style={small}>
          <input type="checkbox" checked={group.negated} onChange={(e) => set((g) => ({ ...g, negated: e.target.checked }))} />
          {isRoot ? "NÃO (negar tudo)" : "NÃO (negar o grupo)"}
        </label>
        {!isRoot && (
          <button type="button" style={secondaryButtonStyle} onClick={() => onRoot(removeNode(root, group.key))}>remover grupo</button>
        )}
      </div>
      {group.children.map((child: ConditionNode, i) => (child.kind === "row"
        ? <RowEditor key={child.key} row={child} n={i + 1} root={root} fields={fields} byId={byId} onRoot={onRoot} />
        : <GroupEditor key={child.key} group={child} root={root} isRoot={false} index={i + 1} fields={fields} byId={byId} onRoot={onRoot} />))}
      <div style={line}>
        <button type="button" style={secondaryButtonStyle} disabled={!first}
          onClick={() => first && onRoot(appendTo(root, group.key, newRow(first)))}>+ condição</button>
        {isRoot && (
          <button type="button" style={secondaryButtonStyle} disabled={!first}
            onClick={() => first && onRoot(appendTo(root, group.key, { ...newGroup("any"), children: [ newRow(first) ] }))}>
            + grupo
          </button>
        )}
      </div>
    </div>
  );
}

function RowEditor({ row, n, root, fields, byId, onRoot }: EditorProps & { row: ConditionRow; n: number }) {
  const field = byId.get(row.field);
  const set = (next: ConditionRow) => onRoot(updateNode(root, row.key, () => next));
  const problem = rowProblem(row, field);
  const groups = [ ...new Set(fields.map((f) => f.group)) ];

  return (
    <div role="group" aria-label={`condição ${n}`} style={rowBox}>
      <select aria-label="campo" value={row.field} style={select}
        onChange={(e) => {
          const next = byId.get(e.target.value);
          if (next) set({ ...newRow(next), key: row.key, negated: row.negated });
        }}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {fields.filter((f) => f.group === g).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </optgroup>
        ))}
      </select>
      {field && (
        <select aria-label="operador" value={row.op} style={select}
          onChange={(e) => set(withOp(row, e.target.value as RowOp, field))}>
          {opsFor(field.kind).map((op) => <option key={op} value={op}>{OP_LABELS[op]}</option>)}
        </select>
      )}
      {field && <ValueEditor row={row} field={field} onChange={set} />}
      <label style={small}>
        <input type="checkbox" checked={row.negated} onChange={(e) => set({ ...row, negated: e.target.checked })} />
        NÃO
      </label>
      <button type="button" style={secondaryButtonStyle} onClick={() => onRoot(removeNode(root, row.key))}>remover</button>
      {problem && <small style={hint}>{problem}</small>}
    </div>
  );
}

function numberOrNull(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function ValueEditor({ row, field, onChange }: { row: ConditionRow; field: ConditionField; onChange(next: ConditionRow): void }) {
  const unit = field.unit ? <span style={small}>{field.unit.trim()}</span> : null;

  if (row.op === "between") {
    return (
      <>
        <input type="number" aria-label="de" value={row.value[0] ?? ""} style={numberInput}
          onChange={(e) => onChange({ ...row, value: [ numberOrNull(e.target.value), row.value[1] ] })} />
        <span style={small}>e</span>
        <input type="number" aria-label="até" value={row.value[1] ?? ""} style={numberInput}
          onChange={(e) => onChange({ ...row, value: [ row.value[0], numberOrNull(e.target.value) ] })} />
        {unit}
      </>
    );
  }
  if (row.op === "gte" || row.op === "lte" || row.op === "eq") {
    return (
      <>
        <input type="number" aria-label="valor" value={row.value ?? ""} style={numberInput}
          onChange={(e) => onChange({ ...row, value: numberOrNull(e.target.value) })} />
        {unit}
      </>
    );
  }
  if (row.op === "is") {
    return (
      <select aria-label="valor" value={row.value} style={select} onChange={(e) => onChange({ ...row, value: e.target.value })}>
        {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  if (row.op === "in" && field.codes) return <CodesInput row={row} example={field.codes.example} onChange={onChange} />;

  // Opção inativa só aparece se já estiver marcada (bairro desativado depois
  // da regra); valor que nem existe na lista aparece como "fora da lista".
  if (row.op !== "in") return null;
  const picked = row.value;
  const known = field.options ?? [];
  const unknown = picked.filter((v) => !known.some((o) => o.value === v)).map((v) => ({ value: v, label: `${v} (fora da lista)` }));
  const shown = [ ...known.filter((o) => !o.inactive || picked.includes(o.value)), ...unknown ];
  if (shown.length === 0) return <small style={hint}>nenhuma opção disponível</small>;
  return (
    <span role="group" aria-label="valores" style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
      {shown.map((o) => (
        <label key={o.value} style={small}>
          <input type="checkbox" checked={picked.includes(o.value)}
            onChange={(e) => onChange({
              ...row, value: e.target.checked ? [ ...picked, o.value ] : picked.filter((v) => v !== o.value)
            })} />
          {o.label}
        </label>
      ))}
    </span>
  );
}

// Códigos digitados (CIAP-2): o texto fica local; a lista vai em maiúsculas,
// sem repetir. Código fora do padrão aparece no motivo da linha (rowProblem).
function CodesInput({ row, example, onChange }: {
  row: Extract<ConditionRow, { op: "in" }>; example: string; onChange(next: ConditionRow): void;
}) {
  const [ text, setText ] = useState(row.value.join(", "));
  return (
    <input aria-label="códigos" value={text} placeholder={example} style={{ ...inputStyle, width: 160, marginTop: 0, padding: 6, fontSize: 12.5 }}
      onChange={(e) => {
        setText(e.target.value);
        const codes = e.target.value.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter((c) => c !== "");
        onChange({ ...row, value: [ ...new Set(codes) ] });
      }} />
  );
}

const box: CSSProperties = { border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0, display: "flex", flexDirection: "column", gap: 8 };
const legend: CSSProperties = { fontSize: 13, fontWeight: 600 };
const phraseStyle: CSSProperties = { margin: 0, fontSize: 12.5 };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const stack: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const subgroup: CSSProperties = { ...stack, padding: 8, borderLeft: "3px solid var(--rule2)", background: "var(--sunken)", borderRadius: 6 };
const line: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const rowBox: CSSProperties = { ...line, paddingBottom: 6, borderBottom: "1px dashed var(--rule)" };
const small: CSSProperties = { fontSize: 12, color: "var(--ink2)", display: "inline-flex", gap: 4, alignItems: "center" };
const select: CSSProperties = { ...inputStyle, width: "auto", marginTop: 0, padding: 6, fontSize: 12.5 };
const numberInput: CSSProperties = { ...inputStyle, width: 80, marginTop: 0, padding: 6, fontSize: 12.5 };
