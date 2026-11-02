// Mudanças do adendo da consulta odontológica (contrato §4, O14): achado novo e, só para o dentista, cancelamento de item do
// plano. Nada de procedimento novo. O plano é lido (com trilha) no clique em "Ver plano", nunca sozinho.
import { useEffect, useRef, useState } from "react";
import { listDentalPlans, type Consultation, type DentalFinding, type DentalPlan, type DentalVocabulary, type PlanCancel, type ToothFace } from "../../lib/api";
import { chartRows, dentalError, dentalRole, FACE_LABEL, FACES, locationLabel, reasonProblem, situationsFor } from "../../lib/dental";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, list } from "../exams/styles";
import { findingText } from "./DentalSummary";

export interface DentalAddendumValue { findings: DentalFinding[]; cancel: PlanCancel[] }
interface Props {
  consultation: Consultation;
  value: DentalAddendumValue;
  situations?: DentalVocabulary["situations"];
  // Unidade do atendimento; sem ela, planos de todas as unidades (agrupados pelo nome).
  unitId?: string;
  // Muda quando o api recusa um item (já não está aberto): relê o plano.
  refreshKey?: number;
  onChange(v: DentalAddendumValue): void;
}

const TEETH = chartRows("mixed").flat();

export function DentalAddendumFields({ consultation: c, value, situations, unitId, refreshKey = 0, onChange }: Props) {
  const isDentist = dentalRole(c.cbo_code) === "dentist";
  const [ tooth, setTooth ] = useState("");
  const [ face, setFace ] = useState<ToothFace | "">("");
  const [ situation, setSituation ] = useState("");
  const [ plans, setPlans ] = useState<DentalPlan[] | null>(null);
  const [ loading, setLoading ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ cancelling, setCancelling ] = useState<string | null>(null);
  const [ reason, setReason ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);

  const options = tooth ? situationsFor(face ? "face" : "crown", situations, tooth) : [];

  function addFinding() {
    if (!tooth || !situation) return;
    const f: DentalFinding = { tooth, face: face || null, part: "crown", situation };
    const same = (x: DentalFinding) => x.tooth === f.tooth && x.face === f.face && x.part === f.part;
    onChange({ ...value, findings: [ ...value.findings.filter((x) => !same(x)), f ] });
    setSituation("");
  }
  const readRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { if (refreshKey > 0) void readRef.current(); }, [ refreshKey ]);
  async function readPlan() {
    setLoading(true); setError(null);
    try {
      setPlans(await listDentalPlans(c.patient_id, { status: "open", healthUnitId: unitId }));
    } catch (err) {
      setError(dentalError(err));
    } finally {
      setLoading(false);
    }
  }
  readRef.current = readPlan;
  function closeCancel() { setCancelling(null); setReason(""); setProblem(null); }
  function confirm(itemId: string) {
    const p = reasonProblem(reason);
    if (p) { setProblem(p); return; }
    onChange({ ...value, cancel: [ ...value.cancel.filter((x) => x.item_id !== itemId), { item_id: itemId, reason: reason.trim() } ] });
    closeCancel();
  }
  const groups = (plans ?? []).map((p) => ({ plan: p, items: p.items.filter((i) => i.status === "planned") })).filter((g) => g.items.length > 0);
  const items = groups.flatMap((g) => g.items);
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? "item do plano";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <fieldset style={box}>
        <legend style={{ fontSize: 12.5, fontWeight: 600 }}>Achado novo</legend>
        <div style={row}>
          <label style={fieldLabel}>
            Dente
            <select value={tooth} style={inputStyle} onChange={(e) => { setTooth(e.target.value); setSituation(""); }}>
              <option value="">—</option>
              {TEETH.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Face
            <select value={face} style={inputStyle} onChange={(e) => { setFace(e.target.value as ToothFace | ""); setSituation(""); }}>
              <option value="">Dente inteiro</option>
              {FACES.map((f) => <option key={f} value={f}>{FACE_LABEL[f]}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Situação
            <select value={situation} style={inputStyle} onChange={(e) => setSituation(e.target.value)}>
              <option value="">—</option>
              {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div><button type="button" style={buttonStyle} disabled={!tooth || !situation} onClick={addFinding}>Acrescentar achado</button></div>
        {value.findings.length > 0 && (
          <ul aria-label="achados do adendo" style={list}>
            {value.findings.map((f, i) => (
              <li key={i}>
                {findingText(f, situations)}{" "}
                <button type="button" style={secondaryButtonStyle} aria-label={`Remover achado — ${findingText(f, situations)}`}
                  onClick={() => onChange({ ...value, findings: value.findings.filter((_, n) => n !== i) })}>Remover</button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {isDentist && (
        <fieldset style={box}>
          <legend style={{ fontSize: 12.5, fontWeight: 600 }}>Cancelar item do plano</legend>
          {plans === null && <div><button type="button" style={secondaryButtonStyle} disabled={loading} onClick={() => void readPlan()}>Ver plano</button></div>}
          {error && <p role="alert" style={alert}>{error}</p>}
          {plans !== null && items.length === 0 && <p style={muted}>Nenhum item planejado em aberto.</p>}
          {groups.map(({ plan: p, items: planItems }) => (
            <div key={p.id} role="group" aria-label={unitId ? undefined : `Plano — ${p.health_unit.name}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!unitId && <strong style={{ fontSize: 12 }}>{p.health_unit.name}</strong>}
              {planItems.map((i) => (
            <div key={i.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12.5 }}><span className="mono">{i.sigtap}</span> {i.name ?? ""} · {locationLabel(i.location)}</span>
              {cancelling !== i.id && !value.cancel.some((x) => x.item_id === i.id) && (
                <div><button type="button" style={secondaryButtonStyle} aria-label={`Cancelar item — ${i.name ?? i.sigtap}`}
                  onClick={() => { setCancelling(i.id); setReason(""); setProblem(null); }}>Cancelar item</button></div>
              )}
              {cancelling === i.id && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={fieldLabel}>
                    Motivo do cancelamento
                    <textarea rows={2} value={reason} style={inputStyle} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  {problem && <p role="alert" style={alert}>{problem}</p>}
                  <span style={row}>
                    <button type="button" style={buttonStyle} onClick={() => confirm(i.id)}>Confirmar cancelamento</button>
                    <button type="button" style={secondaryButtonStyle} onClick={closeCancel}>Voltar</button>
                  </span>
                </div>
              )}
            </div>
              ))}
            </div>
          ))}
          {value.cancel.length > 0 && (
            <ul aria-label="cancelamentos do adendo" style={list}>
              {value.cancel.map((x) => (
                <li key={x.item_id}>
                  {`cancelar — ${nameOf(x.item_id)}`}{" "}
                  <button type="button" style={secondaryButtonStyle} aria-label={`Desfazer cancelamento — ${nameOf(x.item_id)}`}
                    onClick={() => onChange({ ...value, cancel: value.cancel.filter((y) => y.item_id !== x.item_id) })}>Desfazer</button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}
    </div>
  );
}
