// Tela "Relatório anual" (módulo 33; F-33.9): do ouvidor (`lead`). Ano (o anterior, que é o publicável, ou o corrente); os números
// do ano pelo `numbersRows` do painel (rascunho = painel vivo; publicado = o retrato da publicação; a supressão é do api); três
// textos públicos (até 8000, com PUBLIC_REPORT_NOTICE); "Salvar rascunho" manda os três; "Publicar" em dois passos, só para ano
// encerrado (Q27: o corrente fica desabilitado com o motivo) e só com o rascunho salvo; publicado, tudo só leitura e "Publicado em
// <data>" (não há `published_by`, Q35). 409 `report_published`/`already_published`: a frase e uma releitura, sem reenvio. A
// impressão leva só os números e os três textos gravados (POPUP_BLOCKED se o navegador bloquear). Nada em storage.
import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getAnnualReport, publishAnnualReport, updateAnnualReport, type OmbudsmanAnnualReport as Report } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDay } from "../lib/careLines";
import { cityIsoDate } from "../lib/format";
import {
  OMBUDSMAN_ERRORS, OMB_REPORT_KEY, PUBLIC_REPORT_NOTICE, STATIC_QUERY, ombudsmanError, ombudsmanRefusals, reportTextProblems
} from "../lib/ombudsman";
import { ActionButton } from "../components/ActionButton";
import { ConfirmButton } from "../components/ConfirmButton";
import { DataTable, type Column } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, form, muted, okText, row, stack } from "./exams/styles";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";
import { printSheet } from "./ombudsman/printSheet";
import { PANEL_SUPPRESSED_NOTE, numbersRows } from "./OmbudsmanPanel";
import { useFormProblems } from "./psychosocial/useFormProblems";

type Texts = { recurring_problems: string; actions_taken: string; notes: string };
const FIELDS: { key: keyof Texts; label: string }[] = [
  { key: "recurring_problems", label: "Problemas recorrentes" },
  { key: "actions_taken", label: "Providências adotadas" },
  { key: "notes", label: "Observações" }
];
const PUBLISH_QUESTION = "Publicar? Depois de publicado, o relatório não muda.";
const SAVE_FIRST = "salve o rascunho antes de publicar";
const SAVE_FIRST_PRINT = "salve o rascunho antes de imprimir";
const SAVE_FIRST_YEAR = "salve o rascunho antes de trocar de ano";
const DRAFT_SAVED = "Rascunho salvo.";
const STALE_CODES = [ "report_published", "already_published" ];
const isStale = (err: unknown) => STALE_CODES.includes(errorCode(err) ?? "");

// `null` do api = sem texto; a tela trabalha com "" (o api grava "" como nulo).
const textsOf = (r: Report): Texts => ({ recurring_problems: r.recurring_problems ?? "", actions_taken: r.actions_taken ?? "", notes: r.notes ?? "" });
const sheetTitle = (year: number) => `Relatório de gestão da Ouvidoria da Saúde — ${year}`;
const publishedText = (r: Report) => (r.published_at ? `Publicado em ${fmtDay(cityIsoDate(new Date(r.published_at)))}` : "Publicado");

const numberCols: Column<[ string, string ]>[] = [
  { label: "Número", w: "2fr", card: "title", render: (r) => r[0] },
  { label: "Valor", w: "1fr", align: "right", render: (r) => <span className="mono">{r[1]}</span> }
];

function ReportBody({ r, closed, onSaved, onStale, onDirty }: {
  r: Report; closed: boolean; onSaved(next: Report): void; onStale(text: string): void; onDirty(dirty: boolean): void;
}) {
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err).map((x) => ({ ...x, participantIndex: null })), isStale });
  const saved = textsOf(r);
  const [ draft, setDraft ] = useState<Texts>(saved);
  const [ done, setDone ] = useState(false);
  const [ publishError, setPublishError ] = useState<string | null>(null);
  const [ printError, setPrintError ] = useState<string | null>(null);
  const published = r.state === "published";
  const dirty = FIELDS.some(({ key }) => draft[key] !== saved[key]);
  const noticeId = f.fid("public-notice");
  const set = (key: keyof Texts, value: string) => { f.clear(key); setDone(false); setDraft((d) => ({ ...d, [key]: value })); };
  const own = (path: string) => FIELDS.some((x) => x.key === path);
  // O ano não troca com edição por salvar (ela se perderia sem aviso).
  useEffect(() => { onDirty(dirty); }, [ dirty, onDirty ]);
  useEffect(() => () => onDirty(false), [ onDirty ]);

  async function publish() {
    setPublishError(null);
    // Texto mudado depois de abrir a pergunta: o api publicaria o gravado e a edição sumiria.
    if (dirty || f.busy) { setPublishError(SAVE_FIRST); return; }
    try {
      onSaved(await publishAnnualReport(r.year));
    } catch (err) {
      if (isStale(err)) onStale(ombudsmanError(err));
      else setPublishError(ombudsmanError(err));
    }
  }
  function print() {
    const rows: [ string, string ][] = [ [ "Situação", published ? publishedText(r) : "rascunho" ], ...numbersRows(r.numbers) ];
    // A nota da supressão (Q61) vai logo depois dos números, como na tela.
    setPrintError(printSheet(sheetTitle(r.year), rows, [
      { title: "", text: PANEL_SUPPRESSED_NOTE }, ...FIELDS.map(({ key, label }) => ({ title: label, text: saved[key] || "—" }))
    ]));
  }

  return (
    <div style={stack}>
      <Panel title="Números do ano" sub={published ? "retrato do dia da publicação" : "painel do ano até agora; muda até a publicação"}>
        <div style={stack}>
          <DataTable label="Números do ano" cols={numberCols} rows={numbersRows(r.numbers)} rowKey={(x) => x[0]} />
          <p style={muted}>{PANEL_SUPPRESSED_NOTE}</p>
        </div>
      </Panel>
      <Panel title="Textos do relatório" sub={published ? "publicado — não muda" : "rascunho"}>
        <form ref={f.formRef} aria-label="Textos do relatório" style={form} noValidate onSubmit={(ev) => {
          setDone(false);
          void f.submit(ev, {
            check: () => reportTextProblems(draft),
            call: () => updateAnnualReport(r.year, draft),
            ok: (next) => { onSaved(next); setDraft(textsOf(next)); setDone(true); },
            stale: (text) => onStale(text)
          });
        }}>
          {published
            ? <p role="status" style={okText}>{publishedText(r)}</p>
            : <p id={noticeId} style={muted}>{PUBLIC_REPORT_NOTICE}</p>}
          {f.top(own)}
          {FIELDS.map(({ key, label }) => {
            const aria = f.aria(key);
            const describedBy = [ published ? null : noticeId, aria["aria-describedby"] ].filter(Boolean).join(" ");
            return (
              <div key={key} style={fieldLabel}>
                <label htmlFor={f.fid(key)}>{label}</label>
                <textarea id={f.fid(key)} rows={5} style={inputStyle} value={draft[key]} readOnly={published}
                  aria-invalid={aria["aria-invalid"]} aria-describedby={describedBy || undefined} onChange={(e) => set(key, e.target.value)} />
                {f.errNode(key)}
              </div>
            );
          })}
          {!published && (
            <div style={row}>
              <button type="submit" disabled={f.busy} style={f.busy ? disabledButtonStyle : buttonStyle}>Salvar rascunho</button>
            </div>
          )}
          {done && <p role="status" style={okText}>{DRAFT_SAVED}</p>}
        </form>
      </Panel>
      <div style={{ ...row, alignItems: "flex-start" }}>
        {!published && (
          <ConfirmButton label={`Publicar relatório de ${r.year}`} question={PUBLISH_QUESTION} variant="primary" onConfirm={publish}
            disabledReason={!closed ? OMBUDSMAN_ERRORS.year_not_closed : dirty || f.busy ? SAVE_FIRST : null} />
        )}
        <ActionButton variant="secondary" onClick={print} disabledReason={dirty ? SAVE_FIRST_PRINT : null}>Imprimir</ActionButton>
      </div>
      {publishError && <p role="alert" style={alert}>{publishError}</p>}
      {printError && <p role="alert" style={alert}>{printError}</p>}
    </div>
  );
}

function ReportScreen({ currentYear }: { currentYear: number }) {
  const queryClient = useQueryClient();
  // O anterior é o publicável (Q27); o corrente fica como rascunho.
  const [ year, setYear ] = useState(currentYear - 1);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ dirty, setDirty ] = useState(false);
  const yearReasonId = useId();
  const report = useQuery({ queryKey: [ OMB_REPORT_KEY, year ], queryFn: () => getAnnualReport(year), ...STATIC_QUERY });
  const r = report.data;
  return (
    <div style={stack}>
      <div style={row}>
        <label style={fieldLabel}>
          Ano
          <select value={year} style={inputStyle} disabled={dirty} aria-describedby={dirty ? yearReasonId : undefined}
            onChange={(e) => { if (dirty) return; setNotice(null); setYear(Number(e.target.value)); }}>
            {[ currentYear - 1, currentYear ].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        {dirty && <p id={yearReasonId} style={muted}>{SAVE_FIRST_YEAR}</p>}
      </div>
      {notice && <p role="alert" style={alert}>{notice}</p>}
      {report.isPending && <p className="mono" style={muted}>carregando…</p>}
      {report.isError && <p role="alert" style={alert}>{ombudsmanError(report.error)}</p>}
      {r && (
        // Mudou o estado (publicado) ou o ano: o formulário recomeça do que o api mandou.
        <ReportBody key={`${r.year}-${r.state}`} r={r} closed={r.year < currentYear}
          onSaved={(next) => { setNotice(null); queryClient.setQueryData([ OMB_REPORT_KEY, next.year ], next); }}
          onStale={(text) => { setNotice(text); void report.refetch(); }} onDirty={setDirty} />
      )}
    </div>
  );
}

export function OmbudsmanAnnualReport({ now }: { now?: Date } = {}) {
  return (
    <OmbudsmanGate title="Relatório anual" sub="relatório de gestão para publicar" allow={(r) => r.lead}>
      {() => <ReportScreen currentYear={Number(todayInCity(now ?? new Date()).slice(0, 4))} />}
    </OmbudsmanGate>
  );
}
