// Mapa de trabalho (spec §5.5; contrato §5): amostras recebidas por setor e
// bancada, com filtros de urgência, data e pendentes, e o PDF com os mesmos
// filtros. A equipe digita direto do mapa; o liberador só vê. Sem polling.
// Nada de etiqueta ou paciente em log, console ou storage.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWorklistPdf, getLabEntry, listWorklist, type LabEntryItem, type LabWorklistItem, type LabWorklistQuery } from "../lib/api";
import { LAB_WORKLIST_KEY, SECTOR_LABEL, itemStatusLabel, labError, rereadError, refreshLab, sectorLabel, type LabRoles } from "../lib/lab";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { ActionButton } from "../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabScope } from "./lab/LabScope";
import { ResultEntryForm } from "./lab/ResultEntryForm";
import { openLabPdf } from "./lab/openLabPdf";
import { alert, checkLabel, fieldLabel, muted, row, stack } from "./exams/styles";

export function LabWorklist() {
  return (
    <LabGate title="Mapa de trabalho" sub="laboratório municipal · por setor e bancada" allow={(r) => r.staff || r.releaser}>
      {(roles) => <LabScope roles={roles}>{(scope) => <WorklistBody providerId={scope.providerId} roles={roles} />}</LabScope>}
    </LabGate>
  );
}

function WorklistBody({ providerId, roles }: { providerId: string; roles: LabRoles }) {
  const [ sector, setSector ] = useState("");
  const [ bench, setBench ] = useState("");
  const [ urgent, setUrgent ] = useState(false);
  const [ date, setDate ] = useState(() => todayInCity());
  const [ pending, setPending ] = useState(true);
  const [ entry, setEntry ] = useState<LabEntryItem | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ opening, setOpening ] = useState(false);
  const seq = useRef(0);
  const queryClient = useQueryClient();
  const q: LabWorklistQuery = {
    providerId, ...(sector ? { sector } : {}), ...(bench.trim() ? { bench: bench.trim() } : {}), ...(urgent ? { urgent: true } : {}),
    ...(date ? { date } : {}), ...(pending ? { pending: true } : {})
  };
  const groups = useQuery({ queryKey: [ LAB_WORKLIST_KEY, q ], queryFn: () => listWorklist(q), gcTime: 0, staleTime: 0, retry: false });

  // a abertura mais recente vence; cada GET /lab/entry grava trilha de acesso
  async function openEntry(item: LabWorklistItem) {
    if (opening) return;
    const mine = ++seq.current;
    setOpening(true);
    setError(null);
    try {
      const [ found ] = await getLabEntry({ itemId: item.item_id });
      if (mine !== seq.current) return;
      setEntry(found ?? null);
      if (!found) setError("este exame não está mais para digitar — atualize o mapa");
    } catch (err) {
      if (mine === seq.current) setError(labError(err));
    } finally {
      setOpening(false);
    }
  }

  async function reloadEntry(itemId: string, saved: boolean) {
    try {
      const [ fresh ] = await getLabEntry({ itemId });
      setEntry((cur) => (cur && cur.item_id === itemId ? fresh ?? null : cur));
      void groups.refetch();
    } catch (err) {
      setError(rereadError(saved, err));
    }
    void Promise.resolve().then(() => refreshLab(queryClient)).catch(() => undefined);
  }

  async function pdf() {
    setError(null);
    const out = await openLabPdf(() => fetchWorklistPdf(q));
    if (!out.ok) setError(out.text);
  }

  return (
    <div style={stack}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          Setor
          <select value={sector} style={inputStyle} onChange={(e) => { setSector(e.target.value); setError(null); }}>
            <option value="">todos</option>
            {Object.entries(SECTOR_LABEL).map(([ k, v ]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>Bancada<input value={bench} style={inputStyle} onChange={(e) => { setBench(e.target.value); setError(null); }} /></label>
        <label style={fieldLabel}>Data<input type="date" value={date} style={inputStyle} onChange={(e) => { setDate(e.target.value); setError(null); }} /></label>
        <label style={checkLabel}><input type="checkbox" checked={urgent} onChange={(e) => { setUrgent(e.target.checked); setError(null); }} />Só urgentes</label>
        <label style={checkLabel}><input type="checkbox" checked={pending} onChange={(e) => { setPending(e.target.checked); setError(null); }} />Só pendentes</label>
        <ActionButton variant="secondary" onClick={pdf}>Baixar PDF do mapa</ActionButton>
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
      {groups.isPending && <p className="mono" style={muted}>carregando…</p>}
      {groups.isError && <p role="alert" style={alert}>{labError(groups.error)}</p>}
      {groups.isSuccess && groups.data.length === 0 && <p style={muted}>nenhuma amostra no mapa com estes filtros</p>}
      {groups.data?.map((g) => (
        <Panel key={`${g.sector}:${g.bench ?? ""}`} title={`${sectorLabel(g.sector)}${g.bench ? ` · bancada ${g.bench}` : ""}`}>
          <DataTable<LabWorklistItem>
            cols={[
              { label: "Requisição", w: "1fr", card: "title", render: (i) => <span className="mono">{i.requisition_number}</span> },
              { label: "Etiqueta", w: "1fr", render: (i) => <span className="mono">{i.barcode}</span> },
              { label: "Paciente", w: "1.4fr", render: (i) => i.patient_display_name },
              { label: "Exame", w: "1.4fr", render: (i) => <>{i.label}{i.urgent && <> <Tag tone="urgent">urgente</Tag></>}</> },
              { label: "Recebida", w: "1fr", render: (i) => fmtDateTime(i.received_at) },
              { label: "Situação", w: "0.9fr", render: (i) => itemStatusLabel(i.status) },
              ...(roles.staff ? [ { label: "", w: "auto", card: "actions" as const, render: (i: LabWorklistItem) => (
                <button type="button" style={secondaryButtonStyle} aria-disabled={opening || undefined} onClick={() => void openEntry(i)}>Digitar</button>
              ) } ] : [])
            ]}
            rows={g.items} rowKey={(i) => i.item_id}
          />
        </Panel>
      ))}
      {entry && <ResultEntryForm key={entry.item_id} item={entry} onSaved={() => void reloadEntry(entry.item_id, true)} onStale={() => void reloadEntry(entry.item_id, false)} onClose={() => setEntry(null)} />}
    </div>
  );
}
