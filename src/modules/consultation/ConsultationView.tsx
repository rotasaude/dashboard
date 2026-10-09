// src/modules/consultation/ConsultationView.tsx
// Consulta finalizada (módulo 19; spec §4 e §7; contratos §4): leitura, adendos
// em ordem, Adendo e Imprimir. Ler pelo GET gera a trilha no api. O PDF é lido
// com a sessão e aberto numa janela nova por um endereço `blob:` (nada do
// conteúdo passa pela URL da aplicação).
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, fetchConsultationPdf, getConsultation,
  type Consultation, type ConsultationOptions, type PatientProblem
} from "../../lib/api";
import { ACTION_LABEL, CONSULTATION_KEY, SOAP_FIELDS, changesLines, codedLabel, consultationError } from "../../lib/consultation";
import { fmtDateTime } from "../../lib/format";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { VitalsList } from "./PatientPanel";
import { AddendumForm } from "./AddendumForm";

export interface ConsultationViewProps {
  consultation: Consultation;
  options: ConsultationOptions | null;
  patientProblems: PatientProblem[];
  canAddendum: boolean;
  openingId?: string;
  searchDelayMs?: number;
  onAddendumAdded(): void;
  onClose(): void;
  onOpeningRequired?(): void;
}

const PDF_URL_TTL_MS = 60_000;
const POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para imprimir";

export function ConsultationView(props: ConsultationViewProps) {
  const { consultation: c, options } = props;
  const [ adding, setAdding ] = useState(false);
  const [ printing, setPrinting ] = useState(false);
  const [ printError, setPrintError ] = useState<string | null>(null);
  const conductLabel = (code: string) => codedLabel(options?.conducts, code);
  const addenda = [ ...(c.addenda ?? []) ].sort((a, b) => a.created_at.localeCompare(b.created_at));

  async function print() {
    if (printing) return;
    setPrinting(true); setPrintError(null);
    // Aberta no clique: depois de um await, o navegador trataria como pop-up.
    const win = window.open("", "_blank");
    try {
      const blob = await fetchConsultationPdf(c.id);
      if (!win) { setPrintError(POPUP_BLOCKED); return; }
      const url = URL.createObjectURL(blob);
      win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), PDF_URL_TTL_MS);
    } catch (err) {
      win?.close();
      if (errorCode(err) === "opening_required") props.onOpeningRequired?.();
      setPrintError(consultationError(err));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <section aria-label="Consulta finalizada" style={panel}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>{`Consulta de ${fmtDateTime(c.finalized_at)}`}</strong>
        <span style={muted}>{`${c.author.name} · ${codedLabel(options?.care_types, c.care_type)}`}</span>
      </div>

      {SOAP_FIELDS.map((f) => c[f.key] ? (
        <div key={f.key} style={block}>
          <strong style={sub}>{f.label}</strong>
          <p style={textStyle}>{c[f.key]}</p>
        </div>
      ) : null)}

      <VitalsList vitals={c.vitals ?? {}} label="sinais vitais da consulta" />

      {c.evaluated_problems.length > 0 && (
        <ul aria-label="problemas avaliados" style={list}>
          {c.evaluated_problems.map((p) => (
            <li key={`${p.terminology}:${p.code}`}>{`${p.code} — ${p.label} · ${ACTION_LABEL[p.action]}`}</li>
          ))}
        </ul>
      )}
      <p style={textStyle}>{`Condutas: ${c.conducts.map(conductLabel).join(" · ") || "—"}`}</p>
      {c.exam_requests.length > 0 && (
        <ul aria-label="exames solicitados" style={list}>
          {c.exam_requests.map((e) => (
            <li key={e.sigtap_code}>
              {`${e.sigtap_code} — ${e.label}${e.cid10_justification ? ` · CID-10 ${e.cid10_justification}` : ""}`}
            </li>
          ))}
        </ul>
      )}

      {addenda.length > 0 && (
        <ol aria-label="adendos" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {addenda.map((a) => (
            <li key={a.id} style={{ fontSize: 12.5 }}>
              <strong>{`Adendo de ${a.author_name} em ${fmtDateTime(a.created_at)}`}</strong>
              <p style={textStyle}>{`Motivo: ${a.reason}`}</p>
              <p style={textStyle}>{a.text}</p>
              {changesLines(a.changes, conductLabel).map((line) => <p key={line} style={textStyle}>{line}</p>)}
            </li>
          ))}
        </ol>
      )}

      {printError && <p role="alert" style={alert}>{printError}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={printing} style={printing ? disabledButtonStyle : buttonStyle} onClick={() => void print()}>
          Imprimir
        </button>
        {props.canAddendum && !adding && (
          <button type="button" style={secondaryButtonStyle} onClick={() => setAdding(true)}>Adendo</button>
        )}
        <button type="button" style={secondaryButtonStyle} onClick={props.onClose}>Fechar consulta</button>
      </div>

      {adding && (
        <AddendumForm consultation={c} options={options} patientProblems={props.patientProblems} openingId={props.openingId}
          searchDelayMs={props.searchDelayMs}
          onDone={() => { setAdding(false); props.onAddendumAdded(); }}
          onCancel={() => setAdding(false)} onOpeningRequired={props.onOpeningRequired} />
      )}
    </section>
  );
}

type LoaderProps = Omit<ConsultationViewProps, "consultation" | "canAddendum" | "onAddendumAdded"> & {
  id: string;
  canAddendum(c: Consultation): boolean;
};

export function ConsultationLoader({ id, canAddendum, ...rest }: LoaderProps) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ CONSULTATION_KEY, id ], queryFn: () => getConsultation(id), gcTime: 0, staleTime: 0 });
  const openingGone = query.isError && errorCode(query.error) === "opening_required";
  const { onOpeningRequired } = rest;

  useEffect(() => {
    if (openingGone) onOpeningRequired?.();
  }, [ openingGone, onOpeningRequired ]);

  if (query.isPending) return <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando a consulta…</p>;
  if (query.isError) return <p role="alert" style={alert}>{consultationError(query.error)}</p>;
  return (
    <ConsultationView consultation={query.data} canAddendum={canAddendum(query.data)}
      onAddendumAdded={() => void queryClient.invalidateQueries({ queryKey: [ CONSULTATION_KEY, id ] })} {...rest} />
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const block: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const sub: CSSProperties = { fontSize: 12 };
const list: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 12.5 };
const textStyle: CSSProperties = { margin: 0, fontSize: 12.5, whiteSpace: "pre-wrap" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
