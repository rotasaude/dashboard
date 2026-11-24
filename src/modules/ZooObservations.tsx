// src/modules/ZooObservations.tsx
// Tela "Observação do agressor" do centro de zoonoses (módulo 35b, F-35.14): a fila das observações (em curso e encerradas) e o
// detalhe. A fila nunca traz tutor, paciente, idade ou unidade (decisão 32); o contato só por clique no detalhe.
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { listObservations, type BiteObservation } from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { fmtDay } from "../lib/homeVisits";
import { STATIC_QUERY, ZOO_OBSERVATIONS_KEY, observationConditionLabel, observationDaysText, zooLabel, zoonosesError } from "../lib/zoonoses";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { SegmentedControl } from "../shell/SegmentedControl";
import { muted, row, stack } from "./exams/styles";
import { ObservationDetail } from "./zoonoses/ObservationDetail";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { useZooDomains } from "./zoonoses/useZooDomains";

type Tab = "open" | "closed";

export function ZooObservations({ today, onGoToShelter }: { today?: string; onGoToShelter?(): void } = {}) {
  return (
    <ZoonosesGate title="Observação do agressor" sub="zoonoses · observação" allow={(r) => r.team}>
      {() => <Observations today={today ?? cityIsoDate()} onGoToShelter={onGoToShelter} />}
    </ZoonosesGate>
  );
}

function Observations({ today, onGoToShelter }: { today: string; onGoToShelter?(): void }) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const [ tab, setTab ] = useState<Tab>("open");
  const [ picked, setPicked ] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: [ ZOO_OBSERVATIONS_KEY, tab ], ...STATIC_QUERY, initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listObservations({ state: tab, before: pageParam }),
    getNextPageParam: (last) => last.next_before ?? undefined
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_OBSERVATIONS_KEY ] });

  const cols: Column<BiteObservation>[] = [
    { label: "Espécie", w: "0.8fr", card: "title", render: (o) => zooLabel(domains?.species, o.species) },
    { label: "Condição", w: "1fr", render: (o) => (o.condition ? observationConditionLabel(o.condition) : "—") },
    { label: "Exposição", w: "0.9fr", render: (o) => fmtDay(o.exposure_on) },
    { label: "Fim", w: "0.9fr", render: (o) => fmtDay(o.ends_on) },
    { label: "Prazo", w: "1fr", render: (o) => (o.state === "open" ? observationDaysText(o.ends_on, today) : "encerrada") },
    { label: "Local", w: "0.8fr", render: (o) => (o.place === "shelter" ? "canil" : "casa") },
    { label: "Ações", w: "1fr", card: "actions", render: (o) => <ActionButton variant="secondary" onClick={() => setPicked(o.id)}>Ver observação</ActionButton> }
  ];
  return (
    <div style={stack}>
      <SegmentedControl<Tab> options={[ { key: "open", label: "Em observação" }, { key: "closed", label: "Encerradas" } ]} value={tab}
        onChange={(t) => { setTab(t); setPicked(null); }} />
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <EmptyState title={zoonosesError(q.error)} />}
      {q.data && <DataTable<BiteObservation> label="Observações" cols={cols} rows={rows} rowKey={(o) => o.id} empty="nenhuma observação" />}
      {q.hasNextPage && <div style={row}><ActionButton variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</ActionButton></div>}
      {picked && <ObservationDetail key={picked} id={picked} today={today} onChanged={() => void reread()} onGoToShelter={onGoToShelter} />}
    </div>
  );
}
