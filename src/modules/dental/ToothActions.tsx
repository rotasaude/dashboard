// Painel do dente selecionado: face, achado (coroa, raiz ou prótese total por arcada) e procedimento com local.
// As regras (situações do dente, local, limite) vêm de `lib/dental`; o api recusa de novo.
import { useEffect, useState } from "react";
import type { Arch, DentalFields, DentalFinding, DentalLocation, DentalLocationKind, DentalPart, DentalPlan, DentalProcedureRef, DentalRole,
  DentalVocabulary, Sextant, ToothFace } from "../../lib/api";
import { archLoc, canAddPlanItems, FACE_LABEL, FACES, locationLabel, MOUTH, sextantLoc, situationsFor, toothSextant, withFinding,
  withPlanAdd, withProcedure } from "../../lib/dental";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row } from "../exams/styles";
import { ProcedureSearch } from "./ProcedureSearch";

interface Props {
  selection: { tooth: string; face: ToothFace | null } | null;
  value: DentalFields;
  plan: DentalPlan | null;
  unit: { kind: string };
  role: DentalRole;
  baseline: boolean;
  situations?: DentalVocabulary["situations"];
  searchDelayMs?: number;
  onSelectFace(face: ToothFace | null): void;
  onChange(f: DentalFields): void;
}

const SEXTANTS: Sextant[] = [ "S1", "S2", "S3", "S4", "S5", "S6" ];
const ARCHES: { arch: Arch; label: string }[] = [ { arch: "upper", label: "superior" }, { arch: "lower", label: "inferior" } ];
const KIND_LABEL: Record<DentalLocationKind, string> = { tooth: "dente", face: "face", sextant: "sextante", arch: "arcada", mouth: "boca toda" };
const pressed = (on: boolean) => (on ? { ...buttonStyle } : { ...secondaryButtonStyle });

export function ToothActions({ selection, value, plan, unit, role, baseline, situations, searchDelayMs, onSelectFace, onChange }: Props) {
  const [ part, setPart ] = useState<DentalPart>("crown");
  const [ situation, setSituation ] = useState("");
  const [ picked, setPicked ] = useState<DentalProcedureRef | null>(null);
  const [ chosen, setChosen ] = useState<DentalLocation | null>(null);
  const [ quantity, setQuantity ] = useState("1");
  const [ itemId, setItemId ] = useState("");
  const [ refusal, setRefusal ] = useState<string | null>(null);

  const tooth = selection?.tooth ?? null;
  const face = selection?.face ?? null;
  useEffect(() => { setChosen(null); setSituation(""); setRefusal(null); if (face) setPart("crown"); }, [ tooth, face ]);

  const group = face ? "face" : part;
  const options = situationsFor(group, situations, tooth);
  const fromSelection: DentalLocation | null = tooth
    ? { kind: face ? "face" : "tooth", tooth, face, sextant: null, arch: null } : null;
  const location = chosen ?? fromSelection;
  const planned = (plan?.items ?? []).filter((i) => i.status === "planned" && i.sigtap === picked?.sigtap
    && !value.procedures.some((p) => p.plan_item_id === i.id));

  function markFinding() {
    if (!tooth || !situation) return;
    const finding: DentalFinding = { tooth, face, part: face ? "crown" : part, situation };
    onChange(withFinding(value, finding));
    setSituation("");
  }
  function markArch(arch: Arch, code: string) {
    onChange(withFinding(value, { tooth: null, face: null, part: "crown", arch, situation: code }));
  }

  // O local tem de estar entre os tipos que o procedimento aceita; senão a frase e nada entra.
  function validLocation(): DentalLocation | null {
    if (!picked) return null;
    if (!location || !picked.locations.includes(location.kind)) {
      setRefusal(`${picked.name}: escolha um local do tipo ${picked.locations.map((k) => KIND_LABEL[k]).join(" ou ")}`);
      return null;
    }
    setRefusal(null);
    return location;
  }
  function reset() { setPicked(null); setChosen(null); setQuantity("1"); setItemId(""); setRefusal(null); }
  function register() {
    const loc = validLocation();
    if (!loc || !picked) return;
    onChange(withProcedure(value, { sigtap: picked.sigtap, name: picked.name, location: loc, quantity: Number(quantity), plan_item_id: itemId || null }));
    reset();
  }
  function addToPlan() {
    const loc = validLocation();
    if (!loc || !picked) return;
    onChange(withPlanAdd(value, { sigtap: picked.sigtap, name: picked.name, location: loc }));
    reset();
  }

  return (
    <section aria-label="Dente selecionado" style={box}>
      <h3 style={{ margin: 0, fontSize: 14 }}>{tooth ? `Dente ${tooth}` : "Nenhum dente selecionado"}</h3>
      {tooth && (
        <>
          <div role="group" aria-label="Face" style={row}>
            <button type="button" aria-pressed={face === null} style={pressed(face === null)} onClick={() => onSelectFace(null)}>Dente inteiro</button>
            {FACES.map((f) => (
              <button key={f} type="button" aria-pressed={face === f} style={pressed(face === f)} onClick={() => onSelectFace(f)}>{`Face ${FACE_LABEL[f]}`}</button>
            ))}
          </div>
          <div role="group" aria-label="Parte do dente" style={row}>
            {([ [ "crown", "Coroa" ], [ "root", "Raiz" ] ] as const).map(([ p, text ]) => (
              <button key={p} type="button" aria-pressed={group === p} style={pressed(group === p)}
                onClick={() => { setPart(p); setSituation(""); if (p === "root" && face) onSelectFace(null); }}>{text}</button>
            ))}
          </div>
          <label style={fieldLabel}>
            Achado
            <select value={situation} style={inputStyle} onChange={(e) => setSituation(e.target.value)}>
              <option value="">—</option>
              {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </label>
          <div><button type="button" style={buttonStyle} disabled={!situation} onClick={markFinding}>Marcar achado</button></div>
        </>
      )}
      {!tooth && <p style={muted}>Escolha um dente no odontograma.</p>}
      {(situations?.arch ?? []).length > 0 && (
        <div role="group" aria-label="Achado de arcada" style={row}>
          {(situations?.arch ?? []).flatMap((o) => ARCHES.map(({ arch, label }) => (
            <button key={`${o.code}-${arch}`} type="button" style={secondaryButtonStyle} onClick={() => markArch(arch, o.code)}>{`${o.label} — arcada ${label}`}</button>
          )))}
        </div>
      )}
      {!baseline && (
        <>
          <div role="group" aria-label="Local do procedimento" style={row}>
            {SEXTANTS.map((s) => {
              const on = chosen?.kind === "sextant" && chosen.sextant === s;
              return (
                <button key={s} type="button" aria-pressed={on} style={{ ...pressed(on), fontWeight: tooth && toothSextant(tooth) === s ? 700 : undefined }}
                  title={tooth && toothSextant(tooth) === s ? "sextante do dente selecionado" : undefined}
                  onClick={() => setChosen(sextantLoc(s))}>{`Sextante ${s}`}</button>
              );
            })}
            {ARCHES.map(({ arch, label }) => {
              const on = chosen?.kind === "arch" && chosen.arch === arch;
              return <button key={arch} type="button" aria-pressed={on} style={pressed(on)} onClick={() => setChosen(archLoc(arch))}>{`Arcada ${label}`}</button>;
            })}
            <button type="button" aria-pressed={chosen?.kind === "mouth"} style={pressed(chosen?.kind === "mouth")} onClick={() => setChosen(MOUTH)}>Boca toda</button>
          </div>
          <ProcedureSearch role={role} delayMs={searchDelayMs} onPick={(r) => { setPicked(r); setRefusal(null); setItemId(""); }} />
          {picked && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 12.5 }}>
                <span className="mono">{picked.sigtap}</span> {picked.name}
                {location ? ` · ${locationLabel(location)}` : ""}
              </p>
              <label style={fieldLabel}>
                Quantidade
                <input type="number" min={1} step={1} value={quantity} style={inputStyle} onChange={(e) => setQuantity(e.target.value)} />
              </label>
              <label style={fieldLabel}>
                Item do plano
                <select value={itemId} style={inputStyle} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">—</option>
                  {planned.map((i) => <option key={i.id} value={i.id}>{locationLabel(i.location)}</option>)}
                </select>
              </label>
              {refusal && <p role="alert" style={alert}>{refusal}</p>}
              <span style={row}>
                <button type="button" style={buttonStyle} onClick={register}>Registrar procedimento</button>
                {canAddPlanItems(unit, plan, value, role) && <button type="button" style={secondaryButtonStyle} onClick={addToPlan}>Incluir no plano</button>}
                <button type="button" style={secondaryButtonStyle} onClick={reset}>Trocar procedimento</button>
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

