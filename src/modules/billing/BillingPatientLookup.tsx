// O paciente pelo CPF para o faturamento (Divergência B3): CPF no corpo de um
// POST, nunca na URL; a tela guarda só o id, o nome de exibição e o CPF
// mascarado. Uma busca por vez.
import { useRef, useState } from "react";
import { lookupBillingPatient, type BillingPatient } from "../../lib/api";
import { isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { billingError, patientName } from "../../lib/billing";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, row } from "../exams/styles";

export function BillingPatientLookup({ patient, onFound }: { patient: BillingPatient | null; onFound(p: BillingPatient | null): void }) {
  const [ cpf, setCpf ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const running = useRef(false);

  async function find() {
    if (running.current) return;
    if (!isValidCpf(cpf)) { setError("CPF inválido"); return; }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const found = await lookupBillingPatient(onlyDigits(cpf));
      setCpf("");
      onFound(found);
    } catch (err) {
      setError(billingError(err));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (patient) {
    return (
      <div style={row}>
        <span>{`Paciente: ${patientName(patient)} · CPF ${patient.cpf_masked}`}</span>
        <button type="button" style={secondaryButtonStyle} onClick={() => onFound(null)}>Trocar paciente</button>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          CPF do paciente
          <input value={cpf} inputMode="numeric" autoComplete="off" style={inputStyle} onChange={(e) => { setError(null); setCpf(maskCpf(e.target.value)); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } }} />
        </label>
        <button type="button" style={secondaryButtonStyle} aria-busy={busy || undefined} onClick={() => void find()}>Buscar paciente</button>
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}
