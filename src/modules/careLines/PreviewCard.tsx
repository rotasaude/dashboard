// src/modules/careLines/PreviewCard.tsx
// Um indicador da prévia (contrato §6, P17): pontuação estimada sobre a população
// elegível da equipe, as boas práticas com peso e quantos atingiram, as que ficam
// fora da conta (não acompanhadas pelo sistema, ou sem ninguém elegível ou dentro
// do prazo) e as famílias de fonte sem dado. Sem pontuação, "sem dados" — nunca 0.
// NÃO soma os pesos: cada um vem arredondado sozinho e a soma sairia 99,9 ou 100,2.
// Nunca "valor oficial": o aviso de estimativa é da tela (CareLinesPreview).
import type { CarePreview, CarePreviewPractice } from "../../lib/api";
import { careLineError, conceptLabel, decimalBr, excludedLabel, indicatorLabel } from "../../lib/careLines";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { KeyValue } from "../../components/KeyValue";
import { EmptyState } from "../../components/EmptyState";
import { alert, grid, muted, stack } from "../exams/styles";

const NO_DATA = "sem dados";
const OUT_UNTRACKED = "fora da conta — peso redistribuído";
const OUT_NO_ELIGIBLE = "ninguém elegível ou dentro do prazo";

// Por que a prática fica fora da conta. `excluded_practices` manda; sem ele, deduz.
function outReason(data: CarePreview, p: CarePreviewPractice): "untracked" | "no_eligible" | null {
  const given = data.excluded_practices.find((e) => e.key === p.key)?.reason;
  if (given === "untracked" || given === "no_eligible") return given;
  if (!p.tracked) return "untracked";
  return p.denominator === 0 ? "no_eligible" : null;
}

export function PreviewCard({ indicator, data, error, pending }: {
  indicator: string; data: CarePreview | undefined; error: unknown; pending: boolean;
}) {
  return (
    <Panel title={`${indicator} — ${indicatorLabel(indicator)}`} sub="estimativa">
      <div style={{ ...stack, padding: 16 }}>
        {pending && <p className="mono" style={muted}>calculando…</p>}
        {error ? <p role="alert" style={alert}>{careLineError(error)}</p> : null}
        {data && (data.denominator === 0 ? <EmptyState title="nenhuma pessoa elegível nesta equipe" /> : (
          <>
            <div style={grid}>
              <KeyValue k="Pontuação estimada" v={data.score === null ? NO_DATA : `${decimalBr(data.score)} de ${decimalBr(data.max_score)}`} />
              <KeyValue k="Conceito estimado" v={data.concept === null ? NO_DATA : conceptLabel(data.concept)} mono={false} />
              <KeyValue k="População elegível" v={String(data.denominator)} />
              {data.template_version !== null && <KeyValue k="Versão do catálogo" v={`v${data.template_version}`} />}
            </div>
            <DataTable<CarePreviewPractice>
              cols={[
                { label: "Boa prática", w: "2fr", card: "title", render: (p) => p.label ?? p.key },
                { label: "Pontos", w: "80px", align: "right", render: (p) => (typeof p.points === "number" ? String(p.points) : "—") },
                { label: "Peso na prévia", w: "110px", align: "right", render: (p) => (outReason(data, p) ? "—" : decimalBr(p.weight)) },
                { label: "Atingiram", w: "110px", align: "right",
                  render: (p) => (outReason(data, p) ? "—" : `${p.achieved} de ${p.denominator}`) },
                { label: "Na conta", w: "1.4fr", render: (p) => {
                  const out = outReason(data, p);
                  return out === null ? "sim" : out === "untracked" ? OUT_UNTRACKED : OUT_NO_ELIGIBLE;
                } }
              ]}
              rows={data.practices} rowKey={(p) => p.key}
            />
            {data.excluded.length > 0 && <p style={muted}>{`Fora da conta: ${data.excluded.map(excludedLabel).join(", ")}`}</p>}
          </>
        ))}
      </div>
    </Panel>
  );
}
