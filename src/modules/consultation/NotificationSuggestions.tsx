// src/modules/consultation/NotificationSuggestions.tsx
// Notificação de doença ou agravo dentro da consulta (módulo 25; ADR 0043; F-25.2;
// contrato §4 e K12). Lê as sugestões do api (CID do rascunho SALVO em lista de
// notificação obrigatória), deixa notificar a suspeita com a data dos primeiros
// sintomas e oferece "Notificar outra suspeita" (enfermeiro com CIAP-2 sem
// correspondência, ou quem quer notificar sem CID). A notificação NUNCA bloqueia a
// finalização: toda recusa e toda falha de leitura ficam aqui, em frase, e quem
// finaliza não depende desta peça. Só a consulta em rascunho monta o editor, então
// só nela se oferece notificar (K12(b): o api ainda aceita depois, a tela não oferece).
import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createConsultationNotification, errorCode, getNotificationSuggestions, listSurveillanceDiseases } from "../../lib/api";
import {
  DISEASES_KEY, NOMINAL_QUERY, STATIC_QUERY, SUGGESTIONS_KEY, deadlineLabel, surveillanceError, symptomsProblem
} from "../../lib/surveillance";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, okText, row, title } from "../exams/styles";

export const SUGGESTION_PENDING_NOTE =
  "Há CID de notificação obrigatória sem notificação. Você pode notificar agora ou finalizar assim mesmo: a vigilância receberá o caso como possível notificação não feita.";

interface Props {
  consultationId: string;
  // Os `terminology:code` dos problemas incluídos que o api já tem salvos (o editor só troca depois do autosave).
  problemsKey: string;
  today: string;
  finalizing: boolean;
  // Onde o aviso de finalização aparece: `undefined` = aqui mesmo; elemento = nele (a caixa de finalizar
  // do editor); `null` = o destino ainda não existe.
  noteTarget?: HTMLElement | null;
}

export function NotificationSuggestions({ consultationId, problemsKey, today, finalizing, noteTarget }: Props) {
  const [ symptoms, setSymptoms ] = useState("");
  const [ picking, setPicking ] = useState(false);
  const [ picked, setPicked ] = useState("");
  const [ done, setDone ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  // Doenças que o api disse já estarem notificadas (409): saem da tela.
  const [ gone, setGone ] = useState<string[]>([]);

  // O api lê o rascunho salvo: a chave só muda quando o autosave assenta. Sem polling.
  const suggestions = useQuery({
    queryKey: [ SUGGESTIONS_KEY, consultationId, problemsKey ], queryFn: () => getNotificationSuggestions(consultationId),
    placeholderData: keepPreviousData, ...NOMINAL_QUERY
  });
  const diseases = useQuery({ queryKey: [ DISEASES_KEY ], queryFn: listSurveillanceDiseases, enabled: picking, ...STATIC_QUERY });

  const visible = (suggestions.data ?? []).filter((s) => !gone.includes(s.disease.code));
  const pickedDisease = diseases.data?.find((d) => d.code === picked);

  async function notify(code: string, name: string) {
    if (busy) return;
    const problem = symptomsProblem(symptoms, today, today);
    setDone(null);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      await createConsultationNotification({ consultation_id: consultationId, disease_code: code, ...(symptoms ? { symptoms_on: symptoms } : {}) });
      setDone(`Suspeita de ${name} notificada à vigilância.`);
      // Some já: sem segundo clique (409) e sem aviso de pendência se a releitura falhar.
      setGone((g) => [ ...g, code ]);
      setSymptoms(""); setPicking(false); setPicked("");
      void suggestions.refetch();
    } catch (err) {
      setError(surveillanceError(err));
      if (errorCode(err) === "already_notified") setGone((g) => [ ...g, code ]);
    } finally {
      setBusy(false);
    }
  }

  const note = finalizing && visible.length > 0 ? <p style={pendingNote}>{SUGGESTION_PENDING_NOTE}</p> : null;

  return (
    <section aria-label="Notificação de doença ou agravo" style={box}>
      <strong style={title}>Notificação de doença ou agravo</strong>
      {suggestions.isPending && <p style={muted}>verificando os CID de notificação obrigatória…</p>}
      {suggestions.isError && <p role="alert" style={alert}>{surveillanceError(suggestions.error)}</p>}

      {visible.map((s) => (
        <div key={s.disease.code} style={row}>
          <p style={suggestionText}>{`CID de notificação obrigatória (${s.matched_code}): notificar suspeita de ${s.disease.name}`}</p>
          {s.disease.deadline === "immediate" && <Tag tone="down">{deadlineLabel("immediate")}</Tag>}
          <button type="button" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}
            onClick={() => void notify(s.disease.code, s.disease.name)}>
            {`Notificar suspeita de ${s.disease.name}`}
          </button>
        </div>
      ))}

      {(visible.length > 0 || picking) && (
        <label style={{ ...fieldLabel, maxWidth: 240 }}>
          Primeiros sintomas (opcional)
          <input type="date" value={symptoms} max={today} style={inputStyle} onChange={(e) => setSymptoms(e.target.value)} />
        </label>
      )}

      {!picking ? (
        <div>
          <button type="button" style={secondaryButtonStyle} onClick={() => { setPicking(true); setError(null); }}>
            Notificar outra suspeita
          </button>
        </div>
      ) : (
        <div style={row}>
          <label style={{ ...fieldLabel, minWidth: 240 }}>
            Doença ou agravo
            <select value={picked} style={inputStyle} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Escolha a doença…</option>
              {(diseases.data ?? []).map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          </label>
          {pickedDisease?.notes && <p style={muted}>{pickedDisease.notes}</p>}
          {diseases.isPending && <p style={muted}>carregando as doenças…</p>}
          {diseases.isError && <p role="alert" style={alert}>{surveillanceError(diseases.error)}</p>}
          <button type="button" disabled={busy || !pickedDisease} style={busy || !pickedDisease ? disabledButtonStyle : buttonStyle}
            onClick={() => pickedDisease && void notify(pickedDisease.code, pickedDisease.name)}>
            Notificar suspeita
          </button>
          <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={() => { setPicking(false); setPicked(""); setError(null); }}>
            Cancelar
          </button>
        </div>
      )}

      {done && <p role="status" style={okText}>{done}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {/* Portal e não o editor: o aviso depende de `visible` (que desconta `gone`); o editor teria de espelhá-lo. */}
      {noteTarget === undefined ? note : noteTarget && note ? createPortal(note, noteTarget) : null}
    </section>
  );
}

const suggestionText: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
const pendingNote: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--ink)" };
