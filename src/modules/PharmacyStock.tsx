// PharmacyStock — posição por local e por lote, extrato e estoque mínimo (módulo 27a; F-27.7; contrato §6).
// Tela de CONSULTA: o `LocationPick` aceita qualquer local (o almoxarife do central vê também os alheios, com `roles: []`); as AÇÕES
// (editar mínimos) só aparecem onde `locationRoles(loc)` dá o papel de almoxarife. Posição, lotes e extrato não têm dado pessoal:
// leitura sem trilha e sem polling (STATIC_QUERY). Os filtros só valem no "Filtrar" (o campo digitado não lê sozinho) e `expiring` /
// `below_minimum` só vão quando marcados. O api ordena a página por id; a ordem visível (nome do item) é daqui (H10), página a página.
// A unidade mostrada é a de dispensação ("30 cápsula"), nunca `unit` (a concentração).
import { useState, type FormEvent } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listPositions, type LotBalance, type PharmacyLocation, type StockPosition } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDay } from "../lib/exams";
import {
  PH_POSITIONS_KEY, STATIC_QUERY, fmtQuantity, locationRoles, pharmacyError, sortPositions
} from "../lib/pharmacy";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, checkLabel, fieldLabel, muted, row, stack, title } from "./exams/styles";
import { LocationPick } from "./pharmacy/LocationPick";
import { LotStatement } from "./pharmacy/LotStatement";
import { MinimumsPanel } from "./pharmacy/MinimumsPanel";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

export const MEDICATION_MIN = 2;
export const MEDICATION_TOO_SHORT = `digite ao menos ${MEDICATION_MIN} letras do medicamento`;

interface Applied { q: string | null; expiring: boolean; belowMinimum: boolean; all: boolean }
const FIRST: Applied = { q: null, expiring: false, belowMinimum: false, all: false };

const positionKey = (p: StockPosition) => `${p.location.id}:${p.item.catalog_item_id}`;
const withUnit = (qty: string | null | undefined, p: StockPosition) => (qty === null || qty === undefined ? "—" : `${fmtQuantity(qty)} ${p.item.dispensing_unit}`);

export function PharmacyStock({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <PharmacyGate title="Posição e extrato" sub="saldo por local e lote, extrato e estoque mínimo" allow={(r) => r.pharmacist || r.assistant || r.keeper}>
      {() => (
        <LocationPick allow={() => true}>
          {(loc) => <Body location={loc} today={today} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

function Body({ location, today }: { location: PharmacyLocation; today: string }) {
  const roles = locationRoles(location);
  // "Todos os locais" (sem location_id): só o almoxarife do central; o api recusa de novo.
  const canAll = location.kind === "central" && roles.keeper;
  const [ draft, setDraft ] = useState({ q: "", expiring: false, belowMinimum: false, all: false });
  const [ applied, setApplied ] = useState<Applied>(FIRST);
  const [ filterError, setFilterError ] = useState<string | null>(null);
  const [ openKey, setOpenKey ] = useState<string | null>(null);
  const [ lotId, setLotId ] = useState<string | null>(null);

  const all = canAll && applied.all;
  const scope = all ? null : location.id;
  const positions = useInfiniteQuery({
    queryKey: [ PH_POSITIONS_KEY, scope, applied.q, applied.expiring, applied.belowMinimum ],
    queryFn: ({ pageParam }) => listPositions({
      locationId: scope, q: applied.q, expiring: applied.expiring || undefined, belowMinimum: applied.belowMinimum || undefined, before: pageParam
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rows = (positions.data?.pages ?? []).flatMap((p) => sortPositions(p.positions));
  const open = rows.find((p) => positionKey(p) === openKey) ?? null;

  function filter(e: FormEvent) {
    e.preventDefault();
    const q = draft.q.trim();
    if (q.length > 0 && q.length < MEDICATION_MIN) { setFilterError(MEDICATION_TOO_SHORT); return; }
    setFilterError(null);
    setOpenKey(null); setLotId(null);
    setApplied({ q: q || null, expiring: draft.expiring, belowMinimum: draft.belowMinimum, all: draft.all });
  }

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      <form onSubmit={filter} style={{ ...row, alignItems: "flex-end" }}>
        <label style={{ ...fieldLabel, flex: "1 1 20ch" }}>
          Medicamento
          <input value={draft.q} style={inputStyle} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </label>
        <label style={checkLabel}>
          <input type="checkbox" checked={draft.expiring} onChange={(e) => setDraft({ ...draft, expiring: e.target.checked })} />
          Vencendo
        </label>
        <label style={checkLabel}>
          <input type="checkbox" checked={draft.belowMinimum} onChange={(e) => setDraft({ ...draft, belowMinimum: e.target.checked })} />
          Abaixo do mínimo
        </label>
        {canAll && (
          <label style={checkLabel}>
            <input type="checkbox" checked={draft.all} onChange={(e) => setDraft({ ...draft, all: e.target.checked })} />
            Todos os locais
          </label>
        )}
        <button type="submit" style={buttonStyle}>Filtrar</button>
      </form>
      {filterError && <p role="alert" style={alert}>{filterError}</p>}

      {positions.isPending && <p className="mono" style={muted}>carregando…</p>}
      {positions.isError && <p role="alert" style={alert}>{pharmacyError(positions.error)}</p>}
      {positions.data && rows.length === 0 && !positions.hasNextPage && <EmptyState title="nenhuma posição encontrada" />}
      {rows.length > 0 && (
        <DataTable<StockPosition>
          cols={[
            { label: "Local", w: "1fr", render: (p) => p.location.name },
            { label: "Medicamento", w: "1.6fr", card: "title", render: (p) => p.item.name },
            { label: "Saldo", w: "0.8fr", align: "right", render: (p) => <span className="mono">{withUnit(p.balance, p)}</span> },
            { label: "Mínimo", w: "0.8fr", align: "right", render: (p) => <span className="mono">{withUnit(p.minimum, p)}</span> },
            { label: "Situação", w: "1fr", card: "pair", render: (p) => (
              <span style={row}>
                {p.below_minimum && <Tag tone="down">abaixo do mínimo</Tag>}
                {p.expiring_soon && <Tag tone="warn">vencendo</Tag>}
              </span>
            ) },
            { label: "", w: "auto", card: "actions", render: (p) => (
              <button type="button" style={secondaryButtonStyle} aria-label={`Lotes de ${p.item.name}`} aria-expanded={positionKey(p) === openKey}
                onClick={() => { setLotId(null); setOpenKey(positionKey(p) === openKey ? null : positionKey(p)); }}>Lotes</button>
            ) }
          ]}
          rows={rows} rowKey={positionKey}
        />
      )}
      {positions.data && positions.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={positions.isFetchingNextPage} onClick={() => void positions.fetchNextPage()}>
            {positions.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}

      {open && <Lots position={open} today={today} lotId={lotId} onStatement={setLotId} />}
      {roles.keeper && <MinimumsPanel location={location} />}
    </div>
  );
}

function Lots({ position, today, lotId, onStatement }: { position: StockPosition; today: string; lotId: string | null; onStatement(id: string | null): void }) {
  const unit = position.item.dispensing_unit;
  const chosen = position.lots.find((b) => b.lot.id === lotId) ?? null;
  return (
    <section aria-label={`Lotes de ${position.item.name}`} style={box}>
      <h3 style={title}>{`Lotes de ${position.item.name} — ${position.location.name}`}</h3>
      <DataTable<LotBalance>
        cols={[
          { label: "Lote", w: "1fr", card: "title", render: (b) => <span className="mono">{b.lot.lot_number}</span> },
          { label: "Validade", w: "1fr", render: (b) => (
            <span style={row}>{fmtDay(b.lot.expires_on)}{b.lot.expires_on < today && <Tag tone="down">vencido</Tag>}</span>
          ) },
          { label: "Saldo", w: "0.8fr", align: "right", render: (b) => <span className="mono">{`${fmtQuantity(b.balance)} ${unit}`}</span> },
          { label: "Em trânsito", w: "0.8fr", align: "right", render: (b) => <span className="mono">{`${fmtQuantity(b.in_transit)} ${unit}`}</span> },
          { label: "", w: "auto", card: "actions", render: (b) => (
            <button type="button" style={secondaryButtonStyle} aria-label={`Extrato do lote ${b.lot.lot_number}`} aria-expanded={b.lot.id === lotId}
              onClick={() => onStatement(b.lot.id === lotId ? null : b.lot.id)}>Extrato</button>
          ) }
        ]}
        rows={position.lots} rowKey={(b) => b.lot.id} empty="nenhum lote com saldo ou em trânsito"
      />
      {chosen && <LotStatement key={`${chosen.lot.id}:${position.location.id}`} lotId={chosen.lot.id} locationId={position.location.id} lotNumber={chosen.lot.lot_number} />}
    </section>
  );
}
