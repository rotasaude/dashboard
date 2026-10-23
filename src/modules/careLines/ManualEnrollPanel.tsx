// src/modules/careLines/ManualEnrollPanel.tsx
// Inscrição manual (contrato §4, P1; Divergências D6 e D9): o médico ou o
// enfermeiro acha a pessoa pelo CPF (no corpo de um POST, nunca na URL),
// escolhe a linha e a equipe de referência e confirma. Só cadastro validado:
// o par só declarado volta 409 citizen_not_verified (frase na tela). Quem nunca
// consultou vira paciente no api (Patients::Resolve): sem patient_id, vai o
// citizen_id. A linha da gestante pede a DUM. A tela guarda só ids, o nome de
// exibição e o CPF mascarado; o CPF digitado sai do campo assim que a busca
// responde (e some com o painel). Sem query: nada de CPF em queryKey.
import { useState } from "react";
import { enrollCare, errorCode, lookupCarePerson, type CareLineRef, type CarePersonLookup, type CareTeam } from "../../lib/api";
import { isValidCpf, onlyDigits } from "../../lib/attendance";
import { anchorProblem, personName } from "../../lib/careLines";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row } from "../exams/styles";
import { useCareSubmit } from "./useCareSubmit";

export function ManualEnrollPanel({ teamId, teams, lines, today, onEnrolled, onCancel }: {
  teamId: string; teams: CareTeam[]; lines: CareLineRef[]; today: string; onEnrolled(message: string): void; onCancel(): void;
}) {
  const [ cpf, setCpf ] = useState("");
  const [ person, setPerson ] = useState<CarePersonLookup | null>(null);
  const [ lineId, setLineId ] = useState("");
  const [ team, setTeam ] = useState(teamId);
  const [ lmp, setLmp ] = useState("");
  const [ forcedAnchor, setForcedAnchor ] = useState(false);
  const { busy, error, setError, submit } = useCareSubmit();
  const line = lines.find((l) => l.id === lineId) ?? null;
  const needAnchor = forcedAnchor || line?.requires_anchor === "lmp";

  async function find() {
    if (!isValidCpf(cpf)) { setError("CPF inválido"); return; }
    const digits = onlyDigits(cpf);
    setPerson(null);
    // Recusa de "stale" (not_found) cai na mesma frase do campo.
    await submit(async () => {
      const found = await lookupCarePerson(digits);
      setCpf("");
      setPerson(found);
    }, setError);
  }

  async function enroll() {
    if (!person) return;
    if (!line) { setError("escolha a linha"); return; }
    if (needAnchor) {
      const problem = anchorProblem(lmp, today);
      if (problem) { setError(problem); return; }
    }
    const who = person.patient_id ? { patient_id: person.patient_id } : { citizen_id: person.citizen_id };
    const message = `Inscrição de ${personName(person)} em ${line.name} confirmada.`;
    const ok = await submit(async () => {
      try {
        await enrollCare({ ...who, care_line_id: line.id, team_id: team, ...(needAnchor ? { anchor_date: lmp } : {}) });
      } catch (err) {
        if (errorCode(err) === "anchor_required") setForcedAnchor(true);
        throw err;
      }
    }, setError);
    if (ok) { setCpf(""); setPerson(null); onEnrolled(message); }
  }

  return (
    <section aria-label="Inscrever pessoa" style={box}>
      <div style={form}>
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>
            CPF da pessoa
            <input value={cpf} inputMode="numeric" autoComplete="off" style={inputStyle} onChange={(e) => { setError(null); setCpf(e.target.value); }} />
          </label>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void find()}>Buscar</button>
        </div>
        {person && (
          <>
            <div style={row}>
              <span>{`${personName(person)} · CPF ${person.cpf_masked}`}</span>
            </div>
            <div style={row}>
              <label style={fieldLabel}>
                Linha
                <select value={lineId} style={inputStyle} onChange={(e) => { setError(null); setForcedAnchor(false); setLineId(e.target.value); }}>
                  <option value="">escolha</option>
                  {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Equipe de referência
                <select value={team} style={inputStyle} onChange={(e) => { setError(null); setTeam(e.target.value); }}>
                  {teams.map((t) => <option key={t.id} value={t.id}>{`${t.name} · INE ${t.ine}`}</option>)}
                </select>
              </label>
              {needAnchor && (
                <label style={fieldLabel}>
                  DUM (data da última menstruação)
                  <input type="date" value={lmp} style={inputStyle} onChange={(e) => { setError(null); setLmp(e.target.value); }} />
                </label>
              )}
            </div>
            <div><button type="button" style={buttonStyle} disabled={busy} onClick={() => void enroll()}>Inscrever</button></div>
          </>
        )}
        {error && <p role="alert" style={alert}>{error}</p>}
        <p style={muted}>Só cadastro validado no posto se inscreve; nada é inscrito sem a sua confirmação.</p>
        <div><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Fechar</button></div>
      </div>
    </section>
  );
}
