// Transcrição da caderneta de papel na sala (módulo 29; F-29.3; contrato §5; §15 V14, V19, V23). Uma linha por dose: vacina, dose,
// data (não futura, não antes do nascimento) e, opcionais em texto livre, lote (≤ 40), fabricante (≤ 120, nome livre — sem a chave do
// catálogo) e local (≤ 120); até 40 linhas. "Esta caderneta está conferida depois desta transcrição" só aparece na caderneta sem
// conferência (marcada por padrão; `close_check`). Um envio com todas as recusas de uma vez: as locais e as do api (`items[i].*`) na
// linha pelo índice. O sucesso devolve a caderneta da resposta (sem nova leitura). Nada vai a storage, URL ou console.
import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { recordTranscriptions, type VaccinationCard, type VaccinationCatalog, type VaccineLocation } from "../../lib/api";
import { cityIsoDate } from "../../lib/format";
import { problemItemIndex, type Problem } from "../../lib/pharmacy";
import {
  MAX_TRANSCRIPTION_ITEMS, newTranscriptionLine, transcriptionBody, transcriptionProblems, vaccinationRefusals, type TranscriptionLine,
  type VaccinationRefusal
} from "../../lib/vaccination";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, panel, row, title } from "../exams/styles";
import { STALE_REFUSAL } from "./DoseForm";

export interface TranscriptionFormProps {
  room: VaccineLocation; card: VaccinationCard; catalog: VaccinationCatalog;
  // Só para testes: sem ele, "hoje" é lido na hora de usar (o `max` da data e a conferência antes de enviar).
  today?: string;
  onDone(c: VaccinationCard): void; onCancel(): void;
}

// Nome da vacina da linha para a frase da recusa: catálogo, senão o código.
export const lineName = (line: Pick<TranscriptionLine, "immunobiologicalCode">, catalog: VaccinationCatalog): string =>
  catalog.immunobiologicals.find((m) => m.code === line.immunobiologicalCode)?.name ?? (line.immunobiologicalCode || "dose");

export interface TranscriptionLineFieldsProps {
  legend: string; line: TranscriptionLine; catalog: VaccinationCatalog; today: string; birthDate: string; errors: string[];
  onChange(patch: Partial<TranscriptionLine>): void; onRemove?(): void;
}

// Os campos de uma dose transcrita: a transcrição e a substituição de uma dose transcrita (CancelDose) os montam.
export function TranscriptionLineFields({ legend, line, catalog, today, birthDate, errors, onChange, onRemove }: TranscriptionLineFieldsProps) {
  const uid = useId();
  const errId = `${uid}-err`;
  const described = errors.length > 0 ? { "aria-describedby": errId } : {};
  const text = (key: "lotNumber" | "manufacturerName" | "place", label: string, max: number) => (
    <div style={fieldLabel}>
      <label htmlFor={`${uid}-${key}`}>{label}</label>
      <input id={`${uid}-${key}`} style={inputStyle} maxLength={max} value={line[key]} onChange={(e) => onChange({ [key]: e.target.value })} />
    </div>
  );
  return (
    <fieldset style={{ ...box, margin: 0 }} {...described}>
      <legend style={{ fontSize: 12.5, fontWeight: 600 }}>{legend}</legend>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-imm`}>Vacina</label>
        <select id={`${uid}-imm`} style={inputStyle} value={line.immunobiologicalCode} onChange={(e) => onChange({ immunobiologicalCode: e.target.value })}>
          <option value="">escolha a vacina</option>
          {catalog.immunobiologicals.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
        </select>
      </div>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-dose`}>Dose</label>
        <select id={`${uid}-dose`} style={inputStyle} value={line.doseCode} onChange={(e) => onChange({ doseCode: e.target.value })}>
          <option value="">escolha a dose</option>
          {catalog.terminologies.dose.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      </div>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-on`}>Data da aplicação</label>
        <input id={`${uid}-on`} type="date" style={inputStyle} max={today} min={birthDate} value={line.appliedOn}
          onChange={(e) => onChange({ appliedOn: e.target.value })} />
      </div>
      {text("lotNumber", "Lote (opcional)", 40)}
      {text("manufacturerName", "Fabricante (opcional)", 120)}
      {text("place", "Local da aplicação (opcional)", 120)}
      {errors.length > 0 && <div id={errId}>{errors.map((t) => <p key={t} style={alert}>{t}</p>)}</div>}
      {onRemove && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} aria-label={`Remover ${legend.toLowerCase()}`} onClick={onRemove}>Remover</button>
        </div>
      )}
    </fieldset>
  );
}

export function TranscriptionForm({ room, card, catalog, today: fixedToday, onDone, onCancel }: TranscriptionFormProps) {
  const todayNow = () => fixedToday ?? cityIsoDate(new Date());
  const today = todayNow();
  const unchecked = card.checked === null;
  const birthDate = card.patient.birth_date;
  const [ lines, setLines ] = useState<TranscriptionLine[]>([]);
  const [ closeCheck, setCloseCheck ] = useState(unchecked);
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ refusals, setRefusals ] = useState<VaccinationRefusal[]>([]);
  const nextKey = useRef(0);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Callbacks no mutate(): no TanStack v5 os das opções disparariam depois de desmontar (outra pessoa aberta).
  const send = useMutation({ gcTime: 0, mutationFn: (body: ReturnType<typeof transcriptionBody>) => recordTranscriptions(room.room_id as string, body) });

  function add() {
    if (lines.length >= MAX_TRANSCRIPTION_ITEMS) return;
    setLines((ls) => [ ...ls, newTranscriptionLine(`t${++nextKey.current}`) ]);
    setProblems((ps) => ps.filter((p) => p.path !== "items"));
  }

  // Editar uma linha tira as recusas dela (locais e do api).
  function change(i: number, patch: Partial<TranscriptionLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setProblems((ps) => ps.filter((p) => problemItemIndex(p.path) !== i));
    setRefusals((rs) => rs.filter((r) => problemItemIndex(r.path) !== i));
  }

  // Remover desloca os índices: as recusas por linha somem (a conferência refaz as locais no próximo envio).
  function remove(i: number) {
    setLines((ls) => ls.filter((_, j) => j !== i));
    setProblems((ps) => ps.filter((p) => problemItemIndex(p.path) === null));
    setRefusals((rs) => rs.filter((r) => problemItemIndex(r.path) === null));
  }

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy.current) return;
    const close = unchecked && closeCheck;
    const found = transcriptionProblems(lines, { today: todayNow(), birthDate, closeCheck: close, catalog });
    // Recusa do api ainda na linha = a linha não mudou desde a resposta.
    if (refusals.some((r) => problemItemIndex(r.path) !== null)) found.push({ path: "", text: STALE_REFUSAL });
    setProblems(found);
    if (found.length > 0) return;
    busy.current = true;
    setRefusals([]);
    send.mutate(transcriptionBody(lines, card.patient.id, close), {
      onSuccess: (res) => { busy.current = false; if (alive.current) onDone(res.card); },
      onError: (err) => { busy.current = false; if (alive.current) setRefusals(vaccinationRefusals(err)); }
    });
  }

  const lineErrors = (i: number): string[] => [
    ...problems.filter((p) => problemItemIndex(p.path) === i).map((p) => p.text),
    ...refusals.filter((r) => problemItemIndex(r.path) === i).map((r) => `${lineName(lines[i], catalog)}: ${r.text}`)
  ];
  const general = [
    ...problems.filter((p) => problemItemIndex(p.path) === null).map((p) => p.text),
    ...refusals.filter((r) => problemItemIndex(r.path) === null || problemItemIndex(r.path)! >= lines.length).map((r) => r.text)
  ];
  const anyLine = lines.some((_, i) => lineErrors(i).length > 0);
  const sending = send.isPending;
  const full = lines.length >= MAX_TRANSCRIPTION_ITEMS;

  return (
    <section aria-label="Transcrição da caderneta" style={panel}>
      <h3 style={title}>Transcrever caderneta</h3>
      <p style={muted}>Uma linha por dose da caderneta de papel. Lote, fabricante e local são opcionais.</p>
      <form aria-label="Transcrever caderneta" style={form} onSubmit={submit} noValidate>
        {lines.map((l, i) => (
          <TranscriptionLineFields key={l.key} legend={`Dose transcrita ${i + 1}`} line={l} catalog={catalog} today={today} birthDate={birthDate}
            errors={lineErrors(i)} onChange={(patch) => change(i, patch)} onRemove={() => remove(i)} />
        ))}
        <div style={row}>
          <button type="button" style={full ? disabledButtonStyle : secondaryButtonStyle} disabled={full} onClick={add}>Acrescentar dose</button>
          {full && <span style={muted}>{`no máximo ${MAX_TRANSCRIPTION_ITEMS} doses por transcrição`}</span>}
        </div>
        {unchecked && (
          <label style={{ ...row, fontSize: 13 }}>
            <input type="checkbox" checked={closeCheck} onChange={(e) => setCloseCheck(e.target.checked)} />
            Esta caderneta está conferida depois desta transcrição
          </label>
        )}
        {general.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
        {anyLine && general.length === 0 && <p role="alert" style={alert}>confira as doses destacadas</p>}
        <div style={row}>
          <button type="submit" style={sending ? disabledButtonStyle : buttonStyle} disabled={sending}>Registrar transcrição</button>
          <button type="button" style={secondaryButtonStyle} disabled={sending} onClick={onCancel}>Voltar à caderneta</button>
        </div>
        {sending && <p className="mono" style={muted}>registrando…</p>}
      </form>
    </section>
  );
}
