// Prótese na consulta odontológica (F-28.6; contrato §7, O10): pedido novo ao laboratório e instalação de pedido recebido.
// A lista nominal do paciente só é lida no clique (e relida depois de uma ação, se já estava aberta) — nunca sozinha.
// A instalação não chama o api: acrescenta o procedimento com `prosthesis_order_id` ao rascunho e vale ao finalizar.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createProsthesisOrder, listDentalLaboratories, listProsthesisOrders, searchDentalProcedures,
  type Consultation, type DentalFields, type DentalLocation, type DentalLocationKind, type DentalProcedureRef, type ProsthesisOrder
} from "../../lib/api";
import {
  LABS_KEY, STATIC_QUERY, archLoc, chartRows, dentalError, labNameProblem, locationLabel, MOUTH, prosthesisStageLabel, prosthesisStageTone, procedureLabel, withProcedure
} from "../../lib/dental";
import { fmtDay } from "../../lib/exams";
import { Tag } from "../../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, okText, panel, row } from "../exams/styles";
import { ProcedureSearch } from "./ProcedureSearch";

interface Props {
  consultation: Consultation;
  patientId: string;
  value: DentalFields;
  onChange(f: DentalFields): void;
  searchDelayMs?: number;
}

const OTHER = "other";
const ALL_TEETH = chartRows("mixed").flat();

export function ProsthesisPanel({ consultation, patientId, value, onChange, searchDelayMs }: Props) {
  const [ creating, setCreating ] = useState(false);
  const [ picked, setPicked ] = useState<DentalProcedureRef | null>(null);
  const [ lab, setLab ] = useState("");
  const [ labName, setLabName ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ orders, setOrders ] = useState<ProsthesisOrder[] | null>(null);
  const [ listError, setListError ] = useState<string | null>(null);
  const [ locations, setLocations ] = useState<Record<string, DentalLocationKind[]>>({});
  const [ installing, setInstalling ] = useState<string | null>(null);
  const [ unavailable, setUnavailable ] = useState<Record<string, true>>({});
  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const labs = useQuery({ queryKey: [ LABS_KEY ], queryFn: listDentalLaboratories, enabled: creating, ...STATIC_QUERY });

  async function load() {
    const mine = ++seq.current;
    setListError(null);
    try {
      const page = await listProsthesisOrders({ patientId, stage: null, before: null });
      if (!alive.current || mine !== seq.current) return;
      setOrders(page.orders);
      resolveLocations(page.orders.filter((o) => o.stage === "received"));
    } catch (e) {
      if (alive.current && mine === seq.current) setListError(dentalError(e));
    }
  }

  // Os locais aceitos vêm do SIGTAP do pedido (busca pelo código, conferido pelo mesmo código). Só o resultado achado fica
  // guardado: falha ou ausência não é lembrada, e a próxima leitura da lista tenta de novo.
  function resolveLocations(received: ProsthesisOrder[]) {
    for (const o of received) {
      if (locations[o.sigtap]) continue;
      setUnavailable((prev) => { const rest = { ...prev }; delete rest[o.sigtap]; return rest; });
      const fail = () => { if (alive.current) setUnavailable((prev) => ({ ...prev, [o.sigtap]: true })); };
      searchDentalProcedures(o.sigtap).then((list) => {
        const hit = list.find((r) => r.sigtap === o.sigtap);
        if (!alive.current) return;
        if (hit && hit.locations.length > 0) setLocations((prev) => ({ ...prev, [o.sigtap]: hit.locations }));
        else fail();
      }).catch(fail);
    }
  }

  function resetForm() { setCreating(false); setPicked(null); setLab(""); setLabName(""); setProblem(null); }

  async function submit() {
    if (!picked) { setProblem("escolha o procedimento da prótese"); return; }
    if (!lab) { setProblem("escolha o laboratório"); return; }
    if (lab === OTHER) {
      const p = labNameProblem(labName);
      if (p) { setProblem(p); return; }
    }
    setBusy(true); setProblem(null); setDone(null);
    try {
      await createProsthesisOrder({
        patient_id: patientId, consultation_id: consultation.id, sigtap: picked.sigtap,
        laboratory: lab === OTHER ? { name: labName.trim() } : { care_provider_id: lab }
      });
      if (!alive.current) return;
      resetForm();
      setDone("Pedido registrado.");
      if (orders) await load();
    } catch (e) {
      if (alive.current) setProblem(dentalError(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function install(order: ProsthesisOrder, location: DentalLocation) {
    onChange(withProcedure(value, { sigtap: order.sigtap, name: order.name ?? undefined, location, quantity: 1, plan_item_id: null, prosthesis_order_id: order.id }));
    setInstalling(null);
  }

  return (
    <section aria-label="Prótese" style={panel}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Prótese</h3>
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} onClick={() => { setCreating(true); setDone(null); }} disabled={creating}>Novo pedido</button>
        <button type="button" style={secondaryButtonStyle} onClick={load}>Ver pedidos de prótese do paciente</button>
      </div>
      {done && <p role="status" style={okText}>{done}</p>}
      {creating && (
        <div style={box}>
          <ProcedureSearch role="dentist" only="prosthesis" delayMs={searchDelayMs} onPick={(r) => { setPicked(r); setProblem(null); }} />
          {picked && <p style={{ margin: 0, fontSize: 12.5 }}>{`Prótese: ${procedureLabel(picked.sigtap, picked.name)}`}</p>}
          <label style={fieldLabel}>
            Laboratório
            <select value={lab} style={inputStyle} onChange={(e) => { setLab(e.target.value); setProblem(null); }}>
              <option value="">Escolha…</option>
              {(labs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value={OTHER}>Outro (terceiro)</option>
            </select>
          </label>
          {labs.isError && <p role="alert" style={alert}>{dentalError(labs.error)}</p>}
          {lab === OTHER && (
            <label style={fieldLabel}>
              Nome do laboratório
              <input type="text" value={labName} maxLength={120} style={inputStyle} onChange={(e) => setLabName(e.target.value)} />
            </label>
          )}
          {problem && <p role="alert" style={alert}>{problem}</p>}
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={busy} onClick={submit}>Registrar pedido</button>
            <button type="button" style={secondaryButtonStyle} onClick={resetForm}>Voltar</button>
          </div>
        </div>
      )}
      {listError && <p role="alert" style={alert}>{listError}</p>}
      {orders && orders.length === 0 && <p style={muted}>Nenhum pedido de prótese deste paciente.</p>}
      {orders?.map((o) => {
        const installed = value.procedures.some((p) => p.prosthesis_order_id === o.id);
        const kinds = locations[o.sigtap];
        return (
          <div key={o.id} style={box}>
            <span style={row}>
              <strong style={{ fontSize: 12.5 }}>{o.name ?? o.sigtap}</strong>
              <Tag tone={prosthesisStageTone(o.stage)}>{prosthesisStageLabel(o.stage)}</Tag>
            </span>
            <span style={muted}>{`Laboratório: ${o.laboratory.name} · ${o.health_unit.name}`}</span>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: "flex", flexDirection: "column", gap: 2 }}>
              {o.stages.map((s, i) => (
                <li key={`${s.stage}-${i}`}>
                  {`${prosthesisStageLabel(s.stage)} — ${fmtDay(s.at)}${s.by ? ` · ${s.by.name}` : ""}${s.reason ? ` · ${s.reason}` : ""}`}
                </li>
              ))}
            </ul>
            {o.stage === "received" && installed && <p style={muted}>Instalação registrada nesta consulta.</p>}
            {o.stage === "received" && !installed && installing !== o.id && kinds && kinds.length > 0 && (
              <button type="button" style={secondaryButtonStyle} aria-label={`Registrar instalação nesta consulta — ${o.name ?? o.sigtap}`}
                onClick={() => setInstalling(o.id)}>Registrar instalação nesta consulta</button>
            )}
            {o.stage === "received" && !installed && !kinds && unavailable[o.sigtap] && <p style={muted}>Locais do procedimento indisponíveis.</p>}
            {installing === o.id && kinds && <InstallPicker kinds={kinds} onConfirm={(loc) => install(o, loc)} onBack={() => setInstalling(null)} />}
          </div>
        );
      })}
    </section>
  );
}

function InstallPicker({ kinds, onConfirm, onBack }: { kinds: DentalLocationKind[]; onConfirm(loc: DentalLocation): void; onBack(): void }) {
  const [ loc, setLoc ] = useState<DentalLocation | null>(null);
  const [ tooth, setTooth ] = useState("");
  const arch = (a: "upper" | "lower", label: string) => (
    <button type="button" aria-pressed={loc?.kind === "arch" && loc.arch === a} style={secondaryButtonStyle} onClick={() => { setLoc(archLoc(a)); setTooth(""); }}>{label}</button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={row}>
        {kinds.includes("arch") && <>{arch("upper", "Arcada superior")}{arch("lower", "Arcada inferior")}</>}
        {kinds.includes("mouth") && (
          <button type="button" aria-pressed={loc?.kind === "mouth"} style={secondaryButtonStyle} onClick={() => { setLoc(MOUTH); setTooth(""); }}>Boca toda</button>
        )}
        {kinds.includes("tooth") && (
          <label style={fieldLabel}>
            Dente
            <select value={tooth} style={inputStyle}
              onChange={(e) => { setTooth(e.target.value); setLoc(e.target.value ? { kind: "tooth", tooth: e.target.value, face: null, sextant: null, arch: null } : null); }}>
              <option value="">Escolha…</option>
              {ALL_TEETH.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        )}
      </div>
      {loc && <p style={muted}>{`Local: ${locationLabel(loc)}`}</p>}
      <div style={row}>
        <button type="button" style={buttonStyle} disabled={!loc} onClick={() => loc && onConfirm(loc)}>Confirmar instalação</button>
        <button type="button" style={secondaryButtonStyle} onClick={onBack}>Voltar</button>
      </div>
    </div>
  );
}
