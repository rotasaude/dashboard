// src/modules/ZooDemands.tsx
// Tela "Demandas" do centro de zoonoses (módulo 35b, F-35.13): a fila do centro (vinda da ouvidoria) e o andamento. Exige a
// equipe e a ouvidoria utilizável (Q35). A fila nunca traz extrato, endereço, protocolo nem identidade; o api filtra `state` por
// um valor só, então "Abertas" junta três leituras, cada uma com o seu cursor.
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { listDemands, type DemandState, type ZoonosesDemand } from "../lib/api";
import { useAuth } from "../lib/auth";
import { cityIsoDate } from "../lib/format";
import { STATIC_QUERY, ZOO_DEMANDS_KEY, canUseZooDemands, zooLabel, zoonosesError } from "../lib/zoonoses";
import { ZOONOSES_OMBUDSMAN_DISABLED } from "../lib/zoonosesErrors";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { SegmentedControl } from "../shell/SegmentedControl";
import { muted, row, stack } from "./exams/styles";
import { DeadlineTag } from "./ombudsman/DeadlineTag";
import { DemandDetail } from "./zoonoses/DemandDetail";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { useZooDomains } from "./zoonoses/useZooDomains";

type Tab = "open" | "closed";
const STATES: Record<Tab, DemandState[]> = { open: [ "open", "scheduled", "inspected" ], closed: [ "closed" ] };
type Cursors = Partial<Record<DemandState, string | null>>;

export function ZooDemands({ today }: { today?: string } = {}) {
  const { user } = useAuth();
  return (
    <ZoonosesGate title="Demandas" sub="zoonoses · demandas" allow={(r) => r.team}>
      {() => (user && canUseZooDemands(user)
        ? <Demands today={today ?? cityIsoDate()} />
        : <EmptyState title={ZOONOSES_OMBUDSMAN_DISABLED} />)}
    </ZoonosesGate>
  );
}

function Demands({ today }: { today: string }) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const [ tab, setTab ] = useState<Tab>("open");
  const [ picked, setPicked ] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: [ ZOO_DEMANDS_KEY, tab ], ...STATIC_QUERY, initialPageParam: {} as Cursors,
    queryFn: async ({ pageParam }) => {
      const wanted = STATES[tab].filter((s) => !(s in pageParam) || pageParam[s] !== undefined);
      const pages = await Promise.all(wanted.map(async (s) => ({ s, page: await listDemands({ state: s, before: pageParam[s] ?? null }) })));
      const next: Cursors = {};
      for (const { s, page } of pages) if (page.next_before) next[s] = page.next_before;
      return { items: pages.flatMap((p) => p.page.items), next };
    },
    getNextPageParam: (last) => (Object.keys(last.next).length > 0 ? onlyNext(last.next, tab) : undefined)
  });
  // Ordem global por prazo sobre todas as páginas já lidas (cada leitura vem ordenada só dentro do próprio estado).
  const rows = (q.data?.pages.flatMap((p) => p.items) ?? []).slice().sort((a, b) => a.due_on.localeCompare(b.due_on));
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_DEMANDS_KEY ] });

  const cols: Column<ZoonosesDemand>[] = [
    { label: "Subtipo", w: "1.6fr", card: "title", render: (d) => zooLabel(domains?.subtypes, d.subtype) },
    { label: "Prazo", w: "1.2fr", render: (d) => <DeadlineTag color={d.color} dueOn={d.due_on} /> },
    { label: "Estado", w: "0.9fr", render: (d) => <Tag tone="neutral">{zooLabel(domains?.demand_states, d.state)}</Tag> },
    { label: "Ações", w: "1fr", card: "actions", render: (d) => <ActionButton variant="secondary" onClick={() => setPicked(d.id)}>Ver demanda</ActionButton> }
  ];
  return (
    <div style={stack}>
      <SegmentedControl<Tab> options={[ { key: "open", label: "Abertas" }, { key: "closed", label: "Encerradas" } ]} value={tab}
        onChange={(t) => { setTab(t); setPicked(null); }} />
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <EmptyState title={zoonosesError(q.error)} />}
      {q.data && <DataTable<ZoonosesDemand> label="Demandas" cols={cols} rows={rows} rowKey={(d) => d.id} empty="nenhuma demanda" />}
      {q.hasNextPage && <div style={row}><ActionButton variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</ActionButton></div>}
      {picked && <DemandDetail key={picked} id={picked} today={today} onChanged={() => void reread()} />}
    </div>
  );
}

// Só os estados que ainda têm página; os outros ficam de fora (chave `undefined` = esgotado).
function onlyNext(next: Cursors, tab: Tab): Cursors {
  const out: Cursors = {};
  for (const s of STATES[tab]) out[s] = next[s] ?? undefined;
  return out;
}
