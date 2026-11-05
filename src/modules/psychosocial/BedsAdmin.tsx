// Módulo 31 — F-31.1: leitos de um CAPS com acolhimento noturno, só para o municipal_admin. A escrita (criar, desativar, reativar) exige
// step-up (api, P41): o `SensitiveAction` pede o código e trata `mfa_required` (e leva a "cadastre seu autenticador"). O leito tem só
// rótulo (1–20) e situação; o mapa com o usuário que dorme nele é da equipe (CapsBeds) e nunca passa por aqui. Chave de consulta com o
// id do CAPS.
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPsyBed, listPsyBeds, updatePsyBed, type HealthUnitRow, type PsyBed } from "../../lib/api";
import { PSY_BEDS_KEY, STATIC_QUERY, psyError, textProblem } from "../../lib/psychosocial";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "../exams/styles";

type Pending = { kind: "add"; label: string } | { kind: "toggle"; bed: PsyBed };

export function BedsAdmin({ unit, onGoToSecurity }: { unit: HealthUnitRow; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const beds = useQuery({ queryKey: [ PSY_BEDS_KEY, "admin", unit.id ], queryFn: () => listPsyBeds(unit.id), ...STATIC_QUERY });
  const [ label, setLabel ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  function review(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const found = textProblem(label, 1, 20, "o rótulo do leito");
    setProblem(found);
    setPending(found ? null : { kind: "add", label: label.trim() });
  }
  function begin(bed: PsyBed) {
    setNotice(null); setProblem(null);
    setPending({ kind: "toggle", bed });
  }
  function finished(p: Pending) {
    setPending(null);
    if (p.kind === "add") { setLabel(""); setNotice("Leito adicionado."); }
    else setNotice(p.bed.active ? "Leito desativado." : "Leito reativado.");
    void queryClient.invalidateQueries({ queryKey: [ PSY_BEDS_KEY, "admin", unit.id ] });
  }

  return (
    <Panel title={`Leitos · ${unit.name}`} sub="só CAPS III, CAPS AD III e CAPS AD IV">
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {beds.isPending && <p className="mono" style={muted}>carregando…</p>}
        {beds.isError && <p role="alert" style={alert}>{psyError(beds.error)}</p>}
        {beds.data && (
          <DataTable<PsyBed>
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
              ? `O leito “${pending.label}” entra no mapa do CAPS.`
              : pending.bed.active
                ? `O leito “${pending.bed.label}” sai do mapa; quem dorme nele precisa ter saído antes.`
                : `O leito “${pending.bed.label}” volta ao mapa do CAPS.`}
            requiresStepUp
            run={() => (pending.kind === "add"
              ? createPsyBed({ health_unit_id: unit.id, label: pending.label })
              : updatePsyBed(pending.bed.id, { active: !pending.bed.active })).then(() => undefined)}
            onDone={() => finished(pending)}
            onCancel={() => setPending(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={psyError}
          />
        )}
      </div>
    </Panel>
  );
}
