// src/modules/LabRequisitions.tsx
// Requisições do laboratório e situação (spec §5.1, §5.10, §5.11; contrato §4).
// O laboratório vê as suas; a UBS, as que abriu. A busca aceita o número da
// requisição ou a leitura da etiqueta (o leitor manda Enter). Lista com
// cursor; nada fica no cache (gcTime 0).
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listLabRequisitions, type LabRequisitionRow } from "../lib/api";
import { LAB_REQUISITIONS_KEY, labError, lookupKind, normalizeBarcode, requisitionStatusLabel, requisitionStatusTone } from "../lib/lab";
import { fmtDay } from "../lib/exams";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabScope, type LabScopeValue } from "./lab/LabScope";
import { LabRequisitionDetail } from "./lab/LabRequisitionDetail";
import { RequisitionForm } from "./lab/RequisitionForm";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

export function LabRequisitions() {
  return (
    <LabGate title="Requisições e situação" sub="laboratório municipal · requisição, etiquetas, entrega e situação"
      allow={(r) => r.staff || r.professional}>
      {(roles) => <LabScope roles={roles}>{(scope) => <RequisitionsBody scope={scope} />}</LabScope>}
    </LabGate>
  );
}

const SEARCH_INVALID = "informe o número da requisição (8 dígitos) ou leia a etiqueta (10 dígitos)";

function RequisitionsBody({ scope }: { scope: LabScopeValue }) {
  const [ search, setSearch ] = useState("");
  const [ filter, setFilter ] = useState<{ number?: string; barcode?: string }>({});
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ creating, setCreating ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ searchError, setSearchError ] = useState<string | null>(null);
  const base = scope.kind === "lab" ? { providerId: scope.providerId } : { originUnitId: scope.unit.id };
  const query = useInfiniteQuery({
    queryKey: [ LAB_REQUISITIONS_KEY, base, filter ],
    queryFn: ({ pageParam }) => listLabRequisitions({ ...base, ...filter, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    gcTime: 0, staleTime: 0, retry: false
  });
  const rows = query.data?.pages.flatMap((p) => p.requisitions) ?? [];

  function find() {
    const text = search.trim();
    setSearchError(null);
    if (!text) { setFilter({}); return; }
    // B16: 8 dígitos = requisição, 10 = etiqueta (a leitura vem pelo normalizeBarcode).
    const kind = lookupKind(text);
    if (kind === "number") setFilter({ number: text });
    else if (kind === "barcode") setFilter({ barcode: normalizeBarcode(text) as string });
    else setSearchError(SEARCH_INVALID);
  }

  return (
    <div style={stack}>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {creating ? (
        <RequisitionForm place={scope.kind} providerId={scope.providerId} originUnit={scope.kind === "ubs" ? scope.unit : null}
          onCancel={() => setCreating(false)}
          onDone={(r) => { setCreating(false); setNotice(`Requisição ${r.number} aberta.`); setOpenId(r.id); void query.refetch(); }} />
      ) : (
        <div><button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setCreating(true); }}>Nova requisição</button></div>
      )}
      <Panel title="Requisições" sub={scope.kind === "lab" ? scope.providerName : `${scope.unit.name} · ${scope.providerName}`}>
        <div style={stack}>
          <div style={{ ...row, alignItems: "flex-end" }}>
            <label style={fieldLabel}>
              Número da requisição ou etiqueta
              <input value={search} autoComplete="off" style={inputStyle} onChange={(e) => { setSearch(e.target.value); setSearchError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); find(); } }} />
            </label>
            <button type="button" style={secondaryButtonStyle} onClick={find}>Ver situação</button>
          </div>
          {searchError && <p role="alert" style={alert}>{searchError}</p>}
          {query.isError && <p role="alert" style={alert}>{labError(query.error)}</p>}
          {query.isPending && <p className="mono" style={muted}>carregando…</p>}
          {query.isSuccess && !searchError && (
            <DataTable<LabRequisitionRow>
              cols={[
                { label: "Número", w: "1fr", card: "title", render: (r) => <span className="mono">{r.number}</span> },
                { label: "Paciente", w: "1.6fr", render: (r) => r.patient.display_name },
                { label: "Origem", w: "1.2fr", render: (r) => r.origin_unit.name },
                { label: "Situação", w: "1fr", render: (r) => <Tag tone={requisitionStatusTone(r.status)}>{requisitionStatusLabel(r.status)}</Tag> },
                { label: "Previsão", w: "0.9fr", render: (r) => fmtDay(r.expected_delivery_on) },
                { label: "", w: "auto", card: "actions", render: (r) => (
                  <button type="button" style={secondaryButtonStyle} onClick={() => setOpenId(r.id)}>Abrir</button>
                ) }
              ]}
              rows={rows} rowKey={(r) => r.id} empty="nenhuma requisição"
            />
          )}
          {query.hasNextPage && !searchError && (
            <div><button type="button" style={secondaryButtonStyle} onClick={() => void query.fetchNextPage()}>Carregar mais</button></div>
          )}
        </div>
      </Panel>
      {openId && <LabRequisitionDetail key={openId} id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
