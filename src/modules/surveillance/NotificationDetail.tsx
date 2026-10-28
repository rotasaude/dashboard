// src/modules/surveillance/NotificationDetail.tsx
// O detalhe da notificação (módulo 25; F-25.5, F-25.7): quem, onde, prazo,
// andamento e o passo seguinte. A leitura é nominal e grava na trilha: lê ao
// abrir e depois de uma ação, nunca sozinha (NOMINAL_QUERY). O PDF da ficha
// também é nominal e só sai por clique. Situação ou código novo do api aparece
// cru; nada é inventado.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchNotificationPdf, getNotification, type SurveillanceNotification } from "../../lib/api";
import {
  NOMINAL_QUERY, NOTIFICATIONS_KEY, NOTIFICATION_KEY, NO_NAME, NO_NEIGHBORHOOD,
  classificationLabel, deadlineLabel, fmtDay, originLabel, statusLabel, statusTone, surveillanceError
} from "../../lib/surveillance";
import { fmtDateTime } from "../../lib/format";
import { documentText } from "../../lib/patientDocument";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, grid, list, muted, panel, row, title } from "../exams/styles";
import { saveFile } from "../lab/saveFile";
import { NotificationFormSection } from "./NotificationFormSection";
import { TransitionForm } from "./TransitionForm";

interface Props {
  id: string;
  onClose(): void;
  onChanged?(n: SurveillanceNotification): void;
  // A ficha complementar é o padrão; quem quiser trocar recebe a notificação lida e devolve a salva.
  formSlot?: (n: SurveillanceNotification, onSaved: (n: SurveillanceNotification) => void) => ReactNode;
}

const residenceText = (n: SurveillanceNotification): string =>
  n.resident_elsewhere ? `residente em outro município${n.residence_ibge ? ` (IBGE ${n.residence_ibge})` : ""}` : "no município";
const defaultFormSlot: NonNullable<Props["formSlot"]> = (n, onSaved) => <NotificationFormSection notification={n} onSaved={onSaved} />;
const unitText = (n: SurveillanceNotification): string => (n.unit.cnes ? `${n.unit.name} · CNES ${n.unit.cnes}` : n.unit.name);

export function NotificationDetail({ id, onClose, onChanged, formSlot = defaultFormSlot }: Props) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: [ NOTIFICATION_KEY, id ], queryFn: () => getNotification(id), ...NOMINAL_QUERY });
  const [ pdfBusy, setPdfBusy ] = useState(false);
  const [ pdfError, setPdfError ] = useState<string | null>(null);
  const n = detail.data;

  async function downloadPdf() {
    if (pdfBusy) return;
    setPdfBusy(true); setPdfError(null);
    try {
      const file = await fetchNotificationPdf(id);
      saveFile(file, file.filename ?? `notificacao-${id}.pdf`);
    } catch (err) {
      setPdfError(surveillanceError(err));
    } finally {
      setPdfBusy(false);
    }
  }

  // O andamento já grava a resposta no cache e invalida a fila e a contagem; a ficha, aqui.
  function formSaved(saved: SurveillanceNotification) {
    client.setQueryData([ NOTIFICATION_KEY, id ], saved);
    void client.invalidateQueries({ queryKey: [ NOTIFICATIONS_KEY ] });
    onChanged?.(saved);
  }

  return (
    <section style={panel} aria-label="Detalhe da notificação">
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h3 style={title}>{n ? n.disease.name || n.disease.code : "Notificação"}</h3>
        <div style={row}>
          {n && <button type="button" style={secondaryButtonStyle} disabled={pdfBusy} onClick={() => void downloadPdf()}>Ficha em PDF</button>}
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
        </div>
      </div>
      {detail.isPending && <p style={muted}>carregando…</p>}
      {detail.isError && <p role="alert" style={alert}>{surveillanceError(detail.error)}</p>}
      {pdfError && <p role="alert" style={alert}>{pdfError}</p>}
      {n && (
        <>
          <div style={row}>
            <Tag tone={n.deadline === "immediate" ? "warn" : "neutral"}>{deadlineLabel(n.deadline)}</Tag>
            <Tag tone={statusTone(n.status)}>{statusLabel(n.status)}</Tag>
            {n.overdue && <Tag tone="down">vencida</Tag>}
          </div>
          <div style={grid}>
            <KeyValue k="Pessoa" v={n.patient.display_name || NO_NAME} mono={false} />
            <KeyValue k="Documento" v={documentText(n.patient)} />
            <KeyValue k="Bairro" v={n.neighborhood?.name || NO_NEIGHBORHOOD} mono={false} />
            <KeyValue k="Residência" v={residenceText(n)} mono={false} />
            <KeyValue k="Unidade" v={unitText(n)} mono={false} />
            <KeyValue k="Notificador" v={n.notifier?.name || "—"} mono={false} />
            <KeyValue k="Origem" v={originLabel(n.origin)} mono={false} />
            <KeyValue k="Suspeita em" v={fmtDay(n.suspected_on)} />
            <KeyValue k="Primeiros sintomas" v={fmtDay(n.symptoms_on)} />
            <KeyValue k="Prazo" v={fmtDateTime(n.due_at)} />
            <KeyValue k="Classificação" v={classificationLabel(n.classification)} mono={false} />
            <KeyValue k="Número oficial" v={n.official_number || "—"} />
          </div>
          <div>
            <h4 style={title}>Andamento</h4>
            <ul style={list}>
              {(n.events ?? []).map((ev, i) => (
                <li key={`${ev.status}-${ev.at}-${i}`}>
                  {`${statusLabel(ev.status)} · ${fmtDateTime(ev.at)} · ${ev.by?.name || "sistema"}${ev.reason ? ` · ${ev.reason}` : ""}`}
                </li>
              ))}
            </ul>
          </div>
          {formSlot(n, formSaved)}
          <TransitionForm notification={n} onDone={(saved) => onChanged?.(saved)} onReload={() => void detail.refetch()} />
        </>
      )}
    </section>
  );
}
