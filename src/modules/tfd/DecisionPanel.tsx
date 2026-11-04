// Decisão da comissão de TFD (módulo 30, F-30.5): autorizar, devolver para complementar ou recusar, sempre com motivo (10–500) e
// segundo fator (o api pede step-up). Autorizar sem atendimento futuro no destino é recusado antes de abrir a confirmação: a frase
// aparece e o foco vai a "Marcar atendimento" (Review Focus 4). Com a janela do segundo fator fechada, o SensitiveAction pede o
// código e repete a decisão uma vez. As recusas do api (todas as regras do envio, `appointment_required`, `billing_unit_missing`)
// aparecem todas de uma vez.
import { useState } from "react";
import { decideTfdCase, type TfdCase, type TfdDecision } from "../../lib/api";
import { decisionLabel, decisionProblems } from "../../lib/tfd";
import { SensitiveAction } from "../../components/SensitiveAction";
import { dangerButtonStyle, secondaryButtonStyle, buttonStyle } from "../../components/formStyles";
import { alert, row } from "../exams/styles";
import { LocalRefusal, useTfdRefusalText } from "./stepUpText";

const DECISIONS: TfdDecision[] = [ "authorize", "return", "deny" ];
const DESCRIPTION: Record<TfdDecision, string> = {
  authorize: "O processo fica autorizado e a central pode pôr o paciente numa viagem.",
  return: "O médico recebe o pedido de volta para complementar.",
  deny: "O processo é encerrado como recusado; o paciente vê a situação no celular."
};
const STYLE: Record<TfdDecision, typeof buttonStyle> = { authorize: buttonStyle, return: secondaryButtonStyle, deny: dangerButtonStyle };

export function DecisionPanel({ tfdCase, now = new Date(), onDecided, onNeedAppointment, onGoToSecurity }: {
  tfdCase: TfdCase; now?: Date; onDecided(c: TfdCase): void; onNeedAppointment(): void; onGoToSecurity?(): void;
}) {
  const refusalText = useTfdRefusalText();
  const [ choice, setChoice ] = useState<TfdDecision | null>(null);
  const [ blocked, setBlocked ] = useState<string | null>(null);

  function pick(d: TfdDecision) {
    // Aqui só a regra do atendimento; o motivo é conferido na confirmação.
    const problem = decisionProblems(d, "", tfdCase, now).find((p) => p.path === "appointment_at");
    if (problem) { setBlocked(problem.text); setChoice(null); onNeedAppointment(); return; }
    setBlocked(null);
    setChoice(d);
  }

  if (choice) {
    return (
      <SensitiveAction title={decisionLabel(choice)} description={DESCRIPTION[choice]} requiresStepUp onGoToSecurity={onGoToSecurity}
        fields={[ { name: "reason", label: "Motivo", required: true, multiline: true } ]}
        translateError={refusalText}
        run={async (values) => {
          const reason = (values.reason ?? "").trim();
          const local = decisionProblems(choice, reason, tfdCase, now);
          if (local.length > 0) throw new LocalRefusal(local.map((p) => p.text).join("; "));
          onDecided(await decideTfdCase(tfdCase.id, { decision: choice, reason }));
        }}
        onDone={() => setChoice(null)} onCancel={() => setChoice(null)} />
    );
  }

  return (
    <div role="group" aria-label="Decisão da comissão" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {blocked && <p role="alert" style={alert}>{blocked}</p>}
      <div style={row}>
        {DECISIONS.map((d) => <button key={d} type="button" style={STYLE[d]} onClick={() => pick(d)}>{decisionLabel(d)}</button>)}
      </div>
    </div>
  );
}
