// Identificar o paciente provisório da UPA (módulo 32a, F-32.2; contrato §4, §14 Q5, Q17, Q19, Q21, Q23, Q25). Só a recepção
// (`citizen_verifier`, A8). O encontro é lido pelo id (NOMINAL_QUERY: cada leitura grava trilha); a recepção o recebe sem o clínico,
// com a descrição do provisório (Q19). Vale também para o encontro já encerrado (Q25: o óbito sem documento, no dia seguinte).
// - Paciente existente (busca por CPF ou CNS, ou um candidato do duplicado): a fusão é irreversível (Q5/Q21), então as duas pessoas
//   ficam lado a lado, a caixa de confirmação é obrigatória e o ConfirmButton pede um segundo passo antes de enviar `patient_id`.
// - Paciente novo: o provisório recebe os dados (`new_patient`), sem fusão nem caixa; o 409 duplicate_suspected mostra os
//   candidatos (Q23): escolher um vai à confirmação da fusão, "Nenhum destes" reenvia com `duplicates_reviewed: true`.
// - Uma vez só: already_identified/not_unidentified mostram a frase, releem o encontro ("Agora é: <nome>.") e o formulário some.
// - O aviso de sucesso leva só o nome e, com itens repetidos (Q17), quantos ficaram no provisório; nunca a descrição.
// Nome, CPF, CNS e descrição só no corpo do pedido e na tela: nada em URL, console ou analytics.
import { useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  errorCode, getUrgencyEncounter, identifyUrgencyPatient, lookupUrgencyPerson,
  type IdentifyInput, type UrgencyDuplicateCandidate, type UrgencyEncounter, type UrgencyIdentifyResult, type UrgencyPatientRef
} from "../../lib/api";
import { onlyDigits } from "../../lib/attendance";
import { todayInCity } from "../../lib/campaigns";
import { fmtDateTime } from "../../lib/format";
import type { Problem } from "../../lib/pharmacy";
import { fmtDay } from "../../lib/territoryRegistry";
import { newPatientProblem } from "../../lib/territoryDictionaries";
import {
  ENCOUNTER_OPEN_ON_IDENTIFY, NOMINAL_QUERY, URGENCY_DETAIL_KEY, URGENCY_ERRORS, outcomeLabel, urgencyError, urgencyRefusals
} from "../../lib/urgency";
import { ConfirmButton } from "../../components/ConfirmButton";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { NOT_FOUND_TEXT, PROVISIONAL_TEXT } from "./ArrivalForm";
import {
  DOC_TEXT, EMPTY_NEW, NEW_PATIENT_PATHS, NewPatientFields, candidateLine, candidatesOf, docMask, docQuery, draftPath, toNewPatient,
  withDoc, type NewDraft
} from "./NewPatientFields";

export const MERGE_QUESTION = "Ligar agora? Não dá para desfazer.";
export const MERGE_BLOCKED_REASON = "marque a confirmação";
export const PATIENT_GONE_TEXT = "o paciente escolhido não foi encontrado — busque de novo";
// Q5/Q21: o que passa para o paciente real.
export const mergeConfirmText = (name: string) =>
  `Confirmo que é a mesma pessoa. O atendimento, a consulta, os documentos, os exames, as receitas e o faturamento passam para ${name}, e isso não pode ser desfeito.`;
// Q17: itens repetidos (o mesmo problema ou medicamento já ativo no paciente real) ficam no provisório.
export function identifiedNotice(r: UrgencyIdentifyResult): string {
  const base = `Identificado: ${r.encounter.patient.name}.`;
  const n = r.kept_duplicates;
  if (!n) return base;
  return n === 1
    ? `${base} 1 item repetido ficou no registro provisório (já existia no paciente).`
    : `${base} ${n} itens repetidos ficaram no registro provisório (já existiam no paciente).`;
}

// Q25: na identificação, encounter_open quer dizer que o paciente escolhido já tem um atendimento aberto nesta UPA.
const OVERRIDES = { encounter_open: ENCOUNTER_OPEN_ON_IDENTIFY, patient_not_found: PATIENT_GONE_TEXT };
// O encontro já não é de um provisório: outra pessoa identificou antes.
const LOST_CODES = new Set([ "already_identified", "not_unidentified" ]);

// O paciente escolhido para a fusão: o achado pela busca (com o CNS mascarado) ou um candidato do duplicado (com o nascimento).
type Chosen = { patient_id: string; name: string; cns_masked: string | null; birth_date: string | null };
const fromRef = (p: UrgencyPatientRef): Chosen => ({ patient_id: p.patient_id, name: p.name, cns_masked: p.cns_masked ?? null, birth_date: null });
const fromCandidate = (c: UrgencyDuplicateCandidate): Chosen =>
  ({ patient_id: c.patient_id, name: c.display_name, cns_masked: null, birth_date: c.birth_date });

export interface IdentifyPatientProps {
  encounterId: string;
  // `notice` é o aviso para a mesa (o nome e, se houver, os itens repetidos).
  onIdentified(e: UrgencyEncounter, notice: string): void;
  onCancel(): void;
}

const column = { display: "flex", flexDirection: "column" as const, gap: 4, flex: "1 1 220px", minWidth: 0 };
const columnTitle = { margin: 0, fontSize: 12, fontWeight: 600, color: "var(--ink2)" };

function stateLine(e: UrgencyEncounter): string {
  const arrived = `chegada ${fmtDateTime(e.arrived_at)}`;
  return e.state === "closed" ? `${arrived} · encerrado${e.outcome ? ` · ${outcomeLabel(e.outcome.kind)}` : ""}` : arrived;
}

export function IdentifyPatient({ encounterId, onIdentified, onCancel }: IdentifyPatientProps) {
  const ids = useId();
  const detail = useQuery({
    queryKey: [ URGENCY_DETAIL_KEY, encounterId ], queryFn: () => getUrgencyEncounter(encounterId), ...NOMINAL_QUERY
  });
  const [ doc, setDoc ] = useState("");
  const [ docProblem, setDocProblem ] = useState<string | null>(null);
  const [ searching, setSearching ] = useState(false);
  const searchingRef = useRef(false);
  const [ found, setFound ] = useState<{ patient: UrgencyPatientRef | null } | null>(null);
  const [ chosen, setChosen ] = useState<Chosen | null>(null);
  const [ confirmed, setConfirmed ] = useState(false);
  const [ creating, setCreating ] = useState(false);
  const [ draft, setDraft ] = useState<NewDraft>(EMPTY_NEW);
  const [ duplicates, setDuplicates ] = useState<UrgencyDuplicateCandidate[] | null>(null);
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ topErrors, setTopErrors ] = useState<string[]>([]);
  const [ busy, setBusy ] = useState(false);
  const busyRef = useRef(false);
  // Outra pessoa identificou antes (a frase fica; o formulário some) e o aviso do sucesso.
  const [ lost, setLost ] = useState<string | null>(null);
  const [ done, setDone ] = useState<string | null>(null);

  const clearMessages = () => { setProblems([]); setTopErrors([]); };
  const choose = (c: Chosen | null) => { setChosen(c); setConfirmed(false); clearMessages(); };

  async function search(e: FormEvent) {
    e.preventDefault();
    if (searchingRef.current) return;
    const q = docQuery(onlyDigits(doc));
    if ("problem" in q) { setDocProblem(q.problem); return; }
    searchingRef.current = true; setSearching(true); setDocProblem(null); clearMessages(); setFound(null);
    try {
      setFound({ patient: (await lookupUrgencyPerson(q.query)).patient });
    } catch (err) {
      setDocProblem(urgencyError(err, { invalid_request: DOC_TEXT }));
    } finally {
      searchingRef.current = false; setSearching(false);
    }
  }

  async function submit(body: IdentifyInput) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); clearMessages();
    try {
      const result = await identifyUrgencyPatient(encounterId, body);
      const notice = identifiedNotice(result);
      setDone(notice);
      onIdentified(result.encounter, notice);
    } catch (err) {
      const code = errorCode(err) ?? "";
      if (LOST_CODES.has(code)) {
        setLost(urgencyError(err));
        void detail.refetch();
        return;
      }
      if (code === "duplicate_suspected" && "new_patient" in body) { setDuplicates(candidatesOf(err)); return; }
      // A fusão recusada volta a pedir a caixa (a decisão vale para o envio que falhou).
      setConfirmed(false);
      const fields = "new_patient" in body ? NEW_PATIENT_PATHS : [];
      const refusals = urgencyRefusals(err, OVERRIDES)
        .map((r) => (r.code === "invalid_request" && r.path === "patient_id" ? { ...r, text: PROVISIONAL_TEXT } : r));
      setProblems(refusals.filter((r) => fields.includes(r.path)));
      setTopErrors(refusals.filter((r) => !fields.includes(r.path)).map((r) => r.text));
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  function submitNew(reviewed: boolean) {
    if (busyRef.current) return;
    const patient = toNewPatient(draft);
    const local = newPatientProblem(patient, todayInCity());
    if (local) { setTopErrors([]); setProblems([ { path: local.path, text: local.message } ]); return; }
    void submit({ new_patient: patient, ...(reviewed ? { duplicates_reviewed: true as const } : {}) });
  }
  function onNewSubmit(e: FormEvent) { e.preventDefault(); submitNew(false); }

  // Mudou o paciente novo depois do aviso: a conferência vale para o que foi enviado, então some.
  const edit = (key: keyof NewDraft, value: string) => {
    setDraft((cur) => ({ ...cur, [key]: value })); setDuplicates(null);
    setProblems((p) => p.filter((x) => x.path !== draftPath(key)));
  };
  const startNew = () => {
    choose(null); setCreating(true); setDuplicates(null);
    if (found?.patient === null) setDraft((cur) => withDoc(cur, onlyDigits(doc)));
  };

  const encounter = detail.data;
  const errId = `${ids}-doc-err`;
  const closeButton = (label: string) => <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>{label}</button></div>;

  if (detail.isPending) return <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>;
  if (detail.isError || !encounter) {
    return (
      <div style={form}>
        <p role="alert" style={alert}>{urgencyError(detail.error)}</p>
        {closeButton("Fechar")}
      </div>
    );
  }

  const here = (
    <div style={column}>
      <p style={columnTitle}>Quem está na UPA</p>
      <span className="mono">{encounter.ticket ?? "sem senha"}</span>
      {encounter.patient.unidentified && encounter.patient.description && <span style={{ fontSize: 12.5 }}>{encounter.patient.description}</span>}
      <span className="mono" style={muted}>{stateLine(encounter)}</span>
    </div>
  );

  if (done) {
    return (
      <div style={form}>
        <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{done}</p>
        {closeButton("Fechar")}
      </div>
    );
  }

  // Já identificado (antes de abrir ou por outra pessoa agora): só quem é, sem segunda tentativa.
  if (lost || !encounter.patient.unidentified) {
    return (
      <div style={form}>
        {lost && <p role="alert" style={alert}>{lost}</p>}
        {!encounter.patient.unidentified && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{`Agora é: ${encounter.patient.name}.`}</p>}
        {closeButton("Fechar")}
      </div>
    );
  }

  const busyStyle = (base: typeof buttonStyle) => (busy ? disabledButtonStyle : base);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!chosen && <div style={box}>{here}</div>}
      {topErrors.map((t, i) => <p key={i} role="alert" style={alert}>{t}</p>)}

      {chosen ? (
        <fieldset aria-label="Confira antes de ligar" style={fieldset}>
          <legend style={legend}>Confira antes de ligar</legend>
          <div style={{ ...row, alignItems: "flex-start", gap: 16 }}>
            {here}
            <div style={column}>
              <p style={columnTitle}>Paciente escolhido</p>
              <strong>{chosen.name}</strong>
              {chosen.cns_masked && <span className="mono" style={muted}>{chosen.cns_masked}</span>}
              {chosen.birth_date && <span style={muted}>{`nasc. ${fmtDay(chosen.birth_date)}`}</span>}
            </div>
          </div>
          <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>{mergeConfirmText(chosen.name)}</span>
          </label>
          <div style={row}>
            <ConfirmButton label="Ligar ao paciente existente" question={MERGE_QUESTION} variant="danger"
              disabledReason={confirmed ? null : MERGE_BLOCKED_REASON}
              onConfirm={() => submit({ patient_id: chosen.patient_id })} />
            <button type="button" style={secondaryButtonStyle} onClick={() => choose(null)}>Escolher outro</button>
          </div>
        </fieldset>
      ) : (
        <>
          <form onSubmit={search} noValidate style={{ ...row, alignItems: "flex-end" }}>
            <label style={{ ...fieldLabel, minWidth: 220 }}>
              CPF ou CNS
              <input value={docMask(doc)} style={inputStyle} inputMode="numeric" autoComplete="off"
                aria-invalid={docProblem ? true : undefined} aria-describedby={docProblem ? errId : undefined}
                onChange={(e) => { setDoc(onlyDigits(e.target.value).slice(0, 15)); setDocProblem(null); setFound(null); }} />
            </label>
            <button type="submit" aria-disabled={searching || undefined} style={searching ? disabledButtonStyle : buttonStyle}>Buscar</button>
          </form>
          {docProblem && <p id={errId} role="alert" style={alert}>{docProblem}</p>}

          {found && (found.patient ? (
            <div style={box}>
              <strong>{found.patient.name}</strong>
              {found.patient.cns_masked && <span className="mono" style={muted}>CNS {found.patient.cns_masked}</span>}
              <div>
                <button type="button" style={buttonStyle} onClick={() => found.patient && choose(fromRef(found.patient))}>
                  É {found.patient.name}
                </button>
              </div>
            </div>
          ) : <p role="status" style={{ margin: 0, fontSize: 13 }}>{NOT_FOUND_TEXT}</p>)}

          {!creating && (
            <div style={row}>
              <button type="button" style={secondaryButtonStyle} onClick={startNew}>Cadastrar como paciente novo</button>
            </div>
          )}

          {creating && (
            <form style={form} onSubmit={onNewSubmit} noValidate aria-label="Paciente novo">
              <NewPatientFields draft={draft} problems={problems} idBase={ids} onEdit={edit} />
              {duplicates ? (
                <fieldset style={fieldset}>
                  <legend style={legend}>Cadastros parecidos</legend>
                  <p style={{ margin: 0, fontSize: 12.5 }}>{URGENCY_ERRORS.duplicate_suspected}</p>
                  {duplicates.map((c) => (
                    <div key={c.patient_id} style={{ ...row, justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12.5 }}>{candidateLine(c)}</span>
                      <button type="button" style={secondaryButtonStyle} onClick={() => choose(fromCandidate(c))}>É {c.display_name}</button>
                    </div>
                  ))}
                  <div>
                    <button type="button" aria-disabled={busy || undefined} style={busyStyle(buttonStyle)} onClick={() => submitNew(true)}>
                      Nenhum destes — cadastrar como novo
                    </button>
                  </div>
                </fieldset>
              ) : (
                <div><button type="submit" aria-disabled={busy || undefined} style={busyStyle(buttonStyle)}>Identificar</button></div>
              )}
            </form>
          )}
        </>
      )}
      {closeButton("Cancelar")}
    </div>
  );
}
