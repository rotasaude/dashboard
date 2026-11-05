// Quem é a pessoa da demanda espontânea (F-31.2; P30, R16): o PersonStart do 24a com as rotas do CAPS (CPF, ou nome, nascimento e
// mãe nos duplicados) e um modo próprio pelo CNS (15 dígitos), para o usuário sem CPF — em situação de rua, por exemplo. Toda busca é
// POST com o identificador no corpo (`/psychosocial/person_lookup`, `/psychosocial/patients/duplicates`); nada em URL, storage ou log.
// O CAPS não cria paciente: "pessoa nova" vira a frase para cadastrar no balcão.
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { findPsyDuplicates, lookupPsyPerson, lookupPsyPersonByCns, type PharmacyPerson } from "../../lib/api";
import { isValidCns } from "../../lib/professionals";
import { NO_REGISTRATION_TEXT, PERSON_PICK_FAILED, PSY_ERRORS, psyError } from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, row } from "../exams/styles";
import { PersonStart, type PersonChoice, type PersonSource } from "../territory/PersonStart";

export const psyPersonSource: PersonSource = {
  lookup: (cpf) => lookupPsyPerson(cpf),
  duplicates: (q) => findPsyDuplicates(q),
  describe: psyError,
  pickLabel: (name) => `Escolher ${name}`
};

type Mode = "cpf" | "cns";

export function PsyPersonPick({ onPick, onCancel }: { onPick(patientId: string, name: string): void; onCancel?(): void }) {
  const [ mode, setMode ] = useState<Mode>("cpf");
  const [ round, setRound ] = useState(0);
  const [ problem, setProblem ] = useState<string | null>(null);
  const change = (m: Mode) => { setProblem(null); setMode(m); };

  function choose(choice: PersonChoice) {
    if (choice.kind === "patient") { setProblem(null); onPick(choice.patientId, choice.displayName ?? "paciente"); return; }
    // `citizen` não chega (o api materializa o paciente do par validado), mas não some calado.
    setProblem(choice.kind === "new" ? NO_REGISTRATION_TEXT : PERSON_PICK_FAILED);
  }
  const cancel = () => { setProblem(null); setRound((r) => r + 1); onCancel?.(); };

  return (
    <div style={form}>
      <fieldset style={fieldset}>
        <legend style={legend}>Buscar a pessoa</legend>
        <div style={row}>
          <label style={checkLabel}>
            <input type="radio" name="psy-person-mode" checked={mode === "cpf"} onChange={() => change("cpf")} />Pelo CPF ou pelo nome
          </label>
          <label style={checkLabel}>
            <input type="radio" name="psy-person-mode" checked={mode === "cns"} onChange={() => change("cns")} />Pelo CNS
          </label>
        </div>
      </fieldset>
      {mode === "cpf"
        ? <PersonStart key={round} source={psyPersonSource} onChoose={choose} onCancel={cancel} />
        : <ByCns onPick={onPick} onCancel={cancel} />}
      {problem && <p role="alert" style={alert}>{problem}</p>}
    </div>
  );
}

function ByCns({ onPick, onCancel }: { onPick(patientId: string, name: string): void; onCancel(): void }) {
  const [ cns, setCns ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  // A resposta vale para o CNS buscado; trocar o número a apaga.
  const [ found, setFound ] = useState<PharmacyPerson | null>(null);
  const lookup = useMutation({
    gcTime: 0,
    mutationFn: (digits: string) => lookupPsyPersonByCns(digits),
    onSuccess: (person) => setFound(person),
    onError: (err) => setProblem(psyError(err))
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (lookup.isPending) return;
    setFound(null);
    const digits = cns.replace(/\D/g, "");
    if (!isValidCns(digits)) { setProblem(PSY_ERRORS.invalid_cns); return; }
    setProblem(null);
    lookup.mutate(digits);
  }

  const name = found?.display_name ?? "paciente";
  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Buscar pelo CNS">
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          CNS
          <input value={cns} style={inputStyle} autoComplete="off" inputMode="numeric"
            onChange={(e) => { setCns(e.target.value); setFound(null); setProblem(null); }} />
        </label>
        <button type="submit" style={lookup.isPending ? disabledButtonStyle : buttonStyle} disabled={lookup.isPending}>Buscar pelo CNS</button>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {found?.patient_id && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => onPick(found.patient_id as string, name)}>{`Escolher ${name}`}</button>
        </div>
      )}
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
