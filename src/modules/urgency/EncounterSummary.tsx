// Resumo do encontro da urgência (módulo 32a, F-32.3; contrato §5, §14 Q18/Q19): senha, pessoa, cor vigente e o histórico das
// classificações na ordem (a vigente por último). É o único lugar, além do detalhe da identificação, onde a descrição do não
// identificado aparece. O estouro vem pronto do api (Q18): a tela nunca recalcula. Sem acesso clínico (Q19) o api não manda
// critério nem justificativa, e o resumo segue sem eles.
import type { CSSProperties } from "react";
import type { UrgencyClassificationView, UrgencyEncounter } from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { URGENCY_COLOR_TONE, colorLabel, maxWaitLabel } from "../../lib/urgency";
import { Tag } from "../../components/Tag";

// Pela posição do api (1ª, 2ª…); empate ou falta, pela hora.
const byPosition = (a: UrgencyClassificationView, b: UrgencyClassificationView) =>
  (a.position ?? 0) - (b.position ?? 0) || a.classified_at.localeCompare(b.classified_at);

function historyLine(c: UrgencyClassificationView): string {
  const parts = [ fmtHourMinute(c.classified_at), colorLabel(c.color), c.by.name ];
  // `criterion` do topo só vem quando a cor final é a sugerida; com outra cor, a sugerida e a justificativa.
  if (c.criterion) parts.push(c.criterion);
  else if (c.suggested && c.suggested.color !== c.color) parts.push(`sugerida: ${colorLabel(c.suggested.color)}`);
  if (c.justification) parts.push(`justificativa: ${c.justification}`);
  return parts.join(" · ");
}

export function EncounterSummary({ encounter }: { encounter: UrgencyEncounter }) {
  const history = [ ...encounter.classifications ].sort(byPosition);
  const current = history[history.length - 1];
  const { patient } = encounter;

  return (
    <div style={box}>
      <p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 13 }}>
        <span className="mono">{encounter.ticket ?? "sem senha"}</span>
        <span>{patient.name}</span>
        {patient.unidentified && <Tag tone="warn">sem identificação</Tag>}
        <span className="mono" style={muted}>{`chegada ${fmtHourMinute(encounter.arrived_at)}`}</span>
      </p>
      {patient.unidentified && patient.description && <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{patient.description}</p>}
      {encounter.color && current ? (
        <p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <Tag tone={URGENCY_COLOR_TONE[encounter.color]}>{colorLabel(encounter.color)}</Tag>
          <span>{`Cor vigente: ${colorLabel(encounter.color)} (${fmtHourMinute(current.classified_at)}, ${current.by.name})`}</span>
          {encounter.overdue && encounter.max_wait_minutes !== null && (
            <span style={{ color: "var(--down)" }}>{`passou do tempo máximo (${maxWaitLabel(encounter.max_wait_minutes)})`}</span>
          )}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>Ainda sem classificação.</p>
      )}
      {history.length > 0 && (
        <ol aria-label="Classificações" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2, fontSize: 12 }}>
          {history.map((c) => <li key={c.id} style={{ color: "var(--ink2)" }}>{historyLine(c)}</li>)}
        </ol>
      )}
    </div>
  );
}

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const muted: CSSProperties = { fontSize: 10.5, color: "var(--ink3)" };
