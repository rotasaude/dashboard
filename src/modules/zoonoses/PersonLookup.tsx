// src/modules/zoonoses/PersonLookup.tsx
// Busca de pessoa por CPF (11 dígitos) ou CNS (15) para o tutor e o domicílio (módulo 35b, Q25). O documento só vai no corpo do
// POST (chamada direta, sem useQuery, sem chave de cache) e nunca sai do campo; o achado mostra só `display_name` e o endereço
// curto do domicílio do cadastro individual ativo. O nome digitado nunca vale como tutor (§2).
import { useState } from "react";
import { lookupZooPerson, type ZooPerson } from "../../lib/api";
import { isValidCpf } from "../../lib/attendance";
import { zoonosesError } from "../../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../../lib/zoonosesErrors";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle } from "../../components/formStyles";
import { box, fieldLabel, muted, row, alert } from "../exams/styles";

export const PERSON_NOT_FOUND = "ninguém com este documento no cadastro";
export const NO_HOUSEHOLD = "esta pessoa não tem domicílio no cadastro individual";
const DOC_HINT = "informe o CPF (11 dígitos) ou o CNS (15 dígitos)";

export function PersonLookup({ value, onChange, label }: { value: ZooPerson | null; onChange(p: ZooPerson | null): void; label: string }) {
  const [ doc, setDoc ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function search() {
    const digits = doc.replace(/\D/g, "");
    setProblem(null);
    if (digits.length === 11 && !isValidCpf(digits)) { setProblem(ZOONOSES_ERRORS.invalid_cpf); return; }
    if (digits.length !== 11 && digits.length !== 15) { setProblem(DOC_HINT); return; }
    setBusy(true);
    try {
      const found = await lookupZooPerson(digits.length === 11 ? { cpf: digits } : { cns: digits });
      if (found) { setDoc(""); onChange(found); } else setProblem(PERSON_NOT_FOUND);
    } catch (err) {
      setProblem(zoonosesError(err));
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div style={box} aria-label={label}>
        <strong>{label}</strong>
        <span>{value.patient.display_name ?? "sem nome"}</span>
        <span style={muted}>{value.household ? value.household.address_short : NO_HOUSEHOLD}</span>
        <div style={row}><ActionButton variant="secondary" onClick={() => { setProblem(null); onChange(null); }}>Trocar</ActionButton></div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={fieldLabel}>
        {label} — CPF ou CNS
        <input value={doc} inputMode="numeric" autoComplete="off" style={inputStyle}
          onChange={(e) => { setDoc(e.target.value); setProblem(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!busy) void search(); } }} />
      </label>
      <div style={row}><ActionButton variant="secondary" busy={busy} onClick={search}>Buscar pessoa</ActionButton></div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
    </div>
  );
}
