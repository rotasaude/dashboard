// src/modules/attendance/CadsusCheck.tsx
// Consulta ao CADSUS na validação presencial (módulo 16; ADR 0028; spec §7;
// contratos §5.4). Só aparece com `cadsus_lookup` ligado. Mostra o CNS
// mascarado e se nascimento e sexo conferem com o que o cidadão declarou;
// nunca nome, mãe ou endereço. Quem decide é o atendente: a caixa começa
// desmarcada, toda consulta nova a desmarca, e CADSUS fora do ar nunca trava
// o balcão (segue pelo documento).
import { useState } from "react";
import { cadsusLookup, type CadsusLookupResult } from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { KeyValue } from "../../components/KeyValue";
import { disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";

export function matchLabel(value: boolean | null): string {
  if (value === true) return "confere";
  if (value === false) return "diverge do que o cidadão declarou";
  return "sem dado para comparar";
}

export function CadsusCheck({ cpf, code, confirmed, onConfirmedChange }: {
  cpf: string; code: string; confirmed: boolean; onConfirmedChange(next: boolean): void;
}) {
  const [ result, setResult ] = useState<CadsusLookupResult | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  async function consult() {
    if (busy) return;
    setBusy(true); setError(null); setResult(null);
    onConfirmedChange(false);
    try {
      setResult(await cadsusLookup(cpf, code));
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  const diverges = !!result?.found && (result.birth_date_matches === false || result.sex_matches === false);

  return (
    <section aria-label="Consulta ao CADSUS" style={box}>
      <div>
        <button type="button" disabled={busy} onClick={() => void consult()} style={busy ? disabledButtonStyle : secondaryButtonStyle}>
          Consultar CADSUS
        </button>
      </div>
      {error && <p role="alert" style={alertStyle}>{error}</p>}
      {result && !result.found && <p style={text}>Não encontrado no CADSUS. Siga pela conferência do documento.</p>}
      {result?.found && (
        <>
          <KeyValue k="CNS (CADSUS)" v={result.cns_masked ?? "—"} />
          <p style={text}>Data de nascimento: {matchLabel(result.birth_date_matches)}</p>
          <p style={text}>Sexo: {matchLabel(result.sex_matches)}</p>
          {diverges && (
            <p role="status" style={warnStyle}>Há divergência com o que o cidadão declarou. Confira no documento antes de decidir.</p>
          )}
          {result.cns_masked && (
          <label style={checkLabel}>
            <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
            Gravar o CNS do CADSUS no cadastro
          </label>
          )}
        </>
      )}
    </section>
  );
}

const box = { display: "flex", flexDirection: "column" as const, gap: 8, maxWidth: 420, border: "1px solid var(--rule)",
  borderRadius: 8, padding: "8px 12px" };
const text = { margin: 0, fontSize: 12.5, color: "var(--ink2)" };
const alertStyle = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const warnStyle = { margin: 0, fontSize: 12.5, color: "var(--warn)", fontWeight: 600 };
const checkLabel = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink2)" };
