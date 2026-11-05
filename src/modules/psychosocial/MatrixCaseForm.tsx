// Caso compartilhado do matriciamento (F-31.7; §7, P12, P25, P44): a pessoa pela busca do CAPS (`PsyPersonPick`: CPF, nome ou CNS,
// tudo por POST) e o texto que a UBS da equipe lê no vínculo (10 a 2000 caracteres). A pessoa não precisa ter matrícula. O texto é
// o único dado clínico daqui e nunca vai para URL, mensagem de erro nem console. Matriciamento cancelado devolve 409
// `already_cancelled` (P44): `onCancelled` fecha o formulário, e quem usa relê o detalhe; `not_found` vai a `onStale`. A busca da pessoa fica fora do `<form>` (a
// busca é um formulário também). Sem duplo envio (`useFormProblems`).
import { useEffect, useRef, useState } from "react";
import { addPsyMatrixCase, errorCode, type PsyMatrixCase, type PsyMatrixSupport } from "../../lib/api";
import {
  CASE_NOT_ENROLLED_NOTE, MATRIX_NO_CLINICAL_NOTE, MAX_SHARED_TEXT, caseInput, caseProblems
} from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, form, muted, row } from "../exams/styles";
import { PsyPersonPick } from "./PsyPersonPick";
import { useFormProblems } from "./useFormProblems";

type Person = { patientId: string; name: string };
type Result = { kind: "saved"; matrixCase: PsyMatrixCase } | { kind: "cancelled" };

const heading = { margin: 0, fontSize: 13, fontWeight: 600 } as const;

export type MatrixCaseFormProps = {
  support: Pick<PsyMatrixSupport, "id">; onSaved(c: PsyMatrixCase): void; onCancelled(): void; onStale(text: string): void; onCancel(): void;
};

export function MatrixCaseForm({ support, onSaved, onCancelled, onStale, onCancel }: MatrixCaseFormProps) {
  const [ person, setPerson ] = useState<Person | null>(null);
  // O texto sobrevive à troca da pessoa.
  const [ text, setText ] = useState("");
  const pickTitle = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (!person) pickTitle.current?.focus(); }, [ person ]);
  if (!person) {
    return (
      <div style={form}>
        <p ref={pickTitle} tabIndex={-1} style={heading}>Adicionar caso</p>
        <p style={muted}>{CASE_NOT_ENROLLED_NOTE}</p>
        <PsyPersonPick onPick={(patientId, name) => setPerson({ patientId, name })} onCancel={onCancel} />
      </div>
    );
  }
  return (
    <CaseText supportId={support.id} person={person} text={text} setText={setText} onChangePerson={() => setPerson(null)} onSaved={onSaved}
      onCancelled={onCancelled} onStale={onStale} onCancel={onCancel} />
  );
}

function CaseText({ supportId, person, text, setText, onChangePerson, onSaved, onCancelled, onStale, onCancel }: {
  supportId: string; person: Person; text: string; setText(v: string): void; onChangePerson(): void; onSaved(c: PsyMatrixCase): void;
  onCancelled(): void; onStale(text: string): void; onCancel(): void;
}) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  return (
    <form ref={f.formRef} aria-label="Adicionar caso" style={form} noValidate onSubmit={(ev) => {
      void f.submit<Result>(ev, {
        check: () => caseProblems({ patientId: person.patientId, text }),
        call: async () => {
          try {
            return { kind: "saved", matrixCase: await addPsyMatrixCase(supportId, caseInput(person.patientId, text)) };
          } catch (err) {
            if (errorCode(err) === "already_cancelled") return { kind: "cancelled" };
            throw err;
          }
        },
        ok: (r) => (r.kind === "saved" ? onSaved(r.matrixCase) : onCancelled()),
        stale: onStale
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={heading}>Adicionar caso</p>
      <p style={muted}>{CASE_NOT_ENROLLED_NOTE}</p>
      {f.top((path) => path === "shared_text")}
      <div style={row}>
        <span style={{ fontSize: 13 }}>{person.name}</span>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onChangePerson}>Trocar a pessoa</button>
      </div>
      <label style={fieldLabel}>
        Texto compartilhado com a equipe
        <textarea value={text} rows={4} style={inputStyle} {...aria("shared_text")}
          onChange={(ev) => { f.clear("shared_text"); setText(ev.target.value); }} />
      </label>
      <p style={muted}>{`${text.trim().length} de ${MAX_SHARED_TEXT} caracteres`}</p>
      <p style={muted}>{MATRIX_NO_CLINICAL_NOTE}</p>
      {errNode("shared_text")}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Salvar caso</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
