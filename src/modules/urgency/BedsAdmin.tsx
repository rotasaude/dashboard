// Módulo 32b — F-32.7: leitos de observação de uma UPA, só para o municipal_admin. A escrita (criar, desativar, reativar) exige
// step-up (api): o `SensitiveAction` pede o código e trata `mfa_required` (e leva a "cadastre seu autenticador"). O leito tem só
// rótulo (1–20) e situação; o mapa com o paciente que ocupa o leito é da equipe e nunca passa por aqui. Chave de consulta com o
// id da UPA.
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createUrgencyBed, listUrgencyBeds, updateUrgencyBed, type HealthUnit, type UrgencyBed } from "../../lib/api";
import { urgencyError } from "../../lib/urgency";
import { BED_ADDED, BED_DEACTIVATED, BED_REACTIVATED, URGENCY_BEDS_KEY, bedLabelProblem } from "../../lib/urgencyObservation";
import { STATIC_QUERY } from "../../lib/psychosocial";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "../exams/styles";

type Pending = { kind: "add"; label: string } | { kind: "toggle"; bed: UrgencyBed };

export function BedsAdmin({ unit, onGoToSecurity }: { unit: Pick<HealthUnit, "id" | "name">; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const beds = useQuery({ queryKey: [ URGENCY_BEDS_KEY, "admin", unit.id ], queryFn: () => listUrgencyBeds(unit.id), ...STATIC_QUERY });
  const [ label, setLabel ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  function review(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const found = bedLabelProblem(label);
    setProblem(found);
    setPending(found ? null : { kind: "add", label: label.trim() });
  }
  function begin(bed: UrgencyBed) {
    setNotice(null); setProblem(null);
    setPending({ kind: "toggle", bed });
  }
  function finished(p: Pending) {
    setPending(null);
    if (p.kind === "add") { setLabel(""); setNotice(BED_ADDED); }
    else setNotice(p.bed.active ? BED_DEACTIVATED : BED_REACTIVATED);
    void queryClient.invalidateQueries({ queryKey: [ URGENCY_BEDS_KEY, "admin", unit.id ] });
  }

  return (
    <Panel title={`Leitos de observação · ${unit.name}`} sub="um paciente por leito; o mapa da observação fica na mesa da UPA">
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {beds.isPending && <p className="mono" style={muted}>carregando…</p>}
        {beds.isError && <p role="alert" style={alert}>{urgencyError(beds.error)}</p>}
        {beds.data && (
          <DataTable<UrgencyBed>
            cols={[
              { label: "Leito", w: "2fr", card: "title", render: (b) => b.label },
              { label: "Situação", w: "1fr", render: (b) => <Tag tone={b.active ? "ok" : undefined}>{b.active ? "ativo" : "inativo"}</Tag> },
              { label: "", w: "auto", align: "right", card: "actions", render: (b) => (
                <button type="button" style={secondaryButtonStyle} disabled={pending !== null} onClick={() => begin(b)}>{b.active ? "Desativar" : "Reativar"}</button>
              ) }
            ]}
            rows={beds.data}
            rowKey={(b) => b.id}
            empty="nenhum leito cadastrado"
          />
        )}
        <form onSubmit={review} style={{ ...row, alignItems: "flex-end" }}>
          <label style={{ ...fieldLabel, flex: "1 1 200px", maxWidth: 320 }}>
            Rótulo do leito
            <input value={label} onChange={(e) => { setLabel(e.target.value); setProblem(null); setNotice(null); }} style={inputStyle}
              aria-invalid={problem ? true : undefined} />
          </label>
          <button type="submit" disabled={pending !== null} style={pending !== null ? disabledButtonStyle : buttonStyle}>Adicionar leito</button>
        </form>
        {problem && <p role="alert" style={alert}>{problem}</p>}
        {pending && (
          <SensitiveAction
            key={pending.kind === "add" ? `add-${pending.label}` : `toggle-${pending.bed.id}`}
            title={pending.kind === "add" ? "Adicionar leito" : pending.bed.active ? "Desativar leito" : "Reativar leito"}
            description={pending.kind === "add"
              ? `O leito “${pending.label}” entra no mapa da observação.`
              : pending.bed.active
                ? `O leito “${pending.bed.label}” sai do mapa; quem está nele precisa ter saído antes.`
                : `O leito “${pending.bed.label}” volta ao mapa da observação.`}
            requiresStepUp
            run={() => (pending.kind === "add"
              ? createUrgencyBed({ health_unit_id: unit.id, label: pending.label, active: true })
              : updateUrgencyBed(pending.bed.id, { active: !pending.bed.active })).then(() => undefined)}
            onDone={() => finished(pending)}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={urgencyError}
          />
        )}
      </div>
    </Panel>
  );
}
