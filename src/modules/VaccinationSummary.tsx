// Resumo mensal de imunobiológicos no formato do SIES/SIPNI (módulo 29; F-29.5; contrato §7; §15 V14, V25, V28). Local: a sala ou a rede
// de frio onde a pessoa tem papel (VaccineLocationPick). "Mês" (padrão: o atual) é conferido antes de ir ao api (`monthProblem`); "Ver
// resumo" lê a sala ou a rede de frio com STATIC_QUERY (sem polling). Só contagens: nenhuma coluna de pessoa. A resposta é identificada
// pelo local e pelo mês pedidos: resposta atrasada de outra escolha não troca a tela. Os rótulos da perda física vêm do catálogo (V28);
// código desconhecido aparece cru. "Hoje" é o da prop (testes) ou lido a cada render.
import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMonthlySummary, getVaccinationCatalog, type MonthlySummaryRow, type VaccineLocation } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtNumber } from "../lib/format";
import { STATIC_QUERY, VAC_CATALOG_KEY, VAC_SUMMARY_KEY, currentMonth, monthProblem, vaccinationError } from "../lib/vaccination";
import { DataTable } from "../components/DataTable";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { VaccinationGate } from "./vaccination/VaccinationGate";
import { VaccineLocationPick } from "./vaccination/VaccineLocationPick";

type Line = { kind: "row"; row: MonthlySummaryRow } | { kind: "total" };

const sum = (rows: MonthlySummaryRow[], pick: (r: MonthlySummaryRow) => number): number => rows.reduce((n, r) => n + pick(r), 0);
const signed = (n: number): string => (n > 0 ? `+${fmtNumber(n)}` : n < 0 ? `−${fmtNumber(-n)}` : "0");
const physical = (r: MonthlySummaryRow): number => Object.values(r.physical_loss).reduce((n, v) => n + v, 0);

export function VaccinationSummary({ today }: { today?: string } = {}) {
  return (
    <VaccinationGate title="Resumo mensal" sub="movimentação do mês para lançar no SIES/SIPNI" allow={(r) => r.professional || r.keeper}>
      {() => (
        <VaccineLocationPick allow={(a) => a.vaccinate || a.keeper}>
          {(loc) => <SummaryBody location={loc} today={today} />}
        </VaccineLocationPick>
      )}
    </VaccinationGate>
  );
}

function SummaryBody({ location, today }: { location: VaccineLocation; today?: string }) {
  const uid = useId();
  const day = today ?? todayInCity();
  const central = location.kind === "cold_chain_central";
  const [ month, setMonth ] = useState(() => currentMonth(day));
  const [ requested, setRequested ] = useState<string | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const catalog = useQuery({ queryKey: [ VAC_CATALOG_KEY ], queryFn: getVaccinationCatalog, ...STATIC_QUERY });
  const summary = useQuery({
    queryKey: [ VAC_SUMMARY_KEY, location.id, requested ],
    queryFn: () => getMonthlySummary(central ? { central: true } : { roomId: location.room_id as string }, requested as string),
    enabled: requested !== null, ...STATIC_QUERY
  });

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const found = monthProblem(month, today ?? todayInCity());
    setProblem(found);
    if (found) { field.current?.focus(); return; }
    if (requested === month) void summary.refetch();
    else setRequested(month);
  }

  const lossLabel = (code: string) => catalog.data?.physical_loss_reasons.find((r) => r.code === code)?.name ?? code;
  const rows = summary.data?.rows ?? [];
  const lines: Line[] = [ ...rows.map((r): Line => ({ kind: "row", row: r })), ...(rows.length > 0 ? [ { kind: "total" } as Line ] : []) ];
  const num = (n: number) => <span className="mono">{fmtNumber(n)}</span>;
  const cell = (pick: (r: MonthlySummaryRow) => number) => (l: Line) => num(l.kind === "row" ? pick(l.row) : sum(rows, pick));

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      <form aria-label="Escolher o mês" style={row} onSubmit={submit} noValidate>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-month`}>Mês</label>
          <input ref={field} id={`${uid}-month`} type="month" style={inputStyle} value={month}
            {...(problem ? { "aria-invalid": true, "aria-describedby": `${uid}-err` } : {})}
            onChange={(e) => { setMonth(e.target.value); setProblem(null); }} />
        </div>
        <button type="submit" style={buttonStyle}>Ver resumo</button>
      </form>
      {problem && <p id={`${uid}-err`} role="alert" style={alert}>{problem}</p>}
      {requested !== null && summary.isFetching && !summary.data && <p className="mono" style={muted}>carregando…</p>}
      {summary.isError && !summary.data && <p role="alert" style={alert}>{vaccinationError(summary.error)}</p>}
      {summary.data && (
        <section aria-label="Movimentação do mês" style={stack}>
          <p className="mono" style={muted}>{`Mês: ${summary.data.month} · ${summary.data.location.name}`}</p>
          <DataTable<Line>
            cols={[
              { label: "Vacina", w: "1.3fr", card: "title", render: (l) => l.kind === "total" ? <strong>Total</strong> : l.row.immunobiological.name ?? l.row.immunobiological.code },
              { label: "Lote", w: "1fr", render: (l) => l.kind === "row" ? <span className="mono">{l.row.lot.number}</span> : "" },
              { label: "Saldo inicial", w: "0.8fr", align: "right", render: cell((r) => r.opening_balance) },
              { label: "Entradas", w: "0.8fr", align: "right", render: cell((r) => r.received) },
              { label: "Transferências recebidas", w: "0.9fr", align: "right", render: cell((r) => r.transferred_in) },
              { label: "Transferências enviadas", w: "0.9fr", align: "right", render: cell((r) => r.transferred_out) },
              { label: "Frascos abertos", w: "0.8fr", align: "right", render: cell((r) => r.vials_opened) },
              { label: "Doses de frascos abertos", w: "0.9fr", align: "right", render: cell((r) => r.vial_doses) },
              { label: "Doses unidose aplicadas", w: "0.9fr", align: "right", render: cell((r) => r.unit_doses) },
              { label: "Doses aplicadas", w: "0.8fr", align: "right", render: cell((r) => r.doses_applied) },
              { label: "Perda técnica", w: "0.8fr", align: "right", render: cell((r) => r.technical_loss) },
              { label: "Ajuste de inventário", w: "0.8fr", align: "right", render: (l) => (
                <span className="mono">{signed(l.kind === "row" ? l.row.adjustment : sum(rows, (r) => r.adjustment))}</span>
              ) },
              { label: "Perda física", w: "1.3fr", align: "right", render: (l) => {
                if (l.kind === "total") return num(sum(rows, physical));
                const detail = Object.entries(l.row.physical_loss).filter(([ , n ]) => n !== 0).map(([ code, n ]) => `${lossLabel(code)}: ${fmtNumber(n)}`);
                return (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    {num(physical(l.row))}
                    {detail.map((t) => <span key={t} style={muted}>{t}</span>)}
                  </span>
                );
              } },
              { label: "Saldo final", w: "0.8fr", align: "right", render: cell((r) => r.closing_balance) }
            ]}
            rows={lines} rowKey={(l, i) => l.kind === "total" ? "total" : `${l.row.lot.id}-${i}`} empty="nenhuma movimentação neste mês"
          />
          <p style={muted}>Saldo final = saldo inicial + entradas + transferências recebidas − enviadas − doses de frascos abertos − doses unidose + ajuste − perda física.</p>
        </section>
      )}
    </div>
  );
}
