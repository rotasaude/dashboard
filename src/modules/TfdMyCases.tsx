// Módulo 30 (F-30.5): "Meus pedidos de TFD" do médico (CBO 225). A lista (GET /tfd/my_cases, até 100, sem cursor) não traz dado clínico:
// paciente, destino, situação e envio. Abrir um pedido é uma leitura com trilha (POST /tfd/cases/:id/read) feita por mutação no clique,
// nunca sozinha; o processo aberto fica só na memória da tela. Rascunho e devolvido abrem no formulário do laudo; os demais, só leitura.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listMyTfdCases, readTfdCase, type TfdCase, type TfdCaseRow } from "../lib/api";
import { READ_TRAIL_NOTE, TFD_MY_CASES_KEY, canEditCase, tfdError, tfdStatusLabel, tfdStatusTone } from "../lib/tfd";
import { STATIC_QUERY } from "../lib/careLines";
import { fmtDateTime } from "../lib/format";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { Panel } from "../components/Panel";
import { secondaryButtonStyle, disabledButtonStyle } from "../components/formStyles";
import { alert, muted, okText, row, title } from "./exams/styles";
import { TransportGate } from "./transport/TransportGate";
import { TfdRequestForm } from "./tfd/TfdRequestForm";
import { TfdEvents, TfdReportView } from "./tfd/TfdReportView";

export function TfdMyCases(props: { today?: string; searchDelayMs?: number }) {
  return (
    <TransportGate title="Meus pedidos de TFD" sub="Pedidos de TFD que você fez e os devolvidos" area="tfd" allow={(r) => r.professional}>
      {() => <MyCases searchDelayMs={props.searchDelayMs} />}
    </TransportGate>
  );
}

const nameOf = (r: { patient: { display_name: string | null } }) => r.patient.display_name ?? "paciente";

function MyCases({ searchDelayMs }: { searchDelayMs?: number }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [ TFD_MY_CASES_KEY ], queryFn: listMyTfdCases, ...STATIC_QUERY });
  const [ opened, setOpened ] = useState<TfdCase | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  // Leitura nominal com trilha: só no clique, sem cache.
  const read = useMutation({ mutationFn: (id: string) => readTfdCase(id), gcTime: 0, onSuccess: (c) => { setOpened(c); setDone(null); } });

  const cols: Column<TfdCaseRow>[] = [
    { label: "Paciente", w: "1.4fr", card: "title", render: (r) => nameOf(r) },
    { label: "Destino", w: "1fr", render: (r) => r.destination.name },
    { label: "Situação", w: "1fr", render: (r) => <Tag tone={tfdStatusTone(r.status)}>{tfdStatusLabel(r.status)}</Tag> },
    { label: "Enviado em", w: "1fr", render: (r) => (r.submitted_at ? fmtDateTime(r.submitted_at) : "—") },
    {
      label: "Ações", w: "auto", card: "actions", render: (r) => {
        const reading = read.isPending && read.variables === r.id;
        return (
          <button type="button" aria-label={`Abrir o pedido de ${nameOf(r)}`} disabled={read.isPending} style={read.isPending ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => read.mutate(r.id)}>
            {reading ? "abrindo…" : "Abrir"}
          </button>
        );
      }
    }
  ];

  function close(text?: string) {
    setOpened(null);
    // O laudo lido sai também do estado da mutação (como na fila da comissão).
    read.reset();
    if (text) { setDone(text); void queryClient.invalidateQueries({ queryKey: [ TFD_MY_CASES_KEY ] }); }
  }

  return (
    <>
      <Panel title="Pedidos">
        {list.isError ? <p role="alert" style={alert}>{tfdError(list.error)}</p> : (
          <>
            <p style={muted}>{READ_TRAIL_NOTE}</p>
            {read.isError && <p role="alert" style={alert}>{tfdError(read.error)}</p>}
            {done && <p role="status" style={okText}>{done}</p>}
            <DataTable<TfdCaseRow> cols={cols} rows={list.data ?? []} rowKey={(r) => r.id}
              empty={list.isPending ? "carregando…" : "nenhum pedido de TFD"} />
          </>
        )}
      </Panel>
      {opened && (
        <section aria-label="Pedido de TFD" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={row}>
            <h3 style={title}>{`Pedido de ${nameOf(opened)}`}</h3>
            <Tag tone={tfdStatusTone(opened.status)}>{tfdStatusLabel(opened.status)}</Tag>
          </div>
          <TfdEvents events={opened.events} />
          {canEditCase(opened) ? (
            <TfdRequestForm key={opened.id} source={{ tfdCase: opened }} searchDelayMs={searchDelayMs} onDone={(_c, text) => close(text)} onCancel={() => close()} />
          ) : (
            <>
              <TfdReportView c={opened} />
              <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => close()}>Fechar</button></div>
            </>
          )}
        </section>
      )}
    </>
  );
}
