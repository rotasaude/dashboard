// src/modules/homeVisits/QuickPatientForm.tsx
// Registro rápido da pessoa da visita ou do participante (módulo 24b, decisão 7A): o mínimo que o api aceita em `new_patient`.
// Nome, nascimento, sexo, mãe (opcional), CPF OU motivo de não ter CPF, CNS (opcional). A tela só devolve o que ela
// mesma conferiu (`quickPatientProblems`); nada é gravado aqui — o paciente nasce na gravação da visita ou da atividade.
// Os dados vivem só neste estado; nada em URL, storage ou log. `refusal`: a recusa do api (`new_patient.<campo>`) marca o campo.
import { useRef, useState, type FormEvent } from "react";
import type { QuickPatient } from "../../lib/api";
import { isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { quickPatientProblems } from "../../lib/homeVisits";
import { DOMAINS } from "../../lib/territoryDictionaries.generated";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "../exams/styles";

export interface QuickRefusal { path: string; text: string }
// Com `sex` e `no_cpf_reason`, a pessoa digitada volta inteira quando o api recusa um campo dela (Q49/Q71).
export type QuickInitial = Partial<Pick<QuickPatient, "full_name" | "birth_date" | "sex" | "mother_name" | "cpf" | "no_cpf_reason" | "cns">>;

const PREFIX = "new_patient.";

export function QuickPatientForm({ initial, today, refusal, onDone, onCancel }: {
  initial: QuickInitial; today: string; refusal?: QuickRefusal | null; onDone(p: QuickPatient): void; onCancel(): void;
}) {
  const [ fullName, setFullName ] = useState(initial.full_name ?? "");
  const [ birth, setBirth ] = useState(initial.birth_date ?? "");
  const [ sex, setSex ] = useState<string>(initial.sex ?? "");
  const [ mother, setMother ] = useState(initial.mother_name ?? "");
  const [ cpf, setCpf ] = useState(initial.cpf ? maskCpf(initial.cpf) : "");
  const [ reason, setReason ] = useState(initial.no_cpf_reason ?? "");
  const [ cns, setCns ] = useState(initial.cns ?? "");
  const [ shown, setShown ] = useState<QuickRefusal | null>(refusal ?? null);
  // A recusa nova do api (o pai troca `refusal`) substitui a mostrada.
  const lastRefusal = useRef(refusal);
  if (lastRefusal.current !== refusal) { lastRefusal.current = refusal; setShown(refusal ?? null); }

  const invalid = (key: string) => (shown?.path === `${PREFIX}${key}` ? true : undefined);
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setShown(null); };

  function submit(e: FormEvent) {
    e.preventDefault();
    const digits = onlyDigits(cpf);
    const p: QuickPatient = { full_name: fullName.trim(), birth_date: birth, sex: sex as QuickPatient["sex"] };
    if (mother.trim()) p.mother_name = mother.trim();
    if (digits) p.cpf = digits; else if (reason) p.no_cpf_reason = reason;
    const cnsDigits = cns.replace(/ /g, "");
    if (cnsDigits) p.cns = cnsDigits;
    const found = quickPatientProblems(p, today)[0] ?? (p.cpf && !isValidCpf(p.cpf) ? { path: `${PREFIX}cpf`, text: "CPF inválido: confira os 11 dígitos" } : null);
    if (found) { setShown(found); return; }
    onDone(p);
  }

  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Registro rápido da pessoa">
      <label style={fieldLabel}>
        Nome completo
        <input value={fullName} style={inputStyle} autoComplete="off" aria-invalid={invalid("full_name")} onChange={edit(setFullName)} />
      </label>
      <div style={row}>
        <label style={fieldLabel}>
          Data de nascimento
          <input type="date" value={birth} style={inputStyle} aria-invalid={invalid("birth_date")} onChange={edit(setBirth)} />
        </label>
        <label style={fieldLabel}>
          Sexo
          <select value={sex} style={inputStyle} aria-invalid={invalid("sex")} onChange={edit(setSex)}>
            <option value="">— escolha —</option>
            <option value="female">Feminino</option>
            <option value="male">Masculino</option>
          </select>
        </label>
      </div>
      <label style={fieldLabel}>
        Nome da mãe (opcional)
        <input value={mother} style={inputStyle} autoComplete="off" aria-invalid={invalid("mother_name")} onChange={edit(setMother)} />
      </label>
      <div style={row}>
        <label style={fieldLabel}>
          CPF
          <input value={cpf} style={inputStyle} autoComplete="off" inputMode="numeric" aria-invalid={invalid("cpf")}
            onChange={(e) => { setCpf(maskCpf(e.target.value)); setShown(null); }} />
        </label>
        <label style={fieldLabel}>
          Motivo de não ter CPF
          <select value={reason} style={inputStyle} aria-invalid={invalid("no_cpf_reason")} onChange={edit(setReason)}>
            <option value="">— escolha —</option>
            {DOMAINS.justificativa_nao_possui_cpf.map((o) => <option key={o.code} value={String(o.code)}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <label style={fieldLabel}>
        CNS (opcional)
        <input value={cns} style={inputStyle} autoComplete="off" inputMode="numeric" aria-invalid={invalid("cns")} onChange={edit(setCns)} />
      </label>
      {shown && <p role="alert" style={alert}>{shown.text}</p>}
      <div style={row}>
        <button type="submit" style={buttonStyle}>Usar esta pessoa</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
