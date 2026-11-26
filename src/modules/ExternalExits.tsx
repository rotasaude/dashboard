// "Saída externa" (módulo 27b; contrato Q16/Q23; F-16): devolução, remanejamento, doação e empréstimo para fora da rede. É "dado de
// origem": abre SEM o `bnafar`, com o estoque de algum domínio utilizável (farmácia, campo ou vacina). O almoxarife do local escolhe o
// local e vê o formulário e a lista dele; o administrador escolhe o local entre todos e vê só a lista. O motivo não vem na lista:
// "Ver motivo" lê o detalhe no clique. Sem pessoa nesta tela; sem polling.
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { getBnafarDomains, getExternalExit, listExternalExits, type BnafarDomains, type ExternalExit } from "../lib/api";
import { EXTERNAL_EXITS_KEY, STATIC_QUERY, bnafarError, exitTypeLabel } from "../lib/bnafar";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import { PHARMACY_NO_ROLE } from "../lib/pharmacy";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, row, stack } from "./exams/styles";
import { BnafarGate } from "./bnafar/BnafarGate";
import { ExitLocationPick, type ExitLocation } from "./pharmacy/ExitLocationPick";
import { ExternalExitForm } from "./pharmacy/ExternalExitForm";

export const EXIT_RECORDED = "Saída registrada. Ela vai à BNAFAR no envio de amanhã, se o envio estiver ligado.";

type Props = { today?: string; onGoToSecurity?: () => void; onGoToLocations?: () => void; onGoToColdChain?: () => void; onGoToVectorProducts?: () => void; onGoToAdjustments?: () => void };

export function ExternalExits({ today, onGoToSecurity }: Props) {
  const { user } = useAuth();
  // O chefe de sala não tem Membership de almoxarife na sessão: a sala diz se ele grava (ExitLocationPick); sem local, a frase de sem local.
  const roomStaff = !!user && hasFeature(user, "vaccination") && !!user.memberships?.some((m) => m.role === "health_professional");
  return (
    <BnafarGate title="Saída externa" sub="Devolução, remanejamento, doação e empréstimo para fora da rede" needs="stock" allow={() => true}>
      {(roles) => (roles.admin || roles.keeper || roomStaff)
        ? <ExitsBody today={today} onGoToSecurity={onGoToSecurity} />
        : <EmptyState title={PHARMACY_NO_ROLE} />}
    </BnafarGate>
  );
}

function ExitsBody({ today, onGoToSecurity }: { today?: string; onGoToSecurity?: () => void }) {
  // Sem os tipos do api a tela usa os quatro conhecidos; a leitura é do estoque, nunca do `bnafar`.
  const domains = useQuery({ queryKey: [ EXTERNAL_EXITS_KEY, "domains" ], queryFn: getBnafarDomains, ...STATIC_QUERY });
  return (
    <ExitLocationPick>
      {(loc) => <LocationExits location={loc} today={today ?? todayInCity()} domains={domains.data ?? null} onGoToSecurity={onGoToSecurity} />}
    </ExitLocationPick>
  );
}

function LocationExits({ location, today, domains, onGoToSecurity }: { location: ExitLocation; today: string; domains: BnafarDomains | null; onGoToSecurity?: () => void }) {
  const [ notice, setNotice ] = useState<string | null>(null);
  return (
    <div style={stack}>
      {notice && <p role="status" style={muted}>{notice}</p>}
      {location.keeper && (
        <ExternalExitForm location={location} today={today} domains={domains} onGoToSecurity={onGoToSecurity} onDone={() => setNotice(EXIT_RECORDED)} />
      )}
      <ExitList location={location} domains={domains} />
    </div>
  );
}

function ExitList({ location, domains }: { location: ExitLocation; domains: BnafarDomains | null }) {
  const list = useInfiniteQuery({
    queryKey: [ EXTERNAL_EXITS_KEY, "list", location.id ],
    queryFn: ({ pageParam }) => listExternalExits({ locationId: location.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.external_exits);
  return (
    <div style={stack}>
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} disabled={list.isFetching} onClick={() => void list.refetch()}>Atualizar</button>
      </div>
      {list.isPending && <p className="mono" style={muted}>carregando…</p>}
      {list.isError && !list.data && <p role="alert" style={alert}>{bnafarError(list.error)}</p>}
      {list.data && (
        <DataTable<ExternalExit>
          label="Saídas externas"
          cols={[
            { label: "Data", w: "1fr", card: "title", render: (e) => <span className="mono">{fmtDateTime(e.recorded_at)}</span> },
            { label: "Tipo", w: "1.2fr", render: (e) => exitTypeLabel(domains, e.exit_type) },
            { label: "Destino", w: "1fr", render: (e) => <>{e.destination_kind === "cnes" ? "CNES" : "CNPJ"} <span className="mono">{e.destination_code}</span></> },
            { label: "Itens", w: "1.6fr", render: (e) => (
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {e.items.map((it, i) => <span key={`${it.lot.id}-${i}`}>{`${it.quantity} × ${it.lot.item.name} (lote ${it.lot.lot_number})`}</span>)}
              </span>
            ) },
            { label: "", w: "auto", card: "actions", render: (e) => <ReasonButton id={e.id} /> }
          ]}
          rows={rows} rowKey={(e) => e.id} empty="nenhuma saída externa registrada neste local"
        />
      )}
      {list.data && list.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}

// O motivo só é lido no clique (a lista não o traz).
function ReasonButton({ id }: { id: string }) {
  const [ open, setOpen ] = useState(false);
  const detail = useQuery({ queryKey: [ EXTERNAL_EXITS_KEY, "reason", id ], queryFn: () => getExternalExit(id), enabled: open, ...STATIC_QUERY });
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button type="button" style={secondaryButtonStyle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Ocultar motivo" : "Ver motivo"}</button>
      {open && detail.isPending && <span className="mono" style={muted}>carregando…</span>}
      {open && detail.isError && <span role="alert" style={alert}>{bnafarError(detail.error)}</span>}
      {open && detail.data && <span>{detail.data.reason ?? "—"}</span>}
    </span>
  );
}
