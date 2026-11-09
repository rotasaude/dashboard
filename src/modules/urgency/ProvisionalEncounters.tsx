// Pacientes não identificados da UPA (módulo 32a, F-32.2; contrato §14 Q25 e Q29): os encontros com paciente provisório ainda sem
// identificação, abertos ou encerrados nos últimos 7 dias, para a recepção identificar — inclusive o óbito sem documento no dia
// seguinte. Cada leitura grava uma trilha por paciente listado (a lista leva a descrição física), por isso ela só é lida quando a
// recepção pede ("Mostrar a lista", "Atualizar") ou quando uma identificação termina: sem polling, sem releitura no foco nem na
// reconexão (NOMINAL_QUERY). "Ocultar" tira a lista da tela e do cache. Nenhum dado clínico.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listProvisionalEncounters, type HealthUnit, type ProvisionalEncounter } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { NOMINAL_QUERY, outcomeLabel, urgencyError } from "../../lib/urgency";
import { DataTable, type Column } from "../../components/DataTable";
import { Panel } from "../../components/Panel";
import { secondaryButtonStyle } from "../../components/formStyles";

export const PROVISIONAL_KEY = "urgencyProvisional";
export const PROVISIONAL_EMPTY = "nenhum paciente sem identificação nos últimos 7 dias";
export const arrivalLabel = (item: Pick<ProvisionalEncounter, "arrived_at">) => `chegada ${fmtDateTime(item.arrived_at)}`;

const statusText = (item: ProvisionalEncounter) => (item.closed_at
  ? [ `encerrado ${fmtDateTime(item.closed_at)}`, item.outcome_kind && outcomeLabel(item.outcome_kind) ].filter(Boolean).join(" · ")
  : "em atendimento na UPA");

export function ProvisionalEncounters({ unit, onIdentify }: { unit: HealthUnit; onIdentify(item: ProvisionalEncounter): void }) {
  const queryClient = useQueryClient();
  const [ open, setOpen ] = useState(false);
  const list = useQuery({
    queryKey: [ PROVISIONAL_KEY, unit.id ], queryFn: () => listProvisionalEncounters(unit.id), enabled: open, ...NOMINAL_QUERY
  });
  const hide = () => { setOpen(false); queryClient.removeQueries({ queryKey: [ PROVISIONAL_KEY, unit.id ] }); };

  const cols: Column<ProvisionalEncounter>[] = [
    { label: "Chegada", w: "1fr", card: "title", render: (r) => <span className="mono">{fmtDateTime(r.arrived_at)}</span> },
    { label: "Descrição", w: "2.4fr", render: (r) => r.patient.description ?? "—" },
    { label: "Situação", w: "1.4fr", render: statusText },
    { label: "", w: "auto", align: "right", card: "actions", render: (r) => (
      <button type="button" style={secondaryButtonStyle} aria-label={`Identificar — ${arrivalLabel(r)}`} onClick={() => onIdentify(r)}>
        Identificar
      </button>
    ) }
  ];

  const right = open ? (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" style={secondaryButtonStyle} onClick={() => void list.refetch()}>Atualizar</button>
      <button type="button" style={secondaryButtonStyle} onClick={hide}>Ocultar</button>
    </div>
  ) : (
    <button type="button" style={secondaryButtonStyle} onClick={() => setOpen(true)}>Mostrar a lista</button>
  );

  return (
    <Panel title="Pacientes não identificados" sub="abertos ou encerrados nos últimos 7 dias · lida só quando pedida" right={right}>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {!open ? (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
            Para identificar quem chegou sem documento, inclusive depois do desfecho. Cada abertura fica registrada na trilha.
          </p>
        ) : list.isPending ? (
          <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
        ) : list.isError ? (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{urgencyError(list.error)}</p>
        ) : (
          <DataTable<ProvisionalEncounter> cols={cols} rows={list.data} rowKey={(r) => r.encounter_id} empty={PROVISIONAL_EMPTY} />
        )}
      </div>
    </Panel>
  );
}
