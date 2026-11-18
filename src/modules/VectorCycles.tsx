// src/modules/VectorCycles.tsx
// "Ciclos e cadência" da coordenação de endemias (módulo 35a, F-35.4; contrato §5, §12; Q8, Q22, D-1, D-6). Papel: só a
// coordenação (CyclesController e CadencesController: coordinator!; a Q31 abre o GET /cycles ao municipal_admin para o filtro
// dos relatórios, mas esta tela escreve). Ciclos do ano (GET /cycles?year=), novo e editar (VectorControl::SaveCycle: ano civil
// ou epidemiológico do início, fim depois do início, número 1–12 opcional na criação; 422 cycle_overlap/cycle_invalid no campo);
// o ciclo escolhido mostra o resumo por bairro (GET /cycles/:id, só contagens, sem trilha; STATIC_QUERY, lido só depois da
// escolha). Embaixo, a cadência de visita (CadencesPanel). Sem dado de pessoa, sem storage, sem polling.
import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createCycle, getCycleSummary, listCycles, updateCycle, type CycleSummary, type VectorCycle } from "../lib/api";
import { cityIsoDate, fmtNumber, fmtPercent } from "../lib/format";
import { STATIC_QUERY, VC_CYCLES_KEY, VC_CYCLE_KEY, cycleProblems, isVectorStale, vectorError, vectorRefusals } from "../lib/vectorControl";
import { useActionMessage } from "../lib/useActionMessage";
import { VectorGate } from "./vectorControl/VectorGate";
import { CadencesPanel } from "./vectorControl/CadencesPanel";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { StatTile } from "../components/StatTile";
import { ActionButton } from "../components/ActionButton";
import { ActionMessage } from "../components/ActionMessage";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

export const SUMMARY_NOTICE = "os números contam só os imóveis do cadastro territorial";
// O número que o api recusa com invalid_request path number: (ano, número) de outro ciclo, ou o próximo do ano passaria do 12.
export const CYCLE_NUMBER_REFUSED = "este número já é de outro ciclo do ano, ou o ano já tem os 12 ciclos";
export const CYCLE_SAVED = (c: VectorCycle) => `ciclo ${c.number}/${c.year} salvo`;
export const NOTHING_CHANGED = "nada mudou";

const YEAR = /^\d{4}$/;
const dayText = (iso: string) => iso.split("-").reverse().join("/");
export const cyclePeriod = (c: Pick<VectorCycle, "starts_on" | "ends_on">) => `${dayText(c.starts_on)} a ${dayText(c.ends_on)}`;

export function VectorCycles({ today, onGoToSecurity }: { today?: string; onGoToSecurity?: () => void } = {}) {
  return (
    <VectorGate title="Ciclos e cadência" sub="endemias · ciclos de trabalho e cadência" allow={(r) => r.coordinator}>
      {() => (
        <div style={stack}>
          <CyclesPanel today={today ?? cityIsoDate()} />
          <CadencesPanel onGoToSecurity={onGoToSecurity} />
        </div>
      )}
    </VectorGate>
  );
}

type Editing = { mode: "new" } | { mode: "edit"; cycle: VectorCycle } | null;

function CyclesPanel({ today }: { today: string }) {
  const queryClient = useQueryClient();
  const [ yearText, setYearText ] = useState(today.slice(0, 4));
  const [ year, setYear ] = useState(Number(today.slice(0, 4)));
  const [ editing, setEditing ] = useState<Editing>(null);
  const [ selectedId, setSelectedId ] = useState<string | null>(null);
  // O aviso de gravado mora aqui: gravar fecha o formulário.
  const [ notice, setNotice ] = useState<string | null>(null);
  const cycles = useQuery({ queryKey: [ VC_CYCLES_KEY, year ], queryFn: () => listCycles(year), ...STATIC_QUERY });

  function pickYear(text: string) {
    setYearText(text);
    if (!YEAR.test(text)) return;
    setYear(Number(text));
    setSelectedId(null);
    setEditing(null);
    setNotice(null);
  }
  const edit = (e: Editing) => { setEditing(e); setNotice(null); };

  async function saved(c: VectorCycle) {
    setEditing(null);
    setNotice(CYCLE_SAVED(c));
    if (c.year !== year) { setYearText(String(c.year)); setYear(c.year); setSelectedId(null); }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [ VC_CYCLES_KEY ] }),
      queryClient.invalidateQueries({ queryKey: [ VC_CYCLE_KEY, c.id ] })
    ]);
  }

  const selected = cycles.data?.find((c) => c.id === selectedId) ?? null;
  return (
    <div style={stack}>
      <Panel title="Ciclos de trabalho" sub="o período de cada ciclo do ano">
        <div style={stack}>
          <div style={row}>
            <label style={{ ...fieldLabel, maxWidth: 160 }}>
              Ano dos ciclos
              <input value={yearText} inputMode="numeric" style={inputStyle} onChange={(e) => pickYear(e.target.value)} />
            </label>
            <button type="button" style={secondaryButtonStyle} onClick={() => edit({ mode: "new" })}>Novo ciclo</button>
          </div>
          {notice && <p role="status" style={okText}>{notice}</p>}
          {!YEAR.test(yearText) && <p style={muted}>informe o ano com 4 dígitos</p>}
          {cycles.isError ? (
            <div style={row}>
              <p role="alert" style={alert}>{vectorError(cycles.error)}</p>
              <button type="button" style={secondaryButtonStyle} disabled={cycles.isFetching} onClick={() => void cycles.refetch()}>Tentar de novo</button>
            </div>
          ) : !cycles.data ? <p role="status" style={muted}>Carregando…</p>
            : cycles.data.length === 0 ? <EmptyState title={`nenhum ciclo em ${year}`} />
            : (
              <DataTable label="Ciclos do ano" rows={cycles.data} rowKey={(c) => c.id} cols={[
                { label: "Número", card: "title", render: (c) => <strong>{`ciclo ${c.number}`}</strong> },
                { label: "Período", w: "2fr", render: (c) => cyclePeriod(c) },
                { label: "Ações", w: "2fr", card: "actions", render: (c) => (
                  <div style={row}>
                    <button type="button" style={secondaryButtonStyle} aria-pressed={selectedId === c.id}
                      onClick={() => setSelectedId(c.id)}>{`Ver resumo do ciclo ${c.number}`}</button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => edit({ mode: "edit", cycle: c })}>{`Editar ciclo ${c.number}`}</button>
                  </div>
                ) }
              ]} />
            )}
        </div>
      </Panel>
      {editing && (
        <CycleForm key={editing.mode === "edit" ? editing.cycle.id : "new"} editing={editing.mode === "edit" ? editing.cycle : null} year={year}
          existing={cycles.data ?? null} onSaved={saved} onCancel={() => setEditing(null)}
          onStale={() => queryClient.invalidateQueries({ queryKey: [ VC_CYCLES_KEY ] })} />
      )}
      {selected && <SummaryPanel cycle={selected} />}
    </div>
  );
}

type CycleField = "year" | "number" | "starts_on" | "ends_on";
const FIELDS: CycleField[] = [ "year", "number", "starts_on", "ends_on" ];
type Draft = Record<CycleField, string>;
const toInt = (raw: string): number => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
// Textos do api no campo: o cycle_invalid com a regra que falhou; o invalid_request do número com a frase do número.
const API_FIELD_TEXT: Record<string, string> = {
  "cycle_invalid|year": "o ano do ciclo é o ano civil ou o epidemiológico da data de início",
  "cycle_invalid|ends_on": "o fim do ciclo vem depois do início",
  "invalid_request|number": CYCLE_NUMBER_REFUSED
};

function CycleForm({ editing, year, existing, onSaved, onCancel, onStale }: {
  editing: VectorCycle | null; year: number; existing: VectorCycle[] | null;
  onSaved(c: VectorCycle): Promise<void>; onCancel(): void; onStale(): Promise<void>;
}) {
  const [ draft, setDraft ] = useState<Draft>(() => editing
    ? { year: String(editing.year), number: String(editing.number), starts_on: editing.starts_on, ends_on: editing.ends_on }
    : { year: String(year), number: "", starts_on: "", ends_on: "" });
  const [ problems, setProblems ] = useState<Partial<Record<CycleField, string>>>({});
  const msg = useActionMessage();
  const baseId = useId();
  const [ focusTick, setFocusTick ] = useState(0);
  useEffect(() => {
    if (focusTick > 0) document.querySelector<HTMLElement>(`[data-cycle-form="${baseId}"] [aria-invalid='true']`)?.focus();
  }, [ focusTick, baseId ]);

  function set(key: CycleField, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
    setProblems((p) => { const { [key]: _, ...rest } = p; return rest; });
    msg.start();
  }

  function localProblems(): Partial<Record<CycleField, string>> {
    const y = toInt(draft.year);
    const n = draft.number.trim() === "" ? (editing ? NaN : undefined) : toInt(draft.number);
    const found: Partial<Record<CycleField, string>> = {};
    for (const p of cycleProblems({ year: y, number: n, starts_on: draft.starts_on, ends_on: draft.ends_on })) {
      const key = p.path as CycleField;
      if (!found[key]) found[key] = p.text;
    }
    // O número de outro ciclo do mesmo ano (a lista na tela é a do ano): o api recusaria com invalid_request path number.
    if (!found.number && existing && y === year) {
      const others = existing.filter((c) => c.id !== editing?.id);
      if (n !== undefined && others.some((c) => c.number === n)) found.number = CYCLE_NUMBER_REFUSED;
      if (n === undefined && others.length > 0 && Math.max(...others.map((c) => c.number)) >= 12) found.number = CYCLE_NUMBER_REFUSED;
    }
    return found;
  }

  async function save() {
    msg.start();
    const found = localProblems();
    setProblems(found);
    if (Object.keys(found).length > 0) { setFocusTick((t) => t + 1); return; }
    const values = { year: toInt(draft.year), number: draft.number.trim() === "" ? undefined : toInt(draft.number), starts_on: draft.starts_on, ends_on: draft.ends_on };
    try {
      let result: VectorCycle;
      if (editing) {
        const patch: Partial<Omit<VectorCycle, "id">> = {};
        if (values.year !== editing.year) patch.year = values.year;
        if (values.number !== editing.number) patch.number = values.number;
        if (values.starts_on !== editing.starts_on) patch.starts_on = values.starts_on;
        if (values.ends_on !== editing.ends_on) patch.ends_on = values.ends_on;
        if (Object.keys(patch).length === 0) { msg.fail(NOTHING_CHANGED); return; }
        result = await updateCycle(editing.id, patch);
      } else {
        const { number, ...rest } = values;
        result = await createCycle(number === undefined ? rest : { ...rest, number });
      }
      await onSaved(result);
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      if (isVectorStale(err)) {
        // O ciclo sumiu entre a leitura e o envio: a frase e UMA releitura da lista, sem reenviar.
        msg.fail(refusal.text);
        await onStale();
        return;
      }
      const key = FIELDS.find((f) => f === refusal.path);
      if (key) {
        setProblems({ [key]: API_FIELD_TEXT[`${refusal.code}|${key}`] ?? refusal.text });
        setFocusTick((t) => t + 1);
      } else msg.fail(refusal.text);
    }
  }

  const errId = (key: CycleField) => `${baseId}-${key}`;
  const input = (key: CycleField, label: string, type: "text" | "date") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ ...fieldLabel, maxWidth: 220 }}>
        {label}
        <input type={type} value={draft[key]} inputMode={type === "text" ? "numeric" : undefined} style={inputStyle}
          aria-invalid={problems[key] ? true : undefined} aria-describedby={problems[key] ? errId(key) : undefined}
          onChange={(e) => set(key, e.target.value)} />
      </label>
      {problems[key] && <span id={errId(key)} style={alert}>{problems[key]}</span>}
    </div>
  );

  return (
    <Panel title={editing ? `Editar ciclo ${editing.number}/${editing.year}` : "Novo ciclo"}
      sub="o ano é o civil ou o epidemiológico da data de início; o fim conta o último dia">
      <div style={stack} data-cycle-form={baseId}>
        <div style={row}>
          {input("year", "Ano", "text")}
          {input("number", editing ? "Número" : "Número (opcional)", "text")}
          {input("starts_on", "Início", "date")}
          {input("ends_on", "Fim", "date")}
        </div>
        {!editing && <p style={muted}>sem número, o ciclo recebe o próximo do ano</p>}
        <div style={row}>
          <ActionButton onClick={save}>Salvar ciclo</ActionButton>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
        <ActionMessage message={msg.message} />
      </div>
    </Panel>
  );
}

type SummaryRow = CycleSummary["neighborhoods"][number];

function SummaryPanel({ cycle }: { cycle: VectorCycle }) {
  const summary = useQuery({ queryKey: [ VC_CYCLE_KEY, cycle.id ], queryFn: () => getCycleSummary(cycle.id), ...STATIC_QUERY });
  const rows = summary.data?.neighborhoods ?? [];
  const sum = (pick: (r: SummaryRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  return (
    <Panel title={`Resumo do ciclo ${cycle.number}/${cycle.year}`} sub={cyclePeriod(cycle)}>
      <div style={stack}>
        <p style={muted}>{SUMMARY_NOTICE}</p>
        {summary.isError ? (
          <div style={row}>
            <p role="alert" style={alert}>{vectorError(summary.error)}</p>
            <button type="button" style={secondaryButtonStyle} disabled={summary.isFetching} onClick={() => void summary.refetch()}>Tentar de novo</button>
          </div>
        ) : !summary.data ? <p role="status" style={muted}>Carregando…</p>
          : rows.length === 0 ? <EmptyState title="nenhum bairro ativo" />
          : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <StatTile label="imóveis a visitar" value={sum((r) => r.to_visit)} />
                <StatTile label="imóveis visitados" value={sum((r) => r.visited)} />
                <StatTile label="imóveis no cadastro" value={sum((r) => r.registered_households)} />
              </div>
              <DataTable label="Resumo por bairro" rows={rows} rowKey={(r) => r.neighborhood.id} cols={[
                { label: "Bairro", w: "2fr", card: "title", render: (r) => <strong>{r.neighborhood.name}</strong> },
                { label: "A visitar", align: "right", render: (r) => fmtNumber(r.to_visit) },
                { label: "Visitados", align: "right", render: (r) => fmtNumber(r.visited) },
                { label: "Trabalhados", align: "right", render: (r) => fmtNumber(r.worked) },
                { label: "Fechados", align: "right", render: (r) => fmtNumber(r.closed) },
                { label: "Recusados", align: "right", render: (r) => fmtNumber(r.refused) },
                { label: "Desocupados", align: "right", render: (r) => fmtNumber(r.vacant) },
                { label: "Recuperados", align: "right", render: (r) => fmtNumber(r.recovered) },
                { label: "Pendência", align: "right", render: (r) => fmtPercent(r.pending_percent) },
                { label: "Imóveis cadastrados", align: "right", render: (r) => fmtNumber(r.registered_households) }
              ]} />
            </>
          )}
      </div>
    </Panel>
  );
}
