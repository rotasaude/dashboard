// Pendências do envio à RNDS (módulo 29; F-29.4; contrato §6; V8, V23). Lista SEM nome (o api devolve só `patient_id`): a caderneta
// abre por mutação no clique ("Abrir caderneta", `gcTime: 0`), nunca sozinha. Sem polling: lê ao abrir e quando se pede "Atualizar"
// (STATIC_QUERY). Faixa de aviso de 24 h para o responsável da sala e o administrador da cidade quando `late > 0`.
import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  getVaccinationCard, getVaccinationCatalog, listRndsPending, type RndsPendingItem, type VaccinationCard, type VaccineLocation
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";
import { STATIC_QUERY, VAC_CATALOG_KEY, VAC_PENDING_KEY, locationAbilities, rndsStatusLabel, rndsStatusTone, vaccinationError, vaccinationRoles } from "../lib/vaccination";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, panel, row, stack, title } from "./exams/styles";
import { VaccinationGate } from "./vaccination/VaccinationGate";
import { VaccineLocationPick } from "./vaccination/VaccineLocationPick";
import { rndsDetail } from "./vaccination/RndsStatusTag";
import { CardView } from "./vaccination/CardView";

export const PENDING_HINT = "Corrija o cadastro (CNS no CNES, CPF ou CNS do cidadão) e a dose volta para a fila sozinha. Doses só ficam aqui enquanto não forem aceitas.";
export const LATE_WARNING = "Há doses sem confirmação da RNDS há mais de 24 horas. Veja a lista abaixo.";

export function VaccinationPending({ now, onGoToSecurity }: { now?: Date; onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Pendências do envio" sub="doses paradas, recusadas ou perto do prazo de 24 h" allow={(r) => r.professional}>
      {() => (
        <VaccineLocationPick allow={(a, loc) => a.vaccinate && loc.kind === "vaccine_room" && !!loc.room_id}>
          {(room) => <PendingBody room={room} now={now} onGoToSecurity={onGoToSecurity} />}
        </VaccineLocationPick>
      )}
    </VaccinationGate>
  );
}

function PendingBody({ room, now: fixedNow, onGoToSecurity }: { room: VaccineLocation; now?: Date; onGoToSecurity?(): void }) {
  const roomId = room.room_id as string;
  const { user } = useAuth();
  const canSeeAlert = locationAbilities(room).lead || vaccinationRoles(user).admin;
  const pending = useInfiniteQuery({
    queryKey: [ VAC_PENDING_KEY, roomId ], queryFn: ({ pageParam }) => listRndsPending(roomId, pageParam),
    initialPageParam: null as string | null, getNextPageParam: (last) => last.next_before ?? undefined, ...STATIC_QUERY
  });
  const catalog = useQuery({ queryKey: [ VAC_CATALOG_KEY ], queryFn: getVaccinationCatalog, ...STATIC_QUERY });
  const [ card, setCard ] = useState<VaccinationCard | null>(null);
  const [ openedBy, setOpenedBy ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const seq = useRef(0);
  const read = useMutation({ gcTime: 0, mutationFn: (patientId: string) => getVaccinationCard(roomId, { patient_id: patientId }) });

  const pages = pending.data?.pages ?? [];
  const items: RndsPendingItem[] = pages.flatMap((p) => p.items);
  const late = pages[0]?.counts?.late ?? 0;
  const vaccineName = (i: RndsPendingItem) => i.immunobiological.name ?? i.immunobiological.code;

  function open(i: RndsPendingItem) {
    if (read.isPending) return;
    const mine = ++seq.current;
    setProblem(null);
    read.mutate(i.patient_id, {
      onSuccess: (c) => { if (mine === seq.current) { setOpenedBy(`${vaccineName(i)} de ${fmtDateTime(i.applied_at)}`); setCard(c); } },
      onError: (err) => { if (mine === seq.current) setProblem(vaccinationError(err)); }
    });
  }
  function close() {
    seq.current += 1;
    read.reset();
    setCard(null);
    setProblem(null);
  }

  const cols: Column<RndsPendingItem>[] = [
    { label: "Vacina", w: "2fr", card: "title", render: vaccineName },
    { label: "Aplicada em", w: "1.4fr", render: (i) => fmtDateTime(i.applied_at) },
    { label: "Situação", w: "1.6fr", render: (i) => <Tag tone={rndsStatusTone(i.rnds.status)}>{rndsStatusLabel(i.rnds.status)}</Tag> },
    { label: "Motivo", w: "2.4fr", render: (i) => rndsDetail(i.rnds) ?? "—" },
    { label: "Ação", w: "1.6fr", card: "actions", render: (i) => (
      <button type="button" style={secondaryButtonStyle} disabled={read.isPending} onClick={() => open(i)}>
        {`Abrir caderneta — ${vaccineName(i)} de ${fmtDateTime(i.applied_at)}`}
      </button>
    ) }
  ];

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Sala: ${room.name}`}</p>
      {canSeeAlert && late > 0 && <p role="alert" style={alert}>{LATE_WARNING}</p>}
      <section aria-label="Doses pendentes" style={panel}>
        <h3 style={title}>Doses que a RNDS ainda não aceitou</h3>
        <p role="note" style={{ margin: 0, fontSize: 12.5 }}>{PENDING_HINT}</p>
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} disabled={pending.isFetching} onClick={() => void pending.refetch()}>Atualizar</button>
        </div>
        {pending.isPending ? <p className="mono" style={muted}>carregando…</p>
          : pending.isError && !pending.data ? <p role="alert" style={alert}>{vaccinationError(pending.error)}</p>
          : items.length === 0 ? <EmptyState title="nenhuma dose pendente" />
          : <DataTable cols={cols} rows={items} rowKey={(i) => i.immunization_id} empty="nenhuma dose pendente" />}
        {pending.isError && pending.data && <p role="alert" style={alert}>{vaccinationError(pending.error)}</p>}
        {pending.hasNextPage && (
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} disabled={pending.isFetchingNextPage} onClick={() => void pending.fetchNextPage()}>
              Carregar mais
            </button>
          </div>
        )}
        {read.isPending && <p className="mono" style={muted}>abrindo a caderneta…</p>}
        {problem && <p role="alert" style={alert}>{problem}</p>}
      </section>
      {card && (
        <section aria-label="Caderneta aberta" style={panel}>
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} onClick={close}>Fechar caderneta</button>
          </div>
          <p style={{ margin: 0, fontSize: 12.5 }}>{`Aberta pela pendência: ${openedBy}`}</p>
          {catalog.data ? (
            <CardView room={room} card={card} catalog={catalog.data} now={fixedNow ?? new Date()}
              onCard={(c) => setCard((cur) => (cur && cur.patient.id === c.patient.id ? c : cur))} onGoToSecurity={onGoToSecurity} />
          ) : catalog.isError ? <p role="alert" style={alert}>{vaccinationError(catalog.error)}</p>
            : <p className="mono" style={muted}>carregando…</p>}
        </section>
      )}
    </div>
  );
}
