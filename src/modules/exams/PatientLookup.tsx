// src/modules/exams/PatientLookup.tsx
// O paciente pelo CPF (Divergência D2): CPF no corpo de um POST, nunca na
// URL; a tela guarda só o id, o nome de exibição e o CPF mascarado.
import { useState } from "react";
import { lookupExamPatient, type ExamPatient } from "../../lib/api";
import { isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { examError } from "../../lib/exams";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, row } from "./styles";

export function PatientLookup({ patient, onFound }: { patient: ExamPatient | null; onFound(p: ExamPatient | null): void }) {
  const [ cpf, setCpf ] = useState("");
  const [ error, setError ] = useState<string | null>(null);

  async function find() {
    if (!isValidCpf(cpf)) { setError("CPF inválido"); return; }
    setError(null);
    try {
      onFound(await lookupExamPatient(onlyDigits(cpf)));
      setCpf("");
    } catch (err) {
      setError(examError(err));
    }
  }

  if (patient) {
    return (
      <div style={row}>
        <span>{`Paciente: ${patient.display_name} · CPF ${patient.cpf_masked}`}</span>
        <button type="button" style={secondaryButtonStyle} onClick={() => onFound(null)}>Trocar paciente</button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          CPF do paciente
          <input value={cpf} inputMode="numeric" autoComplete="off" style={inputStyle} onChange={(e) => setCpf(maskCpf(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } }} />
        </label>
        <ActionButton variant="secondary" onClick={find}>Buscar paciente</ActionButton>
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}
