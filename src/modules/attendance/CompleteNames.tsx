// Completar os nomes de um par já validado (módulo 19; contratos §2 e
// Divergência D2), no check-in. Sem o nome completo, a consulta não finaliza.
import { useState, type CSSProperties } from "react";
import { completeCitizenNames } from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { EMPTY_NAMES, namesBody, namesProblem, type NamesDraft } from "../../lib/citizenNames";
import { buttonStyle, disabledButtonStyle } from "../../components/formStyles";
import { NamesFields } from "./NamesFields";

export function CompleteNames({ verificationId }: { verificationId: string }) {
  const [ names, setNames ] = useState<NamesDraft>(EMPTY_NAMES);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ done, setDone ] = useState(false);
  const problem = namesProblem(names);

  async function save() {
    if (busy || problem) return;
    setBusy(true); setError(null);
    try {
      await completeCitizenNames(verificationId, namesBody(names));
      setDone(true);
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Nomes registrados no cadastro</p>;

  return (
    <section aria-label="Completar nomes do cadastro" style={box}>
      <strong>Completar nomes do cadastro</strong>
      <p style={{ margin: 0, fontSize: 12, color: "var(--ink3)" }}>
        Cadastro validado sem o nome completo: confira no documento. Sem ele, a consulta não pode ser finalizada.
      </p>
      <NamesFields value={names} onChange={setNames} problem={problem} />
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <div>
        <button type="button" disabled={busy || problem !== null} style={busy || problem !== null ? disabledButtonStyle : buttonStyle}
          onClick={() => void save()}>
          Salvar nomes
        </button>
      </div>
    </section>
  );
}

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
