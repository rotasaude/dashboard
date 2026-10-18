// Relatório anual do CEQ (C-E24/C-E25): um PDF por laboratório, programa e
// ano, registro próprio e só de acréscimo. O arquivo fica na memória até a
// confirmação: o envio (só PDF, até 10 MB) e o registro rodam juntos, com
// step-up (C-E39). Nada do PDF vai para console, log ou storage.
import { useRef, useState } from "react";
import { createEqaAnnualReport, errorCode, uploadEqaReport } from "../../lib/api";
import { annualReportProblem, qcError } from "../../lib/qc";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, row } from "../exams/styles";

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function AnnualReportForm({ providerId, year, currentYear, onSaved, onCancel, onStale, onGoToSecurity }: {
  providerId: string; year: string; currentYear: number; onSaved(): void; onCancel(): void; onStale?(): void; onGoToSecurity?(): void;
}) {
  const [ program, setProgram ] = useState("");
  const [ other, setOther ] = useState("");
  const [ file, setFile ] = useState<File | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  // Se o envio deu certo e o registro falhou, uma nova tentativa na mesma confirmação reaproveita o envio.
  const uploaded = useRef<string | null>(null);
  const name = program === "outro" ? other.trim() : program;

  function pick(f: File | undefined) {
    uploaded.current = null;
    if (!f) { setFile(null); return; }
    if (f.type !== "application/pdf") { setFile(null); setError("o relatório anual precisa ser um PDF"); return; }
    if (f.size > MAX_PDF_BYTES) { setFile(null); setError("o relatório anual pode ter no máximo 10 MB"); return; }
    setError(null);
    setFile(f);
  }

  function review() {
    const problem = annualReportProblem(name, year, currentYear) ?? (file ? null : "escolha o arquivo PDF do relatório");
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  return (
    <section aria-label="Novo relatório anual do CEQ" style={box}>
      <fieldset disabled={confirming} style={{ ...form, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={row}>
          <label style={fieldLabel}>Programa do relatório
            <select value={program} style={inputStyle} onChange={(e) => setProgram(e.target.value)}>
              <option value="">—</option>
              <option value="PNCQ">PNCQ</option>
              <option value="Controllab">Controllab</option>
              <option value="outro">outro</option>
            </select>
          </label>
          {program === "outro" && (
            <label style={fieldLabel}>Nome do programa do relatório<input value={other} style={inputStyle} onChange={(e) => setOther(e.target.value)} /></label>
          )}
          <p style={{ margin: 0 }}>{`Ano do relatório: ${year}`}</p>
        </div>
        <label style={fieldLabel}>Relatório anual (PDF)
          <input type="file" accept="application/pdf" style={inputStyle} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </fieldset>
      {error && <p role="alert" style={alert}>{error}</p>}
      {!confirming && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={review}>Revisar e registrar relatório</button>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      )}
      {confirming && file && (
        <SensitiveAction title="Registrar relatório" requiresStepUp confirmLabel="Registrar relatório"
          description={`O PDF vira o relatório anual de ${name} em ${year}. Cada programa tem um por ano e ele não pode ser trocado depois.`}
          run={async () => {
            uploaded.current ??= await uploadEqaReport(file);
            await createEqaAnnualReport({ provider_id: providerId, program: name, year: Number(year), upload_id: uploaded.current });
          }}
          onDone={onSaved} onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity}
          translateError={(err) => {
            const code = errorCode(err);
            if (code === "already_recorded" || code === "not_found" || code === "conflict") onStale?.();
            // O registro foi recusado: o envio já consumido não vale para outra tentativa.
            if (code === "invalid_file") uploaded.current = null;
            return qcError(err);
          }} />
      )}
    </section>
  );
}
