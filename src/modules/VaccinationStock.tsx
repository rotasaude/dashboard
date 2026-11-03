// Imunobiológicos e frascos (módulo 29; F-29.5) com as peças do 27a. Local por VaccineLocationPick (onde a pessoa tem papel: vacinador,
// responsável ou almoxarife; as salas com `roles: []` que o almoxarife recebe são só destinos de transferência).
// - Rede de frio (stock_keeper): entrada por nota ou doação e inventário inicial; transferência às salas ativas (com from_location_id);
//   posição; inventário e ajustes (perda e vencimento com o motivo do SIES) e os ajustes pendentes (inclusive o descarte de excursão).
// - Sala: posição e recebimento de transferência para toda a equipe; inventário inicial e ajustes só para o responsável (room_lead).
//   A sala não lança nota (o api dá 403). Os frascos abertos entram na Task 11.
// As frases de sucesso ficam aqui, fora dos formulários que se limpam. Sem polling; nada em URL, log ou storage. "Hoje" é o da prop
// (testes) ou lido a cada render.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getVaccinationCatalog, listMyVaccineLocations, type VaccinationCatalog, type VaccineLocation } from "../lib/api";
import { useAuth } from "../lib/auth";
import { todayInCity } from "../lib/campaigns";
import { STATIC_QUERY, VAC_CATALOG_KEY, VAC_LOCATIONS_KEY, locationAbilities, vaccinationError } from "../lib/vaccination";
import { Panel } from "../components/Panel";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, okText, row, stack } from "./exams/styles";
import { AdjustmentForm, adjustmentSavedText } from "./pharmacy/AdjustmentForm";
import { PendingAdjustments } from "./pharmacy/PendingAdjustments";
import { TransfersBody } from "./PharmacyTransfers";
import { VaccinationGate } from "./vaccination/VaccinationGate";
import { VaccineLocationPick } from "./vaccination/VaccineLocationPick";
import { VaccinePositions } from "./vaccination/VaccinePositions";
import { VaccineReceiptForm } from "./vaccination/VaccineReceiptForm";

export const RECEIPT_SAVED = "Entrada registrada: o saldo da rede de frio foi atualizado.";
export const OPENING_SAVED = "Inventário inicial registrado.";

// `now` fica na assinatura do plano (os frascos abertos, Task 11, leem o relógio); aqui só o dia conta.
export function VaccinationStock({ today, onGoToSecurity }: { today?: string; now?: Date; onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Imunobiológicos e frascos" sub="entrada, transferência, frascos abertos, posição e perdas" allow={(r) => r.professional || r.keeper}>
      {() => (
        <VaccineLocationPick allow={(a) => a.vaccinate || a.keeper}>
          {(loc) => <StockBody location={loc} today={today ?? todayInCity()} onGoToSecurity={onGoToSecurity} />}
        </VaccineLocationPick>
      )}
    </VaccinationGate>
  );
}

// O Panel já é um <section aria-label={title}>: cada bloco é uma região nomeada.
function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return <Panel title={title} sub={sub}>{children}</Panel>;
}

function StockBody({ location, today, onGoToSecurity }: { location: VaccineLocation; today: string; onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const abilities = locationAbilities(location);
  const coldChain = location.kind === "cold_chain_central" && abilities.keeper;
  const catalog = useQuery({ queryKey: [ VAC_CATALOG_KEY ], queryFn: getVaccinationCatalog, ...STATIC_QUERY });
  // Mesma consulta (e cache) do VaccineLocationPick: as salas ativas são os destinos da rede de frio.
  const locations = useQuery({
    queryKey: [ VAC_LOCATIONS_KEY, user?.id ?? null ], queryFn: listMyVaccineLocations, enabled: !!user && coldChain, ...STATIC_QUERY
  });
  const rooms = (locations.data ?? []).filter((l) => l.kind === "vaccine_room" && l.active && l.id !== location.id);

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      {coldChain && (
        <Section title="Entrada e inventário inicial" sub="nota fiscal, doação ou o saldo inicial, em frascos fechados">
          {catalog.data ? <EntryBlock location={location} today={today} catalog={catalog.data} /> : <CatalogState catalog={catalog} />}
        </Section>
      )}
      <Section title="Transferências" sub={coldChain ? "envio às salas de vacina e acompanhamento" : "recebimento conferido do que a rede de frio enviou"}>
        <TransfersBody location={location} today={today} canSend={coldChain} destinations={coldChain ? rooms : undefined} focusNotice />
      </Section>
      <Section title="Posição" sub="saldo em doses por lote">
        <VaccinePositions location={location} today={today} />
      </Section>
      {(coldChain || abilities.lead) && (
        <Section title="Inventário e ajustes" sub="ajustes, perdas e vencimentos, com aprovação">
          <AdjustmentsBlock location={location} today={today} catalog={catalog} withOpening={!coldChain} onGoToSecurity={onGoToSecurity} />
        </Section>
      )}
    </div>
  );
}

type CatalogQuery = UseQueryResult<VaccinationCatalog>;

// Regra de teclado (plan-context, "Tablet e teclado"): depois de registrar, o foco vai à frase de sucesso.
function Notice({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [ text ]);
  return <p ref={ref} tabIndex={-1} role="status" style={okText}>{text}</p>;
}

function CatalogState({ catalog }: { catalog: CatalogQuery }) {
  if (catalog.isError) return <p role="alert" style={alert}>{vaccinationError(catalog.error)}</p>;
  return <p className="mono" style={muted}>carregando…</p>;
}
function EntryBlock({ location, today, catalog }: { location: VaccineLocation; today: string; catalog: VaccinationCatalog }) {
  const [ mode, setMode ] = useState<"receipt" | "opening">("receipt");
  const [ notice, setNotice ] = useState<string | null>(null);
  const choose = (m: "receipt" | "opening") => { setNotice(null); setMode(m); };
  return (
    <div style={stack}>
      <div style={row} role="group" aria-label="Tipo de lançamento">
        <button type="button" style={secondaryButtonStyle} aria-pressed={mode === "receipt"} onClick={() => choose("receipt")}>Entrada por nota ou doação</button>
        <button type="button" style={secondaryButtonStyle} aria-pressed={mode === "opening"} onClick={() => choose("opening")}>Inventário inicial</button>
      </div>
      {notice && <Notice text={notice} />}
      <VaccineReceiptForm key={mode} location={location} catalog={catalog} mode={mode} today={today} onStart={() => setNotice(null)}
        onDone={() => setNotice(mode === "opening" ? OPENING_SAVED : RECEIPT_SAVED)} />
    </div>
  );
}

function AdjustmentsBlock({ location, today, catalog, withOpening, onGoToSecurity }: {
  location: VaccineLocation; today: string; catalog: CatalogQuery; withOpening: boolean; onGoToSecurity?(): void;
}) {
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ stale, setStale ] = useState<string | null>(null);
  const clear = () => { setNotice(null); setStale(null); };
  return (
    <div style={stack}>
      {notice && <Notice text={notice} />}
      {stale && <p role="alert" style={alert}>{stale}</p>}
      {/* O inventário inicial da sala é do responsável (o api traduz room_lead → stock_keeper); a rede de frio o tem na Entrada. */}
      {withOpening && (catalog.data
        ? <VaccineReceiptForm location={location} catalog={catalog.data} mode="opening" today={today} onStart={clear}
          onDone={() => { setStale(null); setNotice(OPENING_SAVED); }} />
        : <CatalogState catalog={catalog} />)}
      {/* Os motivos de perda do SIES vêm do catálogo (V28); sem ele ainda, a perda de vacina só não passa da revisão. */}
      <AdjustmentForm location={location} today={today} lossReasons={catalog.data?.physical_loss_reasons ?? []} onStart={clear} onGoToSecurity={onGoToSecurity}
        onDone={(saved, kind) => { setStale(null); setNotice(adjustmentSavedText(kind, saved.status)); }} />
      <PendingAdjustments location={location} onGoToSecurity={onGoToSecurity}
        onNotice={(text) => { setStale(null); setNotice(text); }} onStale={(text) => { setNotice(null); setStale(text); }} />
    </div>
  );
}
