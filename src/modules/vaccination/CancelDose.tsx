// Cancelamento da dose, com a substituição opcional na mesma chamada (módulo 29; F-29.3; contrato §5; §15 V6, V7, V23; D17, D18).
// Só o autor ou o `room_lead` da sala da dose cancela (`can_cancel`, calculado pelo api), e só dose ativa. "Motivo do cancelamento"
// (10–500). "Registrar a dose correta agora" mostra os campos da dose: a de sala reaproveita o DoseForm (`DoseFields`, lote do estoque);
// a transcrita vai como item de transcrição (o api a grava assim). "Revisar" confere tudo e abre o step-up; a recusa com path
// `replacement.*` (ou do motivo) volta ao formulário com a frase no campo — nada foi cancelado (atômico). O sucesso devolve o par à
// tela, que relê a caderneta e diz "Dose cancelada." ou "Dose cancelada e substituída.". Nada vai a storage, URL ou console.
import { useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError, cancelImmunization, type CancelInput, type CardPatient, type Immunization, type VaccinationCatalog, type VaccineLocation
} from "../../lib/api";
import { cityIsoDate, fmtDateTime } from "../../lib/format";
import type { Problem } from "../../lib/pharmacy";
import {
  cityLocalInput, doseBody, newDoseDraft, newTranscriptionLine, reasonProblem, transcriptionBody, transcriptionProblems, vaccinationError,
  vaccinationRefusals, type TranscriptionLine, type VaccinationRefusal
} from "../../lib/vaccination";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, list, muted, panel, row, title } from "../exams/styles";
import { DoseFields, STALE_REFUSAL, doseCheck, doseRefused, useDoseDraft, useDoseStock } from "./DoseForm";
import { TranscriptionLineFields, lineName } from "./TranscriptionForm";

export type CancelResult = { cancelled: Immunization; replacement: Immunization | null };

export interface CancelDoseProps {
  imm: Immunization; room: VaccineLocation; patient: CardPatient; catalog: VaccinationCatalog;
  // Só para testes: sem ele, o relógio é lido na hora de usar.
  now?: Date;
  onDone(res: CancelResult): void; onCancel(): void; onGoToSecurity?(): void;
}

const NOT_ALLOWED = "só quem registrou ou o responsável pela sala cancela";
const PREFIX = "replacement.";

export function CancelDose(props: CancelDoseProps) {
  const { imm, onCancel } = props;
  const blocked = imm.status !== "active" ? "esta dose já foi cancelada" : imm.can_cancel ? null : NOT_ALLOWED;
  if (blocked) {
    return (
      <section aria-label="Cancelar dose" style={panel}>
        <h3 style={title}>Cancelar dose</h3>
        <p style={muted}>{blocked}</p>
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar à caderneta</button></div>
      </section>
    );
  }
  return <CancelForm {...props} />;
}

function CancelForm({ imm, room, patient, catalog, now: fixedNow, onDone, onCancel, onGoToSecurity }: CancelDoseProps) {
  const clock = () => fixedNow ?? new Date();
  const client = useQueryClient();
  const uid = useId();
  const transcribed = imm.transcription;
  // A substituta de dose de sala sai do estoque da sala da dose: de outra sala, só cancelar aqui.
  const canReplace = transcribed || imm.room?.id === room.room_id;
  const [ reason, setReason ] = useState("");
  const [ reasonErr, setReasonErr ] = useState<string | null>(null);
  const [ replace, setReplace ] = useState(false);
  const [ stage, setStage ] = useState<"form" | "confirm">("form");
  const [ general, setGeneral ] = useState<string[]>([]);

  // Dose de sala: o rascunho começa com o que a dose cancelada tinha (vacina, dose, estratégia, grupo, via, local, condição maternal e
  // hora); lote e frasco ficam por escolher.
  const dose = useDoseDraft(() => {
    const def = catalog.immunobiologicals.find((i) => i.code === imm.immunobiological.code) ?? null;
    return { ...newDoseDraft(def, imm.dose.code, clock()), immunobiologicalCode: imm.immunobiological.code, strategy: imm.strategy ?? "",
      careGroup: imm.care_group ?? "", route: imm.route || def?.default_route || "", site: imm.site || def?.default_site || "",
      maternalCondition: imm.maternal_condition ?? "", appliedAt: cityLocalInput(new Date(imm.applied_at)) };
  });
  const stock = useDoseStock(room, catalog, dose.draft.immunobiologicalCode);
  // Dose transcrita: a linha começa com o que a transcrição tinha.
  const [ line, setLine ] = useState<TranscriptionLine>(() => ({ ...newTranscriptionLine("r"), immunobiologicalCode: imm.immunobiological.code,
    doseCode: imm.dose.code, appliedOn: cityIsoDate(new Date(imm.applied_at)), lotNumber: imm.lot.number ?? "", manufacturerName: imm.lot.manufacturer.name ?? "" }));
  const [ lineProblems, setLineProblems ] = useState<string[]>([]);
  const [ lineRefusals, setLineRefusals ] = useState<VaccinationRefusal[]>([]);

  const result = useRef<CancelResult | null>(null);
  // O SensitiveAction chama onDone depois do await mesmo se a tela já trocou de cidadão: a resposta atrasada é descartada.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const back = useRef<VaccinationRefusal[] | null>(null);
  const withReplacement = replace && canReplace;
  // Volta ao formulário (recusa de campo, desistência ou recusa no step-up): o botão de confirmação some com o SensitiveAction, então o
  // foco vai ao primeiro campo com problema ou, sem nenhum, ao título.
  const heading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [ refocus, setRefocus ] = useState(0);
  useEffect(() => {
    if (refocus === 0) return;
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] select');
    (target ?? heading.current)?.focus();
  }, [ refocus ]);
  function backToForm() {
    setStage("form");
    setRefocus((n) => n + 1);
  }

  function body(): CancelInput {
    const clean = reason.trim();
    if (!withReplacement) return { reason: clean };
    return { reason: clean, replacement: transcribed ? transcriptionBody([ line ], patient.id, false).items[0] : doseBody(dose.draft, patient.id, catalog) };
  }

  function review(e: { preventDefault(): void }) {
    e.preventDefault();
    const at = clock();
    const r = reasonProblem(reason, "o motivo");
    setReasonErr(r);
    const extra: string[] = [];
    let ok = r === null;
    if (withReplacement && transcribed) {
      const found = transcriptionProblems([ line ], { today: cityIsoDate(at), birthDate: patient.birth_date, closeCheck: false, catalog }).map((p) => p.text);
      setLineProblems(found);
      if (lineRefusals.length > 0) extra.push(STALE_REFUSAL);
      ok = ok && found.length === 0;
    } else if (withReplacement) {
      const found: Problem[] = doseCheck(dose, stock, catalog, patient, at);
      dose.setProblems(found.filter((p) => p.path !== ""));
      extra.push(...found.filter((p) => p.path === "").map((p) => p.text));
      ok = ok && found.length === 0;
    }
    setGeneral(extra);
    if (ok && extra.length === 0) setStage("confirm");
  }

  // Recusa de campo (motivo ou substituta): guarda para o formulário; o resto o SensitiveAction mostra.
  async function run() {
    back.current = null;
    try {
      result.current = await cancelImmunization(imm.id, body());
    } catch (err) {
      const list = vaccinationRefusals(err);
      if (err instanceof ApiError && err.status === 422 && list.some((x) => x.path === "reason" || x.path === "replacement" || x.path.startsWith(PREFIX))) {
        back.current = list;
        return;
      }
      throw err;
    }
  }

  function done() {
    if (!alive.current) return;
    const list = back.current;
    if (!list) { if (result.current) onDone(result.current); return; }
    back.current = null;
    backToForm();
    const reasonRefusal = list.find((x) => x.path === "reason");
    setReasonErr(reasonRefusal ? reasonProblem("", "o motivo") : null);
    const mine = list.filter((x) => x.path.startsWith(PREFIX)).map((x) => ({ ...x, path: x.path.slice(PREFIX.length) }));
    setGeneral(list.filter((x) => x.path !== "reason" && !x.path.startsWith(PREFIX)).map((x) => x.text));
    if (transcribed) setLineRefusals(mine);
    else doseRefused(dose, stock, client, room, mine);
  }

  const vaccine = imm.immunobiological.name ?? catalog.immunobiologicals.find((i) => i.code === imm.immunobiological.code)?.name ?? imm.immunobiological.code;
  const doseLabel = `${vaccine} ${imm.dose.name ?? imm.dose.code}`;
  const lineErrors = [ ...lineProblems, ...lineRefusals.map((x) => `${lineName(line, catalog)}: ${x.text}`) ];
  const fieldError = reasonErr !== null || (withReplacement && (transcribed ? lineErrors.length > 0 : dose.fieldProblems.length > 0));

  if (stage === "confirm") {
    return (
      <SensitiveAction
        title="Confirmar o cancelamento"
        description={(
          <>
            <p style={{ margin: 0 }}>{`Cancelar ${doseLabel} de ${fmtDateTime(imm.applied_at)}${withReplacement ? " e registrar a dose correta no lugar" : ""}.`}</p>
            <p style={{ margin: 0 }}>A dose cancelada fica na caderneta com o motivo. Se ela já foi enviada à RNDS, o cancelamento também é enviado.</p>
          </>
        )}
        requiresStepUp
        confirmLabel={withReplacement ? "Cancelar e substituir" : "Cancelar dose"}
        run={run}
        onDone={done}
        onCancel={backToForm}
        onGoToSecurity={onGoToSecurity}
        translateError={(err) => vaccinationError(err)}
      />
    );
  }

  return (
    <section aria-label="Cancelar dose" style={panel}>
      <h3 ref={heading} tabIndex={-1} style={title}>Cancelar dose</h3>
      <p style={muted}>{`${doseLabel} · aplicada em ${fmtDateTime(imm.applied_at)}${transcribed ? " · transcrição" : ""}`}</p>
      <form ref={formRef} aria-label="Cancelar dose" style={form} onSubmit={review} noValidate>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-reason`}>Motivo do cancelamento</label>
          <textarea id={`${uid}-reason`} style={inputStyle} rows={2} maxLength={500} value={reason}
            {...(reasonErr ? { "aria-describedby": `${uid}-reason-err`, "aria-invalid": true } : {})}
            onChange={(e) => { setReason(e.target.value); setReasonErr(null); }} />
          {reasonErr && <p id={`${uid}-reason-err`} style={alert}>{reasonErr}</p>}
        </div>
        {canReplace ? (
          <label style={{ ...row, fontSize: 13 }}>
            <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setGeneral([]); }} />
            Registrar a dose correta agora
          </label>
        ) : (
          <p style={muted}>{`Esta dose é de outra sala (${imm.room?.name ?? "—"}): a substituição só pode ser feita lá. Aqui, cancele e registre a dose correta pela caderneta.`}</p>
        )}
        {withReplacement && (transcribed ? (
          <TranscriptionLineFields legend="Dose correta" line={line} catalog={catalog} today={cityIsoDate(clock())} birthDate={patient.birth_date}
            errors={lineErrors} onChange={(patch) => { setLine((l) => ({ ...l, ...patch })); setLineProblems([]); setLineRefusals([]); }} />
        ) : (
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <legend style={{ fontSize: 12.5, fontWeight: 600 }}>Dose correta</legend>
            <DoseFields room={room} patient={patient} catalog={catalog} draft={dose.draft} onChange={dose.set} problems={dose.fieldProblems}
              warnings={dose.warnings} now={fixedNow} />
            {dose.loose.length > 0 && <ul role="alert" style={{ ...list, color: "var(--down)" }}>{dose.loose.map((x) => <li key={`${x.path}-${x.code}`}>{x.text}</li>)}</ul>}
          </fieldset>
        ))}
        {general.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
        {fieldError && general.length === 0 && <p role="alert" style={alert}>confira os campos destacados</p>}
        <div style={row}>
          <button type="submit" style={buttonStyle}>Revisar</button>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar à caderneta</button>
        </div>
      </form>
    </section>
  );
}
