// Laudo de TFD (módulo 30, F-30.5; Portaria SAS/MS 55/1999): o médico (CBO 225) pede a partir da consulta finalizada ou edita o próprio
// pedido em rascunho/devolvido. Lê as opções (destinos com km, prestadores, distância mínima) e, a partir da consulta, o pré-preenchimento
// (CID e SIGTAP da consulta; `gcTime: 0`). "Salvar rascunho" aceita laudo incompleto (o api também); "Enviar à comissão" confere tudo antes
// (`reportProblems`), salva e envia. O PATCH substitui o processo inteiro: todos os campos vão de novo, inclusive o prestador.
// O laudo fica só na memória da tela e no corpo das chamadas — nada em URL, storage ou log.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createTfdCase, getTfdOptions, getTfdPrefill, searchSigtap, searchTerminology, submitTfdCase, updateTfdCase,
  type TfdCase, type TfdOptions
} from "../../lib/api";
import {
  TFD_OPTIONS_KEY, caseBody, draftProblems, reportDraftFrom, reportProblems, tfdError, tfdRefusals, transportModeLabel, type ReportDraft
} from "../../lib/tfd";
import { consultationError } from "../../lib/consultation";
import { STATIC_QUERY } from "../../lib/careLines";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CodeSearch } from "../consultation/CodeSearch";
import { CheckField, SelectField, TextField } from "../transport/fleetForm";
import { alert, box, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export const TFD_PREFILL_KEY = "tfdPrefill";
export const TFD_SENT = "Pedido de TFD enviado à comissão.";
export const TFD_DRAFT_SAVED = "Rascunho de TFD salvo.";
const DRAFT_KEPT = "O rascunho ficou salvo em Meus pedidos de TFD.";
const CHANGES_KEPT = "As mudanças ficaram salvas em Meus pedidos de TFD.";
const MODES = [ "fleet", "bus_ticket", "air", "river" ] as const;
const FIELDS = [ "report.sigtap_code", "report.cid10", "report.justification", "report.companion_reason", "report.transport_mode", "destination_id", "provider_id" ];

export type TfdRequestSource = { consultationId: string; patientId?: string } | { tfdCase: TfdCase };

export interface TfdRequestFormProps {
  source: TfdRequestSource;
  searchDelayMs?: number;
  onDone(c: TfdCase, text: string): void;
  onCancel(): void;
}

export function TfdRequestForm({ source, searchDelayMs, onDone, onCancel }: TfdRequestFormProps) {
  const consultationId = "consultationId" in source ? source.consultationId : null;
  const options = useQuery({ queryKey: [ TFD_OPTIONS_KEY ], queryFn: getTfdOptions, ...STATIC_QUERY });
  // O pré-preenchimento traz o CID da consulta: sai da memória quando a tela fecha.
  const prefill = useQuery({
    queryKey: [ TFD_PREFILL_KEY, consultationId ], queryFn: () => getTfdPrefill(consultationId as string), enabled: consultationId !== null,
    gcTime: 0, ...STATIC_QUERY
  });

  const failed = options.isError ? options.error : consultationId !== null && prefill.isError ? prefill.error : null;
  if (failed) {
    return (
      <div style={box}>
        <p role="alert" style={alert}>{tfdError(failed)}</p>
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Fechar</button></div>
      </div>
    );
  }
  if (!options.data || (consultationId !== null && !prefill.data)) return <p className="mono" style={muted}>carregando o laudo…</p>;

  if ("tfdCase" in source) {
    const c = source.tfdCase;
    return (
      <ReportForm options={options.data} initial={reportDraftFrom(null, c)} existing={c} searchDelayMs={searchDelayMs} onDone={onDone} onCancel={onCancel}
        ctx={{ patientId: c.patient.id, consultationId: c.consultation_id ?? undefined, regulationRequestId: c.regulation_request_id ?? undefined }} />
    );
  }
  const p = prefill.data as NonNullable<typeof prefill.data>;
  return (
    <ReportForm options={options.data} initial={reportDraftFrom(p)} searchDelayMs={searchDelayMs} onDone={onDone} onCancel={onCancel}
      ctx={{ patientId: p.patient_id, consultationId: source.consultationId }} />
  );
}

type Errors = Record<string, string[]>;

function group(list: { path: string; text: string }[]): { fields: Errors; general: string[] } {
  const fields: Errors = {};
  const general: string[] = [];
  for (const p of list) {
    if (FIELDS.includes(p.path)) {
      const at = fields[p.path] ?? (fields[p.path] = []);
      if (!at.includes(p.text)) at.push(p.text);
    } else if (!general.includes(p.text)) general.push(p.text);
  }
  return { fields, general };
}

function ReportForm({ options, initial, existing, ctx, searchDelayMs, onDone, onCancel }: {
  options: TfdOptions; initial: ReportDraft; existing?: TfdCase; ctx: { patientId: string; consultationId?: string; regulationRequestId?: string };
  searchDelayMs?: number; onDone(c: TfdCase, text: string): void; onCancel(): void;
}) {
  const [ d, setD ] = useState<ReportDraft>(initial);
  const [ sigtapName, setSigtapName ] = useState<string | null>(existing?.report.sigtap_name ?? null);
  const [ cidName, setCidName ] = useState<string | null>(null);
  const [ caseId, setCaseId ] = useState<string | null>(existing?.id ?? null);
  const [ errors, setErrors ] = useState<Errors>({});
  const [ general, setGeneral ] = useState<string[]>([]);
  const [ kept, setKept ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ focusTick, setFocusTick ] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const set = (patch: Partial<ReportDraft>) => setD((x) => ({ ...x, ...patch }));

  // Foco na primeira recusa (campo marcado ou, sem campo, o aviso geral).
  useEffect(() => {
    if (focusTick === 0) return;
    formRef.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-refusal]")?.focus();
  }, [ focusTick ]);

  function show(list: Problem[] | { path: string; text: string }[]) {
    const g = group(list);
    setErrors(g.fields); setGeneral(g.general); setFocusTick((n) => n + 1);
  }

  async function save(submit: boolean) {
    if (busy) return;
    const problems = submit ? reportProblems(d, options) : draftProblems(d);
    setKept(null);
    if (problems.length > 0) { show(problems); return; }
    setErrors({}); setGeneral([]); setBusy(true);
    try {
      let saved: TfdCase;
      try {
        const body = caseBody(d, ctx);
        saved = caseId ? await updateTfdCase(caseId, body) : await createTfdCase(body);
        setCaseId(saved.id);
      } catch (err) {
        show(tfdRefusals(err));
        return;
      }
      if (!submit) { onDone(saved, TFD_DRAFT_SAVED); return; }
      try {
        onDone(await submitTfdCase(saved.id), TFD_SENT);
      } catch (err) {
        show(tfdRefusals(err));
        setKept(existing ? CHANGES_KEPT : DRAFT_KEPT);
      }
    } finally { setBusy(false); }
  }

  const err = (path: string) => errors[path]?.join("; ");
  const destination = options.destinations.find((x) => x.id === d.destinationId);
  // O destino e o prestador já gravados continuam escolhíveis mesmo fora das opções de hoje.
  const destinations = existing && !options.destinations.some((x) => x.id === existing.destination.id) ? [ ...options.destinations, existing.destination ] : options.destinations;
  const providers = existing?.provider && !options.providers.some((p) => p.id === existing.provider?.id)
    ? [ ...options.providers, { id: existing.provider.id, name: existing.provider.name, ibge_code: null } ] : options.providers;
  const here = (p: { ibge_code: string | null }) => !!destination && p.ibge_code === destination.ibge_code;
  const sortedProviders = [ ...providers.filter(here), ...providers.filter((p) => !here(p)) ];
  const just = d.justification.trim().length;

  return (
    <form ref={formRef} aria-label="Laudo de TFD" noValidate style={box} onSubmit={(e: FormEvent) => { e.preventDefault(); void save(false); }}>
      <div style={form}>
        {existing && <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{existing.patient.display_name ?? "paciente"}</p>}

        <fieldset style={fieldset}>
          <legend style={legend}>Procedimento (SIGTAP)</legend>
          <p style={chosen}>{d.sigtapCode ? `${d.sigtapCode}${sigtapName ? ` — ${sigtapName}` : ""}` : "nenhum procedimento escolhido"}</p>
          <CodeSearch label="Buscar procedimento" placeholder="nome ou código do procedimento" queryKey="sigtapSearch" search={searchSigtap}
            errorText={consultationError} delayMs={searchDelayMs} onPick={(item) => { set({ sigtapCode: item.code }); setSigtapName(item.label); }} />
          <FieldErr id="tfd-sigtap-err" text={err("report.sigtap_code")} />
        </fieldset>

        <fieldset style={fieldset}>
          <legend style={legend}>CID-10</legend>
          <p style={chosen}>{d.cid10 ? `${d.cid10}${cidName ? ` — ${cidName}` : ""}` : "nenhum CID-10 escolhido"}</p>
          <CodeSearch label="Buscar CID-10" placeholder="nome ou código" queryKey="terminologySearch:cid10" search={(q) => searchTerminology(q, "cid10")}
            errorText={consultationError} delayMs={searchDelayMs} onPick={(item) => { set({ cid10: item.code }); setCidName(item.label); }} />
          <FieldErr id="tfd-cid-err" text={err("report.cid10")} />
        </fieldset>

        <div style={fieldLabel}>
          <label htmlFor="tfd-just">Justificativa</label>
          <textarea id="tfd-just" rows={4} value={d.justification} style={inputStyle} aria-invalid={err("report.justification") ? true : undefined}
            aria-describedby={[ "tfd-just-hint", err("report.justification") ? "tfd-just-err" : "" ].filter(Boolean).join(" ")}
            onChange={(e) => set({ justification: e.target.value })} />
          <p id="tfd-just-hint" style={muted}>{`Por que o tratamento não pode ser feito na cidade — 20 a 2000 caracteres (${just}/2000).`}</p>
          <FieldErr id="tfd-just-err" text={err("report.justification")} />
        </div>

        <CheckField id="tfd-companion" label="Indicação de acompanhante" checked={d.companionIndicated} onChange={(v) => set({ companionIndicated: v })} />
        {d.companionIndicated && (
          <TextField id="tfd-companion-reason" label="Motivo da indicação" value={d.companionReason} error={err("report.companion_reason")} autoComplete="off"
            hint="Portaria SAS/MS 55/1999, art. 7º. Opcional; quando houver, de 10 a 500 caracteres." onChange={(v) => set({ companionReason: v })} />
        )}

        <SelectField id="tfd-mode" label="Tipo de transporte" value={d.transportMode} error={err("report.transport_mode")}
          options={[ ...MODES.map((m): [ string, string ] => [ m, transportModeLabel(m) ]), ...(MODES.includes(d.transportMode as never) ? [] : [ [ d.transportMode, d.transportMode ] as [ string, string ] ]) ]}
          onChange={(v) => set({ transportMode: v })} />
        <SelectField id="tfd-dest" label="Cidade de destino" value={d.destinationId} error={err("destination_id")} blank="Escolha o destino"
          options={destinations.map((x): [ string, string ] => [ x.id, `${x.name} — ${x.distance_km} km` ])} onChange={(v) => set({ destinationId: v })} />
        <SelectField id="tfd-provider" label="Prestador" value={d.providerId} error={err("provider_id")} blank="Sem prestador definido"
          options={sortedProviders.map((p): [ string, string ] => [ p.id, p.name ])} onChange={(v) => set({ providerId: v })} />
        <p style={muted}>{`A distância mínima para TFD nesta cidade é de ${options.min_distance_km} km.`}</p>
      </div>

      {general.map((t) => <p key={t} role="alert" tabIndex={-1} data-refusal style={alert}>{t}</p>)}
      {kept && <p role="status" style={muted}>{kept}</p>}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : secondaryButtonStyle}>Salvar rascunho</button>
        <button type="button" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle} onClick={() => void save(true)}>Enviar à comissão</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function FieldErr({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} role="alert" tabIndex={-1} data-refusal style={alert}>{text}</p> : null;
}

const chosen: CSSProperties = { margin: 0, fontSize: 12.5, overflowWrap: "anywhere" };
