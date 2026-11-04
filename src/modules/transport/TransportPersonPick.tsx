// Quem é o passageiro sem atendimento marcado (módulo 30, F-30.2; D1): o PersonStart do 24a com as rotas do transporte. A busca é por
// CPF no corpo (POST; o api materializa o paciente de um par validado) ou por nome, nascimento e mãe; nada em URL, storage ou log.
// A central não cria paciente: "pessoa nova" vira a frase para cadastrar no balcão.
import { useState } from "react";
import { findTransportDuplicates, lookupTransportPerson } from "../../lib/api";
import { transportError } from "../../lib/transport";
import { alert, form } from "../exams/styles";
import { PersonStart, type PersonChoice, type PersonSource } from "../territory/PersonStart";

export const transportPersonSource: PersonSource = {
  lookup: (cpf) => lookupTransportPerson(cpf),
  duplicates: (q) => findTransportDuplicates(q),
  describe: transportError,
  pickLabel: (name) => name
};

export const NO_REGISTRATION_TEXT = "esta pessoa não tem cadastro — cadastre no balcão de atendimento antes de pôr na viagem";

export function TransportPersonPick({ onPick, onCancel }: { onPick(patientId: string, name: string | null): void; onCancel?(): void }) {
  const [ round, setRound ] = useState(0);
  const [ problem, setProblem ] = useState<string | null>(null);

  function choose(choice: PersonChoice) {
    if (choice.kind === "patient") { setProblem(null); onPick(choice.patientId, choice.displayName ?? null); return; }
    // `citizen` não chega (o api materializa o paciente do par validado), mas não some calado.
    setProblem(choice.kind === "new" ? NO_REGISTRATION_TEXT : "não foi possível escolher esta pessoa — busque de novo");
  }

  return (
    <div style={form}>
      <PersonStart key={round} source={transportPersonSource} onChoose={choose}
        onCancel={() => { setProblem(null); setRound((r) => r + 1); onCancel?.(); }} />
      {problem && <p role="alert" style={alert}>{problem}</p>}
    </div>
  );
}
