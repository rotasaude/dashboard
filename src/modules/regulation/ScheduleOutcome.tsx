// src/modules/regulation/ScheduleOutcome.tsx
// Agendamento fora da rede própria e desfecho do atendimento (módulo 26a; F-26.5), pelas ações da situação (`actionsFor`).
// "Registrar agendamento" (ou "Remarcar", que mantém o mês da cota) vale em `authorized`/`scheduled` de prestador externo e
// em `external` regulado pelo estado; "Realizado" e "Faltou" valem em `scheduled`. A hora digitada é a da cidade (`cityLocalIso`).
// A primeira falta devolve o pedido à fila sem devolver a cota; a segunda o encerra: a frase sai da resposta do api. Na rede
// própria o horário é do pedido de agendamento do módulo 17 e aqui não há formulário. `stale_version` deixa o formulário como
// está. Local e observação não vão a log nem a URL.
import { useState } from "react";
import { errorCode, recordRegulationOutcome, scheduleRegulationRequest } from "../../lib/api";
import type { RegulationRequest } from "../../lib/api";
import { actionsFor, notesProblem, placeProblem, regulationError, scheduleAtProblem } from "../../lib/regulation";
import { cityLocalIso } from "../../lib/format";
import { ConfirmButton } from "../../components/ConfirmButton";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";

export const OWN_NETWORK_TEXT = "O agendamento é feito pela unidade de destino (pedido de agendamento do módulo 17).";
export const SCHEDULED_TEXT = "Agendamento registrado: o cidadão vê a data e o local no celular.";
const FIRST_MISS_TEXT = "Falta registrada: o pedido voltou para a fila (primeira falta; a vaga não volta para a cota).";

export function outcomeText(after: RegulationRequest): string {
  if (after.status === "completed") return "Atendimento realizado registrado.";
  if (after.status === "closed") return "Segunda falta: o pedido foi encerrado.";
  if ((after.status === "pending" || after.status === "external") && after.misses === 1) return FIRST_MISS_TEXT;
  return "Desfecho registrado.";
}

export function ScheduleOutcome({ request, onChanged, onApplied, onStale, onStart }: {
  request: RegulationRequest; onChanged(text: string): void; onApplied?(updated: RegulationRequest): void; onStale?(text: string): void;
  // Uma nova ação começou (abrir o formulário, enviar, confirmar o desfecho): quem chama limpa a frase de sucesso anterior.
  onStart?(): void;
}) {
  const [ open, setOpen ] = useState(false);
  const [ message, setMessage ] = useState<string | null>(null);
  const actions = actionsFor(request);
  const own = request.authorization?.provider.kind === "own";
  const ownWaiting = own && (request.status === "authorized" || request.status === "scheduled");

  // Recusa de versão ou de situação: a frase vai a quem oferece o "Recarregar", se houver; senão fica aqui. O formulário
  // não fecha. Devolve a frase que ficou para este componente mostrar (ou null, se subiu).
  function refuse(err: unknown): string | null {
    const code = errorCode(err);
    const phrase = regulationError(err);
    if ((code === "stale_version" || code === "invalid_transition") && onStale) { onStale(phrase); return null; }
    return phrase;
  }

  function done(updated: RegulationRequest, text: string) {
    setOpen(false);
    setMessage(null);
    onApplied?.(updated);
    onChanged(text);
  }

  async function outcome(result: "completed" | "missed") {
    setMessage(null);
    onStart?.();
    try {
      const updated = await recordRegulationOutcome(request.id, result, request.version);
      done(updated, outcomeText(updated));
    } catch (err) {
      setMessage(refuse(err));
    }
  }

  if (ownWaiting) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={muted}>{OWN_NETWORK_TEXT}</p>
        {request.appointment_request_id && (
          <p style={muted}>Pedido de agendamento: <span className="mono">{request.appointment_request_id}</span></p>
        )}
      </div>
    );
  }
  if (!actions.schedule && !actions.outcome) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!open && (
        <div style={row}>
          {actions.schedule && (
            <button type="button" style={buttonStyle} onClick={() => { setMessage(null); onStart?.(); setOpen(true); }}>
              {request.schedule ? "Remarcar" : "Registrar agendamento"}
            </button>
          )}
          {actions.outcome && (
            <>
              <ConfirmButton label="Realizado" question="Confirmar que o atendimento foi realizado?" onConfirm={() => outcome("completed")} />
              <ConfirmButton label="Faltou" question="Confirmar que o paciente faltou?" onConfirm={() => outcome("missed")} />
            </>
          )}
        </div>
      )}
      {open && actions.schedule && (
        <ScheduleForm request={request} onStart={onStart} onCancel={() => setOpen(false)} onSaved={(updated) => done(updated, SCHEDULED_TEXT)} onRefused={refuse} />
      )}
      {message && <p role="alert" style={alert}>{message}</p>}
    </div>
  );
}

function ScheduleForm({ request, onSaved, onRefused, onCancel, onStart }: {
  request: RegulationRequest; onStart?(): void; onSaved(updated: RegulationRequest): void; onRefused(err: unknown): string | null; onCancel(): void;
}) {
  const [ at, setAt ] = useState("");
  const [ place, setPlace ] = useState(request.schedule?.place ?? "");
  const [ notes, setNotes ] = useState(request.schedule?.notes ?? "");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    onStart?.();
    const found = scheduleAtProblem(at) ?? placeProblem(place) ?? notesProblem(notes);
    const iso = cityLocalIso(at);
    if (found || !iso) { setProblem(found ?? "data e hora inválidas"); return; }
    setProblem(null);
    setBusy(true);
    try {
      const updated = await scheduleRegulationRequest(request.id, {
        at: iso, place: place.trim(), notes: notes.trim() === "" ? null : notes.trim(), version: request.version
      });
      onSaved(updated);
    } catch (err) {
      setProblem(onRefused(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label="Agendamento do pedido" onSubmit={submit} noValidate style={form}>
      <label style={fieldLabel}>
        Data e hora
        <input type="datetime-local" value={at} style={inputStyle} onChange={(e) => setAt(e.target.value)} />
      </label>
      <label style={fieldLabel}>
        Local
        <input type="text" value={place} style={inputStyle} onChange={(e) => setPlace(e.target.value)} />
      </label>
      <label style={fieldLabel}>
        Observação (opcional)
        <textarea value={notes} rows={3} style={inputStyle} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Salvar agendamento</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
