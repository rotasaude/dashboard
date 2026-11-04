// Módulo 30 (F-30.5): "Comissão de TFD". A fila (GET /tfd/cases, 50 por página, mais antigos primeiro; `before` = "os itens depois
// deste") não traz dado clínico: paciente, destino, situação e envio. Ler o laudo é uma leitura com trilha (POST /tfd/cases/:id/read)
// feita por mutação no clique (gcTime 0), nunca sozinha; o processo aberto fica só no estado da tela e sai dela ao fechar. A resposta
// de uma leitura já trocada (outro clique, fechar) é ignorada. Toda escrita devolve o processo inteiro: ele substitui o aberto e a
// fila é relida.
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listTfdCases, readTfdCase, type TfdCase, type TfdCaseRow } from "../lib/api";
import { READ_TRAIL_NOTE, TFD_CASES_KEY, tfdError, tfdStatusLabel, tfdStatusTone } from "../lib/tfd";
import { STATIC_QUERY } from "../lib/careLines";
import { cityIsoDate, fmtDateTime } from "../lib/format";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { Panel } from "../components/Panel";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row } from "./exams/styles";
import { TransportGate } from "./transport/TransportGate";
import { CaseView } from "./tfd/CaseView";

// As situações que a fila aceita (rascunho nunca chega à comissão); "" = todas.
const STATUSES = [ "submitted", "returned", "authorized", "denied", "scheduled", "travelling", "completed", "cancelled" ];

export interface TfdQueueProps { today?: string; now?: Date; onGoToSecurity?: () => void }

export function TfdQueue(props: TfdQueueProps) {
  return (
    <TransportGate title="Comissão de TFD" sub="Laudos aguardando, decisão, trechos e pagamento" area="tfd" allow={(r) => r.committee}>
      {() => <Queue {...props} />}
    </TransportGate>
  );
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const nameOf = (r: { patient: { display_name: string | null } }) => r.patient.display_name ?? "paciente";

function Queue({ today = cityIsoDate(), now = new Date(), onGoToSecurity }: TfdQueueProps) {
  const queryClient = useQueryClient();
  const statusField = useId();
  const [ status, setStatus ] = useState("submitted");
  const [ before, setBefore ] = useState<string | null>(null);
  const [ opened, setOpened ] = useState<TfdCase | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const seq = useRef(0);

  const page = useQuery({
    queryKey: [ TFD_CASES_KEY, status, before ],
    queryFn: () => listTfdCases({ status: status || null, before }),
    ...STATIC_QUERY
  });
  // Leitura nominal com trilha: só no clique, sem cache.
  const read = useMutation({ mutationFn: (id: string) => readTfdCase(id), gcTime: 0 });

  function open(id: string) {
    const mine = ++seq.current;
    setDone(null);
    read.mutate(id, { onSuccess: (c) => { if (mine === seq.current) setOpened(c); } });
  }

  function close() {
    seq.current++;
    setOpened(null);
    read.reset();
  }

  function changed(next: TfdCase, text: string) {
    // Resposta de um processo que já não está aberto não troca a tela.
    setOpened((prev) => (prev && prev.id === next.id ? next : prev));
    setDone(text);
    void queryClient.invalidateQueries({ queryKey: [ TFD_CASES_KEY ] });
  }

  const cols: Column<TfdCaseRow>[] = [
    { label: "Paciente", w: "1.4fr", card: "title", render: (r) => nameOf(r) },
    { label: "Destino", w: "1fr", render: (r) => r.destination.name },
    { label: "Situação", w: "1fr", render: (r) => <Tag tone={tfdStatusTone(r.status)}>{tfdStatusLabel(r.status)}</Tag> },
    { label: "Enviado em", w: "1fr", render: (r) => (r.submitted_at ? fmtDateTime(r.submitted_at) : "—") },
    {
      label: "Ações", w: "auto", card: "actions", render: (r) => {
        const reading = read.isPending && read.variables === r.id;
        return (
          <button type="button" aria-label={`Ler o laudo de ${nameOf(r)}`} disabled={read.isPending}
            style={read.isPending ? disabledButtonStyle : secondaryButtonStyle} onClick={() => open(r.id)}>
            {reading ? "abrindo…" : "Ler o laudo"}
          </button>
        );
      }
    }
  ];

  const data = page.data;
  return (
    <>
      {done && <p role="status" style={okText}>{done}</p>}
      {opened && (
        <Panel title="Processo de TFD">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <CaseView tfdCase={opened} now={now} today={today} onChanged={changed} onGoToSecurity={onGoToSecurity} />
            <div style={row}><button type="button" style={secondaryButtonStyle} onClick={close}>Fechar laudo</button></div>
          </div>
        </Panel>
      )}
      <Panel title="Fila da comissão">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={fieldLabel}>
            <label htmlFor={statusField}>Situação</label>
            <select id={statusField} value={status} style={{ ...inputStyle, maxWidth: 280 }}
              onChange={(e) => { setStatus(e.target.value); setBefore(null); }}>
              {STATUSES.map((s) => <option key={s} value={s}>{capitalize(tfdStatusLabel(s))}</option>)}
              <option value="">Todas</option>
            </select>
          </div>
          <p style={muted}>{READ_TRAIL_NOTE}</p>
          {read.isError && <p role="alert" style={alert}>{tfdError(read.error)}</p>}
          {page.isError ? <p role="alert" style={alert}>{tfdError(page.error)}</p> : (
            <DataTable<TfdCaseRow> cols={cols} rows={data?.items ?? []} rowKey={(r) => r.id}
              empty={page.isPending ? "carregando…" : "nenhum processo nesta situação"} />
          )}
          {(before !== null || data?.next_before) && (
            <div style={row}>
              {before !== null && <button type="button" style={secondaryButtonStyle} onClick={() => setBefore(null)}>Voltar ao início</button>}
              {data?.next_before && (
                <button type="button" style={secondaryButtonStyle} onClick={() => setBefore(data.next_before)}>Próximos</button>
              )}
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}
