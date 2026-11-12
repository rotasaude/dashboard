// Ações da equipe sobre a manifestação (módulo 33; contrato §2, Q32). Todo corpo leva `expected_state` = o estado que a tela
// leu; a resposta é o detalhe atualizado, que quem chama põe no cache (`onChanged(next)`).
// Tela velha (409 `manifestation_changed`, 422 `invalid_transition` — `isChanged`): a frase fica em `changedNotice`, o detalhe
// é relido UMA vez (`onChanged(null)`) e nada é reenviado; a recusa segue para o formulário só para ele não a pôr nos campos
// (o `isStale` dos formulários é o mesmo `isChanged`). A resposta de uma chamada mais velha que a última (`seq`) é ignorada.
// Nenhuma frase interpola o que foi digitado.
import { useEffect, useRef, useState } from "react";
import { runOmbudsmanAction, type OmbudsmanActionName, type OmbudsmanManifestation } from "../../lib/api";
import { isChanged, ombudsmanError, ombudsmanRefusals } from "../../lib/ombudsman";
import { useFormProblems, type FormProblemsOptions } from "../psychosocial/useFormProblems";

export type RunAction = (action: OmbudsmanActionName, fields: Record<string, unknown>) => Promise<void>;

// O que todo formulário de ação recebe do `ActionsPanel`.
export type ActionFormProps = { m: OmbudsmanManifestation; run: RunAction; onDone(): void; onClose(): void };

export function useManifestationAction(m: OmbudsmanManifestation, onChanged: (next: OmbudsmanManifestation | null) => void) {
  const [ changedNotice, setChangedNotice ] = useState<string | null>(null);
  const seq = useRef(0);
  // Outra manifestação: o que estava em voo deixa de valer.
  useEffect(() => {
    seq.current += 1;
    setChangedNotice(null);
  }, [ m.id ]);

  const run: RunAction = async (action, fields) => {
    const mine = ++seq.current;
    setChangedNotice(null);
    try {
      const next = await runOmbudsmanAction(m.id, action, { ...fields, expected_state: m.state });
      if (mine === seq.current) onChanged(next);
    } catch (err) {
      if (mine !== seq.current) return;
      if (isChanged(err)) {
        setChangedNotice(ombudsmanError(err));
        onChanged(null);
      }
      throw err;
    }
  };
  return { run, changedNotice };
}

// `useFormProblems` com as recusas da ouvidoria: `fields` troca a frase dos paths genéricos (`text`, `health_unit_id`…) pela
// que nomeia o campo que a pessoa vê; tela velha não vai aos campos (o `ActionsPanel` mostra a frase).
export function useActionForm(fields?: Record<string, string>) {
  const opts: FormProblemsOptions = {
    refusals: (err) => ombudsmanRefusals(err, { fields }).map((r) => ({ ...r, participantIndex: null })),
    isStale: isChanged
  };
  return useFormProblems(opts);
}
