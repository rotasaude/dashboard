// src/modules/VectorLiraa.tsx
// "LIRAa" da coordenação de endemias (módulo 35a, F-35.6; contrato §7, §10, §12, §17; Q8, Q9, Q16, Q17, Q20, Q24, Q25, Q30). Papel:
// só a coordenação (LiraaSurveysController: coordinator!; a Q31 abre o index ao municipal_admin e ao vector_lab para o filtro dos
// relatórios, mas esta tela escreve). O ciclo do levantamento: rascunho → sorteado → fechado.
//   - Lista (GET /liraa_surveys, `{ items }` sem cursor, mais recente primeiro; sem pessoa: STATIC_QUERY, relida depois de cada
//     ação) e "Novo levantamento" (nome 1–80, início ≤ fim; SaveSurvey). Não há GET do levantamento: a releitura é a da lista.
//   - Rascunho: nome e período editáveis (Q37(1), o mesmo PATCH, as regras do SaveSurvey) e os estratos e o sorteio
//     (StrataEditor; parâmetros vigentes para a faixa de cada tipo). Todo PATCH leva `expected_version` = a version mostrada
//     (Q37(2)); 409 survey_changed → a frase, UMA releitura, e o digitado fica.
//   - Sorteado/fechado: por estrato N, n, intervalo e início; os imóveis sorteados (GET …/items, com cursor; grava a trilha
//     territory_registry → NOMINAL_QUERY, nunca relida sozinha; só quarteirão, endereço curto, posição e status, nunca morador);
//     o índice (GET /reports/liraa?survey_id=, só contagens: STATIC_QUERY; "provisório" enquanto há amostra sem resultado, Q24;
//     o do fechado é o retrato em closed_at, Q30); CSV e PDF pelo saveFile (nome do api ou "liraa-<id>.<formato>", sem pessoa);
//     "Fechar levantamento" (só sorteado; step-up; 409 invalid_transition → a frase e UMA releitura).
// Nada em URL ou storage; nenhum polling.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  closeLiraaSurvey, createLiraaSurvey, fetchVectorReportFile, getVectorParameters, getVectorReport, listLiraaItems, listLiraaSurveys, updateLiraaSurvey, type LiraaItem,
  type LiraaSurvey, type VectorReport
} from "../lib/api";
import { cityIsoDate, fmtDateTime, fmtNumber } from "../lib/format";
import { useActionMessage } from "../lib/useActionMessage";
import {
  STATIC_QUERY, VC_ITEMS_KEY, VC_PARAMS_KEY, VC_REPORT_KEY, VC_SURVEYS_KEY, isVectorStale, itemStatusLabel, surveyStatusLabel, vectorError,
  vectorRefusals
} from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
// A mesma célula dos relatórios (revisão final M2): o índice só tira a coluna `provisional`, que vira a frase acima da tabela.
import { reportCell } from "./vectorControl/ReportTable";
import { VectorListBody } from "./vectorControl/VectorListBody";
import { StrataEditor } from "./vectorControl/StrataEditor";
import { usePaged } from "./homeVisits/usePaged";
import { saveFile } from "./lab/saveFile";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { ActionButton } from "../components/ActionButton";
import { ActionMessage } from "../components/ActionMessage";
import { SensitiveAction } from "../components/SensitiveAction";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

export { DRAWN, DRAW_DESCRIPTION, FIX_TO_DRAW, INACTIVE_CHOSEN, N_ON_SAVE, SAVE_FIRST, STRATA_SAVED } from "./vectorControl/StrataEditor";
export const PROVISIONAL = "provisório: há amostra sem resultado";
export const CLOSED = "levantamento fechado — o índice fica como estava no fechamento";
export const CLOSE_DESCRIPTION = "Fecha o levantamento: o índice passa a ser o retrato deste momento e os imóveis sorteados não mudam mais.";
export const SURVEY_CREATED = (name: string) => `levantamento ${name} criado`;
export const NAME_PROBLEM = "o nome do levantamento tem de 1 a 80 caracteres";
export const END_BEFORE_START = "o fim vem no dia do início ou depois";
export const DETAILS_SAVED = "nome e período salvos";
export const NOTHING_CHANGED = "nada mudou";
// O 422 invalid_request do api no campo, com a frase da regra (o "pedido inválido — recarregue" não ajuda aqui).
const fieldText = (key: string, code: string, text: string) => (code !== "invalid_request" ? text
  : key === "name" ? NAME_PROBLEM : key === "ends_on" ? END_BEFORE_START : "informe uma data que exista");

const dayText = (iso: string) => iso.split("-").reverse().join("/");
const period = (s: Pick<LiraaSurvey, "starts_on" | "ends_on">) => `${dayText(s.starts_on)} a ${dayText(s.ends_on)}`;
const STATUS_TONE: Record<string, string> = { draft: "neutral", drawn: "info", closed: "ok" };
const ITEM_TONE: Record<string, string> = { pending: "neutral", inspected: "ok", substituted: "warn" };
const MODE_SHORT: Record<string, string> = { standard: "Padrão", half: "Reduzido", census: "Censitário" };
const modeShort = (m: string) => MODE_SHORT[m] ?? m;
const reportKey = (id: string) => [ VC_REPORT_KEY, "liraa", id ];

export function VectorLiraa({ today, onGoToSecurity }: { today?: string; onGoToSecurity?: () => void } = {}) {
  return (
    <VectorGate title="LIRAa" sub="endemias · levantamento rápido de índices" allow={(r) => r.coordinator}>
      {() => <LiraaScreen today={today ?? cityIsoDate()} onGoToSecurity={onGoToSecurity} />}
    </VectorGate>
  );
}

function LiraaScreen({ today, onGoToSecurity }: { today: string; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const surveys = useQuery({ queryKey: [ VC_SURVEYS_KEY ], queryFn: listLiraaSurveys, ...STATIC_QUERY });
  const [ selectedId, setSelectedId ] = useState<string | null>(null);
  const [ creating, setCreating ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);

  // A resposta da escrita fica na tela já; depois, UMA releitura da lista (não há GET do levantamento).
  const put = (s: LiraaSurvey) => queryClient.setQueryData<LiraaSurvey[]>([ VC_SURVEYS_KEY ], (list) =>
    (list?.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [ s, ...(list ?? []) ]));
  const reread = () => queryClient.invalidateQueries({ queryKey: [ VC_SURVEYS_KEY ] });
  const changed = async (s: LiraaSurvey) => { put(s); await reread(); };

  async function created(s: LiraaSurvey) {
    setCreating(false);
    setSelectedId(s.id);
    setNotice(SURVEY_CREATED(s.name));
    await changed(s);
  }

  const selected = surveys.data?.find((s) => s.id === selectedId) ?? null;
  return (
    <div style={stack}>
      <Panel title="Levantamentos" sub="rascunho, sorteado e fechado">
        <div style={stack}>
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} onClick={() => { setCreating(true); setNotice(null); }}>Novo levantamento</button>
          </div>
          {notice && <p role="status" style={okText}>{notice}</p>}
          {surveys.isError ? (
            <div style={row}>
              <p role="alert" style={alert}>{vectorError(surveys.error)}</p>
              <button type="button" style={secondaryButtonStyle} disabled={surveys.isFetching} onClick={() => void surveys.refetch()}>Tentar de novo</button>
            </div>
          ) : !surveys.data ? <p role="status" style={muted}>Carregando…</p>
            : surveys.data.length === 0 ? <EmptyState title="nenhum levantamento" />
            : (
              <DataTable label="Levantamentos" rows={surveys.data} rowKey={(s) => s.id} cols={[
                { label: "Nome", w: "2fr", card: "title", render: (s) => <strong>{s.name}</strong> },
                { label: "Período", w: "2fr", render: (s) => period(s) },
                { label: "Status", render: (s) => <Tag tone={STATUS_TONE[s.status] ?? "neutral"}>{surveyStatusLabel(s.status)}</Tag> },
                { label: "Ações", card: "actions", render: (s) => (
                  <button type="button" style={secondaryButtonStyle} aria-pressed={selectedId === s.id}
                    onClick={() => { setSelectedId(s.id); setNotice(null); }}>{`Abrir ${s.name}`}</button>
                ) }
              ]} />
            )}
        </div>
      </Panel>
      {creating && <NewSurveyForm today={today} onCreated={created} onCancel={() => setCreating(false)} />}
      {selected && <SurveyDetail key={selected.id} survey={selected} onChanged={changed} onStale={reread} onGoToSecurity={onGoToSecurity} />}
    </div>
  );
}

type SurveyField = "name" | "starts_on" | "ends_on";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
type SurveyDraft = Record<SurveyField, string>;
// As regras do SaveSurvey (nome 1–80 depois do strip; datas AAAA-MM-DD que existem; fim no dia do início ou depois), nunca mais.
function surveyProblems(d: SurveyDraft): Partial<Record<SurveyField, string>> {
  const out: Partial<Record<SurveyField, string>> = {};
  const n = [ ...d.name.trim() ].length;
  if (n < 1 || n > 80) out.name = NAME_PROBLEM;
  if (!realDate(d.starts_on)) out.starts_on = "informe a data de início";
  if (!realDate(d.ends_on)) out.ends_on = "informe a data de fim";
  else if (!out.starts_on && d.ends_on < d.starts_on) out.ends_on = END_BEFORE_START;
  return out;
}
const fieldOf = (path: string) => ([ "name", "starts_on", "ends_on" ] as SurveyField[]).find((k) => k === path);

function NewSurveyForm({ today, onCreated, onCancel }: { today: string; onCreated(s: LiraaSurvey): Promise<void>; onCancel(): void }) {
  const [ draft, setDraft ] = useState<Record<SurveyField, string>>({ name: "", starts_on: today, ends_on: "" });
  const [ problems, setProblems ] = useState<Partial<Record<SurveyField, string>>>({});
  const msg = useActionMessage();
  const set = (k: SurveyField, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setProblems((p) => { const { [k]: _, ...rest } = p; return rest; });
    msg.start();
  };

  async function create() {
    msg.start();
    const found = surveyProblems(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    try {
      await onCreated(await createLiraaSurvey({ name: draft.name.trim(), starts_on: draft.starts_on, ends_on: draft.ends_on }));
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      const key = fieldOf(refusal.path);
      if (key) setProblems({ [key]: fieldText(key, refusal.code, refusal.text) });
      else msg.fail(refusal.text);
    }
  }

  const input = (key: SurveyField, label: string, type: "text" | "date") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ ...fieldLabel, minWidth: type === "text" ? 260 : 160 }}>
        {label}
        <input type={type} value={draft[key]} style={inputStyle} aria-invalid={problems[key] ? true : undefined}
          aria-describedby={problems[key] ? `lr-new-${key}` : undefined} onChange={(e) => set(key, e.target.value)} />
      </label>
      {problems[key] && <span id={`lr-new-${key}`} style={alert}>{problems[key]}</span>}
    </div>
  );

  return (
    <Panel title="Novo levantamento" sub="os estratos vêm depois, no rascunho">
      <div style={stack}>
        <div style={row}>
          {input("name", "Nome", "text")}
          {input("starts_on", "Início", "date")}
          {input("ends_on", "Fim", "date")}
        </div>
        <div style={row}>
          <ActionButton onClick={create}>Criar levantamento</ActionButton>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
        <ActionMessage message={msg.message} />
      </div>
    </Panel>
  );
}

function SurveyDetail({ survey, onChanged, onStale, onGoToSecurity }: {
  survey: LiraaSurvey; onChanged(s: LiraaSurvey): Promise<void>; onStale(): Promise<void>; onGoToSecurity?: () => void;
}) {
  // A mensagem mora aqui: sobrevive à troca de rascunho para sorteado (e à remontagem do editor ao salvar).
  const msg = useActionMessage();
  return (
    <Panel title={survey.name} sub={period(survey)} right={<Tag tone={STATUS_TONE[survey.status] ?? "neutral"}>{surveyStatusLabel(survey.status)}</Tag>}>
      <div style={stack}>
        <ActionMessage message={msg.message} />
        {survey.status === "draft"
          ? <DraftBody survey={survey} msg={msg} onChanged={onChanged} onStale={onStale} onGoToSecurity={onGoToSecurity} />
          : <DrawnBody survey={survey} msg={msg} onChanged={onChanged} onStale={onStale} onGoToSecurity={onGoToSecurity} />}
      </div>
    </Panel>
  );
}

type Msg = ReturnType<typeof useActionMessage>;
type BodyProps = { survey: LiraaSurvey; msg: Msg; onChanged(s: LiraaSurvey): Promise<void>; onStale(): Promise<void>; onGoToSecurity?: () => void };

function DraftBody({ survey, msg, onChanged, onStale, onGoToSecurity }: BodyProps) {
  const params = useQuery({ queryKey: [ VC_PARAMS_KEY ], queryFn: getVectorParameters, ...STATIC_QUERY });
  if (params.isError) {
    return (
      <div style={row}>
        <p role="alert" style={alert}>{vectorError(params.error)}</p>
        <button type="button" style={secondaryButtonStyle} disabled={params.isFetching} onClick={() => void params.refetch()}>Tentar de novo</button>
      </div>
    );
  }
  if (!params.data) return <p role="status" style={muted}>Carregando…</p>;
  return (
    <div style={stack}>
      <DraftDetails survey={survey} msg={msg} onChanged={onChanged} onStale={onStale} />
      {/* Sem key pela releitura: o digitado sobrevive ao 409 survey_changed (Q37(2)); o editor adota o gravado ao salvar. */}
      <StrataEditor survey={survey} params={params.data.values} msg={msg} onStale={onStale} onGoToSecurity={onGoToSecurity}
        onSaved={onChanged} onDrawn={onChanged} />
    </div>
  );
}

// Q37(1): nome e período do rascunho pelo PATCH, só o que mudou, com a version mostrada. 409 survey_changed (ou survey_not_draft):
// a frase, UMA releitura, e o digitado fica (o próximo envio compara com o relido e leva a version nova).
function DraftDetails({ survey, msg, onChanged, onStale }: Pick<BodyProps, "survey" | "msg" | "onChanged" | "onStale">) {
  const [ draft, setDraft ] = useState<SurveyDraft>({ name: survey.name, starts_on: survey.starts_on, ends_on: survey.ends_on });
  const [ problems, setProblems ] = useState<Partial<Record<SurveyField, string>>>({});
  const set = (k: SurveyField, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setProblems((p) => { const { [k]: _, ...rest } = p; return rest; });
    msg.start();
  };

  async function save() {
    msg.start();
    const found = surveyProblems(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const patch: Partial<Record<SurveyField, string>> = {};
    if (draft.name.trim() !== survey.name) patch.name = draft.name.trim();
    if (draft.starts_on !== survey.starts_on) patch.starts_on = draft.starts_on;
    if (draft.ends_on !== survey.ends_on) patch.ends_on = draft.ends_on;
    // O api recusa a edição sem chave (invalid_request): nada a mandar.
    if (Object.keys(patch).length === 0) { msg.fail(NOTHING_CHANGED); return; }
    try {
      const result = await updateLiraaSurvey(survey.id, { ...patch, expected_version: survey.version });
      setDraft({ name: result.name, starts_on: result.starts_on, ends_on: result.ends_on });
      msg.ok(DETAILS_SAVED);
      await onChanged(result);
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      if (isVectorStale(err)) { msg.fail(refusal.text); await onStale(); return; }
      const key = fieldOf(refusal.path);
      if (key) setProblems({ [key]: fieldText(key, refusal.code, refusal.text) });
      else msg.fail(refusal.text);
    }
  }

  const input = (key: SurveyField, label: string, type: "text" | "date") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ ...fieldLabel, minWidth: type === "text" ? 260 : 160 }}>
        {label}
        <input type={type} value={draft[key]} style={inputStyle} aria-invalid={problems[key] ? true : undefined}
          aria-describedby={problems[key] ? `lr-edit-${survey.id}-${key}` : undefined} onChange={(e) => set(key, e.target.value)} />
      </label>
      {problems[key] && <span id={`lr-edit-${survey.id}-${key}`} style={alert}>{problems[key]}</span>}
    </div>
  );
  return (
    <div style={{ ...row, alignItems: "flex-end" }}>
      {input("name", "Nome do levantamento", "text")}
      {input("starts_on", "Início do período", "date")}
      {input("ends_on", "Fim do período", "date")}
      <ActionButton variant="secondary" onClick={save}>Salvar nome e período</ActionButton>
    </div>
  );
}

function DrawnBody({ survey, msg, onChanged, onStale, onGoToSecurity }: BodyProps) {
  const queryClient = useQueryClient();
  const [ confirming, setConfirming ] = useState(false);
  const closed = useRef<LiraaSurvey | null>(null);
  // Itens e índice relidos só por ação: "Atualizar" e o fechamento. Itens por reset (só a primeira página: uma trilha por clique,
  // não uma por página carregada, como faria o refetch do infinite query); índice por invalidate.
  const refresh = () => Promise.all([
    queryClient.resetQueries({ queryKey: [ VC_ITEMS_KEY, survey.id ] }), queryClient.invalidateQueries({ queryKey: reportKey(survey.id) })
  ]);

  async function done() {
    setConfirming(false);
    msg.ok(CLOSED);
    if (!closed.current) return;
    await Promise.all([ onChanged(closed.current), refresh() ]);
  }

  return (
    <div style={stack}>
      <p style={muted}>
        {[ survey.drawn_at && `sorteado em ${fmtDateTime(survey.drawn_at)}`, survey.closed_at && `fechado em ${fmtDateTime(survey.closed_at)}`,
          survey.parameters_version !== null && `parâmetros da versão ${survey.parameters_version}` ].filter(Boolean).join(" · ")}
      </p>
      <DataTable label="Estratos sorteados" rows={survey.strata} rowKey={(s) => s.id} cols={[
        { label: "Estrato", w: "2fr", card: "title", render: (s) => <strong>{s.name}</strong> },
        { label: "Tipo", render: (s) => modeShort(s.mode) },
        { label: "N (imóveis)", align: "right", render: (s) => fmtNumber(s.households_count) },
        { label: "n (amostra)", align: "right", render: (s) => fmtNumber(s.sample_target) },
        { label: "Intervalo", align: "right", render: (s) => fmtNumber(s.block_interval) },
        { label: "Início", align: "right", render: (s) => fmtNumber(s.random_start) }
      ]} />
      <div style={row}>
        <ActionButton variant="secondary" onClick={async () => { msg.start(); await refresh(); }}>Atualizar</ActionButton>
        <span style={muted}>relê os imóveis sorteados e o índice</span>
        {survey.status === "drawn" && !confirming && (
          <ActionButton variant="secondary" onClick={() => { msg.start(); setConfirming(true); }}>Fechar levantamento</ActionButton>
        )}
      </div>
      {survey.status === "drawn" && confirming && (
        <SensitiveAction
          title="Fechar o levantamento"
          description={CLOSE_DESCRIPTION}
          requiresStepUp
          run={async () => { closed.current = await closeLiraaSurvey(survey.id); }}
          onDone={() => void done()}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => {
            setConfirming(false);
            msg.fail(vectorError(e));
            if (isVectorStale(e)) void onStale();
            return vectorError(e);
          }}
        />
      )}
      <IndexPanel surveyId={survey.id} />
      <ItemsPanel survey={survey} />
    </div>
  );
}

function IndexPanel({ surveyId }: { surveyId: string }) {
  const report = useQuery({ queryKey: reportKey(surveyId), queryFn: () => getVectorReport("liraa", { survey_id: surveyId }), ...STATIC_QUERY });
  const cols = (report.data?.columns ?? []).filter((c) => c.key !== "provisional");
  return (
    <div style={stack}>
      <strong>Índices (IIP e IB por estrato e do município)</strong>
      {report.isError ? (
        <div style={row}>
          <p role="alert" style={alert}>{vectorError(report.error)}</p>
          <button type="button" style={secondaryButtonStyle} disabled={report.isFetching} onClick={() => void report.refetch()}>Tentar de novo</button>
        </div>
      ) : !report.data ? <p role="status" style={muted}>Carregando…</p>
        : (
          <>
            {report.data.provisional && <p role="status" style={{ ...muted, color: "var(--warn)" }}>{PROVISIONAL}</p>}
            <DataTable label="Índices do LIRAa" rows={report.data.rows} rowKey={(_, i) => String(i)} cols={cols.map((c, i) => ({
              label: c.label, align: c.kind === "text" ? "left" as const : "right" as const, card: i === 0 ? "title" as const : undefined,
              render: (r: VectorReport["rows"][number]) => reportCell(r[c.key], c.kind)
            }))} />
            {/* O aviso de provisório já está no topo (a nota do api diz o mesmo). */}
            {(report.data.notes ?? []).filter((n) => !(report.data.provisional && /^provisório/i.test(n))).map((n) => <p key={n} style={muted}>{n}</p>)}
          </>
        )}
      <Downloads surveyId={surveyId} />
    </div>
  );
}

function Downloads({ surveyId }: { surveyId: string }) {
  const running = useRef(false);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  async function get(format: "csv" | "pdf") {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const file = await fetchVectorReportFile("liraa", { survey_id: surveyId }, format);
      saveFile(file, file.filename ?? `liraa-${surveyId}.${format}`);
    } catch (err) {
      setError(vectorError(err));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <div style={stack}>
      <div style={row}>
        <span style={muted}>Baixar o índice:</span>
        <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void get("csv")}>CSV</button>
        <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void get("pdf")}>PDF</button>
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}

function ItemsPanel({ survey }: { survey: LiraaSurvey }) {
  // Grava a trilha territory_registry: NOMINAL (nunca relida sozinha; o fechamento não muda os itens).
  const items = usePaged<LiraaItem>([ VC_ITEMS_KEY, survey.id ], (before) => listLiraaItems(survey.id, before), true, true, vectorError);
  const strata = new Map(survey.strata.map((s) => [ s.id, s.name ]));
  return (
    <div style={stack}>
      <strong>Imóveis sorteados</strong>
      <p style={muted}>na ordem do sorteio; os substitutos vêm no fim</p>
      <VectorListBody list={items}>
        {(list) => {
          const byId = new Map(list.map((i) => [ i.id, i ]));
          const substituteOf = (i: LiraaItem) => {
            if (!i.substitute_of_id) return "—";
            const o = byId.get(i.substitute_of_id);
            return o ? `substituto de ${o.household.address_short}` : "substituto de outro imóvel sorteado";
          };
          return list.length === 0 ? <EmptyState title="nenhum imóvel sorteado" /> : (
            <DataTable label="Imóveis sorteados" rows={list} rowKey={(i) => i.id} cols={[
              { label: "Endereço", w: "2fr", card: "title", render: (i) => <strong>{i.household.address_short}</strong> },
              { label: "Estrato", render: (i) => strata.get(i.stratum_id) ?? "—" },
              { label: "Quarteirão", render: (i) => i.city_block.number },
              { label: "Posição", align: "right", render: (i) => fmtNumber(i.position) },
              { label: "Status", render: (i) => <Tag tone={ITEM_TONE[i.status] ?? "neutral"}>{itemStatusLabel(i.status)}</Tag> },
              { label: "Substituição", w: "2fr", render: substituteOf }
            ]} />
          );
        }}
      </VectorListBody>
    </div>
  );
}
