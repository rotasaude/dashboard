// src/modules/lab/ShipmentCheck.tsx
// Conferência da remessa no laboratório (spec §5.3): lê as etiquetas da
// caixa; o que estava na lista e não foi lido vira `not_received` e avisa a
// UBS. Confirmação antes, com a contagem do que falta. Aceitar ou rejeitar
// cada amostra é do Recebimento.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listShipments, receiveShipment, type LabShipment } from "../../lib/api";
import { LAB_SHIPMENTS_KEY, labError, refreshLab } from "../../lib/lab";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { ConfirmButton } from "../../components/ConfirmButton";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { ScanField, type ScanOutcome } from "./ScanField";
import { alert, muted, okText, panel, row, stack } from "../exams/styles";

export function ShipmentCheck({ providerId }: { providerId: string }) {
  const queryClient = useQueryClient();
  const shipments = useQuery({
    queryKey: [ LAB_SHIPMENTS_KEY, "lab", providerId ], queryFn: () => listShipments({ providerId, statuses: [ "sent" ] }),
    gcTime: 0, staleTime: 0, retry: false
  });
  const [ open, setOpen ] = useState<LabShipment | null>(null);
  const [ read, setReadState ] = useState<string[]>([]);
  const readRef = useRef<string[]>([]);
  const setRead = (next: string[]) => { readRef.current = next; setReadState(next); };
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  function start(s: LabShipment) { setOpen(s); setRead([]); setError(null); setNotice(null); }

  async function scan(code: string): Promise<ScanOutcome> {
    if (!open) return { ok: false, text: "escolha a remessa" };
    if (!open.samples.some((s) => s.barcode === code)) return { ok: false, text: "não é desta remessa" };
    if (readRef.current.includes(code)) return { ok: false, text: "já conferida" };
    setRead([ ...readRef.current, code ]);
    return { ok: true, text: "conferida" };
  }

  async function finish() {
    if (!open) return;
    setError(null);
    try {
      await receiveShipment(open.id, readRef.current);
      setOpen(null);
      setNotice("Remessa conferida. Siga para o recebimento de cada amostra.");
      await refreshLab(queryClient);
    } catch (err) {
      setError(labError(err));
      if (errorCode(err) === "invalid_transition") { setOpen(null); void shipments.refetch(); }
    }
  }

  const missing = open ? open.samples.length - read.length : 0;
  return (
    <div style={stack}>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      <Panel title="Remessas a caminho" sub="enviadas pelas UBS e ainda não conferidas">
        {shipments.isError ? <p role="alert" style={alert}>{labError(shipments.error)}</p> : (
          <DataTable<LabShipment>
            cols={[
              { label: "UBS", w: "1.6fr", card: "title", render: (s) => s.origin_unit.name },
              { label: "Enviada", w: "1.2fr", render: (s) => fmtDateTime(s.sent_at) },
              { label: "Amostras", w: "0.8fr", align: "right", render: (s) => String(s.samples.length) },
              { label: "Temperatura", w: "0.9fr", render: (s) => (s.temperature_celsius === null ? "—" : `${String(s.temperature_celsius).replace(".", ",")} °C`) },
              { label: "", w: "auto", card: "actions", render: (s) => <button type="button" style={secondaryButtonStyle} onClick={() => start(s)}>Conferir</button> }
            ]}
            rows={shipments.data ?? []} rowKey={(s) => s.id} empty={shipments.isPending ? "carregando…" : "nenhuma remessa a caminho"}
          />
        )}
      </Panel>
      {open && (
        <section aria-label={`Conferência da remessa de ${open.origin_unit.name}`} style={panel}>
          <ScanField label="Etiqueta do tubo recebido" onScan={scan} />
          <p style={muted}>{`${read.length} de ${open.samples.length} lidas`}</p>
          <ul aria-label="amostras da remessa" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
            {open.samples.map((s) => (
              <li key={s.id}>
                <span className="mono">{s.barcode}</span>{` · ${s.material} · ${s.requisition_number} `}
                {read.includes(s.barcode) ? <Tag tone="ok">lida</Tag> : <Tag tone="warn">falta</Tag>}
              </li>
            ))}
          </ul>
          <div style={row}>
            {missing > 0 ? (
              <ConfirmButton label="Concluir conferência"
                question={`${missing} amostra${missing === 1 ? "" : "s"} não lida${missing === 1 ? "" : "s"} ficará${missing === 1 ? "" : "ão"} como "não chegou" e a UBS será avisada. Concluir?`}
                onConfirm={finish} />
            ) : (
              <button type="button" style={secondaryButtonStyle} onClick={() => void finish()}>Concluir conferência</button>
            )}
            <button type="button" style={secondaryButtonStyle} onClick={() => setOpen(null)}>Fechar</button>
          </div>
        </section>
      )}
    </div>
  );
}
