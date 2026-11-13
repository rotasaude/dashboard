// src/modules/homeVisits/DayList.tsx
// Folhas da equipe (módulo 24b, F-24.10): uma linha por folha, sem pessoa e sem trilha. Mostra profissional, dia, folha N, contagens
// e a situação da ficha (só leitura: "Gerar de novo" e "Reenviar" ficam na Produção). A ordem é a do api, nunca reordenada aqui.
// Abrir uma folha com visitas lê a folha (nominal, com trilha, uma vez) e a mostra pelo `DaySheet`, sem fechar nem retirar quando
// não é a dela.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getHomeVisitDay, type HomeVisitDay, type HomeVisitDomains } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { HV_DAYS_KEY, HV_DAY_KEY, NOMINAL_QUERY, dayStateLabel, fichaLabel, homeVisitError } from "../../lib/homeVisits";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted } from "../exams/styles";
import { DaySheet } from "./DaySheet";
import { WriteLockProvider } from "./writeLock";

export function DayList({ days, onOpen }: { days: HomeVisitDay[]; onOpen(day: HomeVisitDay): void }) {
  const cols: Column<HomeVisitDay>[] = [
    { label: "Dia", w: "1fr", card: "title", render: (d) => <strong>{fmtDay(d.day)}</strong> },
    { label: "Profissional", w: "1.4fr", render: (d) => d.professional.name },
    { label: "Folha", w: "0.5fr", card: "pair", render: (d) => d.sequence },
    { label: "Visitas", w: "0.6fr", card: "pair", render: (d) => d.visits_count },
    { label: "Retiradas", w: "0.6fr", card: "pair", render: (d) => d.withdrawn_count },
    { label: "Situação", w: "0.9fr", render: (d) => <Tag tone={d.state === "open" ? "info" : "neutral"} mono={false}>{dayStateLabel(d.state)}</Tag> },
    { label: "Ficha", w: "1.6fr", render: (d) => { const f = fichaLabel(d.ficha); return <Tag tone={f.tone} mono={false}>{f.text}</Tag>; } },
    { label: "", w: "auto", card: "actions", render: (d) => (
      <button type="button" style={secondaryButtonStyle} aria-label={`Abrir folha de ${fmtDay(d.day)}${d.sequence > 1 ? `, folha ${d.sequence}` : ""}, ${d.professional.name}`} onClick={() => onOpen(d)}>Abrir</button>
    ) }
  ];
  return <DataTable cols={cols} rows={days} rowKey={(d) => d.id} label="Folhas da equipe" empty="nenhuma folha neste período" />;
}

// A folha aberta pelo "Abrir". A leitura nominal só acontece se há visita para mostrar; o cabeçalho de uma folha sem visita já
// vem da lista.
export function DayDetail({ summary, domains }: { summary: HomeVisitDay; domains: HomeVisitDomains }) {
  const queryClient = useQueryClient();
  const withVisits = summary.visits_count + summary.withdrawn_count > 0;
  const detail = useQuery({ queryKey: [ HV_DAY_KEY, summary.id ], queryFn: () => getHomeVisitDay(summary.id), enabled: withVisits, ...NOMINAL_QUERY });
  if (withVisits && detail.isError) return <p role="alert" style={alert}>{homeVisitError(detail.error)}</p>;
  if (withVisits && !detail.data) return <p role="status" style={muted}>Carregando a folha…</p>;
  const loaded = withVisits && detail.data ? detail.data : { ...summary, visits: [] };
  // Só leitura para quem não é o dono: nada de retirar (o api também recusa).
  const day = loaded.own ? loaded : { ...loaded, visits: loaded.visits?.map((v) => ({ ...v, can_withdraw: false })) };
  return (
    <WriteLockProvider>
      <DaySheet day={day} domains={domains} onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: [ HV_DAY_KEY, summary.id ] });
        void queryClient.invalidateQueries({ queryKey: [ HV_DAYS_KEY ] });
      }} />
    </WriteLockProvider>
  );
}
