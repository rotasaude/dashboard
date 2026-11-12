// Lista da Caixa da ouvidoria (módulo 33; F-33.5, F-33.6): filtros, prazo com texto da cor e páginas por cursor (`next_before`).
// Só campos de triagem: a lista nunca mostra o texto da manifestação nem a identidade, mesmo que o api um dia mande; por isso cada
// linha é montada campo a campo na leitura e o item inteiro nunca entra no cache nem na tela. Nada em storage.
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOmbudsmanOptions, listOmbudsmanManifestations, type DeadlineColor, type IdentificationMode, type ManifestationState,
  type OmbudsmanChannel, type OmbudsmanKind, type OmbudsmanListItem, type OmbudsmanPage, type OmbudsmanRef, type OmbudsmanSubjectRef
} from "../../lib/api";
import {
  OMBUDSMAN_ERRORS, OMB_LIST_KEY, OMB_OPTIONS_KEY, STATIC_QUERY, channelLabel, isCursorError, kindLabel, modeLabel, ombudsmanRefusals, stateLabel
} from "../../lib/ombudsman";
import { fmtDay } from "../../lib/signature";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, row, stack } from "../exams/styles";
import { DeadlineTag } from "./DeadlineTag";
import { ManifestationFilters, type ListFilters } from "./ManifestationFilters";

type Row = {
  id: string; protocol: string; kind: OmbudsmanKind; identification_mode: IdentificationMode; channel: OmbudsmanChannel;
  state: ManifestationState; subject: OmbudsmanSubjectRef | null; health_unit: OmbudsmanRef | null; urgent: boolean;
  received_at: string; due_on: string | null; color: DeadlineColor | null; pending_forwardings: number;
};

function toRow(i: OmbudsmanListItem): Row {
  return {
    id: i.id, protocol: i.protocol, kind: i.kind, identification_mode: i.identification_mode, channel: i.channel, state: i.state,
    subject: i.subject, health_unit: i.health_unit, urgent: i.urgent, received_at: i.received_at, due_on: i.due_on, color: i.color,
    pending_forwardings: i.pending_forwardings
  };
}
type RowPage = { items: Row[]; next_before: string | null };
const toPage = (p: OmbudsmanPage): RowPage => ({ items: p.items.map(toRow), next_before: p.next_before });

const subjectText = (s: OmbudsmanSubjectRef | null): string => (s ? (s.parent ? `${s.parent.name} › ${s.name}` : s.name) : "—");
const pendingText = (n: number): string => `${n} ${n === 1 ? "encaminhamento pendente" : "encaminhamentos pendentes"}`;

export function ManifestationList({ onOpen }: { onOpen(id: string): void }) {
  const queryClient = useQueryClient();
  const [ filters, setFilters ] = useState<ListFilters>({});
  // A frase do cursor perdido fica até a pessoa agir de novo (Filtrar ou Carregar mais); a leitura já recomeçou.
  const [ cursorNotice, setCursorNotice ] = useState(false);
  const options = useQuery({ queryKey: [ OMB_OPTIONS_KEY ], queryFn: getOmbudsmanOptions, ...STATIC_QUERY });
  const list = useInfiniteQuery({
    queryKey: [ OMB_LIST_KEY, filters ],
    queryFn: async ({ pageParam }) => toPage(await listOmbudsmanManifestations({ ...filters, before: pageParam })),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.items);
  const cursorLost = list.isError && isCursorError(list.error);

  // Cursor recusado (a lista mudou): a frase aparece e a leitura recomeça do início.
  useEffect(() => {
    if (!cursorLost) return;
    setCursorNotice(true);
    void queryClient.resetQueries({ queryKey: [ OMB_LIST_KEY ] });
  }, [ cursorLost, queryClient ]);

  return (
    <div style={stack}>
      <ManifestationFilters options={options.data} onApply={(f) => { setCursorNotice(false); setFilters(f); }} />
      {cursorNotice && <p role="alert" style={alert}>{OMBUDSMAN_ERRORS.invalid_cursor}</p>}
      {list.isPending && <p className="mono" style={muted}>carregando…</p>}
      {list.isError && !cursorLost && (
        <div style={row}>
          <p role="alert" style={alert}>{ombudsmanRefusals(list.error)[0].text}</p>
          {!list.data && (
            <button type="button" style={secondaryButtonStyle} onClick={() => void list.refetch()}>Tentar de novo</button>
          )}
        </div>
      )}
      {list.data && (
        <DataTable<Row>
          label="Manifestações"
          cols={[
            { label: "Protocolo", w: "1.2fr", card: "title", render: (r) => <span>{r.protocol}<br /><span style={muted}>{fmtDay(r.received_at)}</span></span> },
            { label: "Tipo", w: "1.4fr", render: (r) => `${kindLabel(r.kind)} · ${modeLabel(r.identification_mode)} · ${channelLabel(r.channel)}` },
            { label: "Estado", w: "1.2fr", render: (r) => stateLabel(r.state) },
            { label: "Assunto", w: "1.4fr", render: (r) => subjectText(r.subject) },
            { label: "Unidade", w: "1.2fr", render: (r) => r.health_unit?.name ?? "—" },
            { label: "Prazo", w: "1.2fr", render: (r) => <DeadlineTag color={r.color} dueOn={r.due_on} /> },
            {
              label: "Situação", w: "1.4fr", render: (r) => (
                <span style={row}>
                  {r.urgent && <Tag tone="down">urgente</Tag>}
                  {r.pending_forwardings > 0 && <span>{pendingText(r.pending_forwardings)}</span>}
                </span>
              )
            },
            {
              label: "", w: "auto", card: "actions", render: (r) => (
                <button type="button" style={secondaryButtonStyle} aria-label={`Abrir ${r.protocol}`} onClick={() => onOpen(r.id)}>Abrir</button>
              )
            }
          ]}
          rows={rows} rowKey={(r) => r.id} empty="Nenhuma manifestação com esses filtros"
        />
      )}
      {list.data && list.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => { setCursorNotice(false); void list.fetchNextPage(); }}>
            {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
