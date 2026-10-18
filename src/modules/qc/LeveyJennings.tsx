// Gráfico de Levey-Jennings (spec §5.9; contrato §3) com o Recharts já usado
// no Analytics. Eixo em desvios-padrão (cada ponto vem com o z da referência
// da sua versão; nada é reprojetado); linhas em ±1/2/3 dp e na média; linha
// vertical onde a versão da referência muda; ponto colorido pelo desfecho.
// A legenda e a tabela dos pontos marcados são HTML: legíveis sem o SVG.
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QcChart } from "../../lib/api";
import {
  SD_LINES, fmtDecimal, fmtZ, ljBands, ljModel, outcomeLabel, outcomeTone, rulesText, sdLabel, targetSourceLabel, type LjRow
} from "../../lib/qc";
import { fmtDateTime } from "../../lib/format";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { list, muted, row } from "../exams/styles";

const LINE_COLOR: Record<number, string> = { 0: "var(--ink2)", 1: "var(--rule)", 2: "var(--warn)", 3: "var(--down)" };
const DOT_COLOR: Record<string, string> = { ok: "var(--ok)", warning: "var(--warn)", reject: "var(--down)" };

interface DotProps { cx?: number; cy?: number; payload?: LjRow }

function LjDot({ cx, cy, payload }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return <g />;
  return (
    <circle cx={cx} cy={cy} r={payload.outcome === "ok" ? 3 : 5} fill={DOT_COLOR[payload.outcome] ?? "var(--ink3)"} stroke="var(--panel)"
      data-outcome={payload.outcome} />
  );
}

function LjTooltip({ active, payload }: { active?: boolean; payload?: { payload?: LjRow }[] }) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--rule)", borderRadius: 6, padding: "6px 8px", fontSize: 11, color: "var(--ink)" }}>
      <div>{`#${point.n} · ${fmtDateTime(point.at)}`}</div>
      <div>{`valor ${fmtDecimal(point.value)} · z ${fmtZ(point.z)} · referência v${point.version}`}</div>
      {point.rules.length > 0 && <div>{`regras: ${rulesText(point.rules)}`}</div>}
    </div>
  );
}

export function LeveyJennings({ chart, label }: { chart: QcChart; label: string }) {
  const model = ljModel(chart);
  if (model.rows.length === 0) return <p style={muted}>nenhum ponto no período</p>;
  return (
    <figure aria-label={label} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={model.rows} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--rule)" vertical={false} />
            <XAxis dataKey="n" tick={{ fontSize: 10 }} />
            <YAxis domain={model.domain} ticks={SD_LINES} tickFormatter={(v: number) => sdLabel(v)} width={52} tick={{ fontSize: 10 }} />
            {SD_LINES.map((k) => (
              <ReferenceLine key={`sd${k}`} y={k} stroke={LINE_COLOR[Math.abs(k)]} strokeDasharray={k === 0 ? undefined : "4 4"} />
            ))}
            {model.versionChanges.map((c) => (
              <ReferenceLine key={`v${c.n}`} x={c.n} stroke="var(--accent)" label={{ value: `v${c.version}`, position: "top", fontSize: 10, fill: "var(--accent)" }} />
            ))}
            <Tooltip content={<LjTooltip />} />
            <Line dataKey="z" stroke="var(--ink3)" strokeWidth={1} isAnimationActive={false} connectNulls={false} activeDot={false}
              dot={(p: DotProps & { key?: string; index?: number }) => <LjDot key={p.key ?? `d${p.index ?? 0}`} cx={p.cx} cy={p.cy} payload={p.payload} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5, color: "var(--ink2)" }}>
        <span>{chart.target
          ? `Referência vigente v${chart.target.version} (${targetSourceLabel(chart.target.source)}): média ${fmtDecimal(chart.target.mean)} · dp ${fmtDecimal(chart.target.sd)}`
          : "sem referência vigente para esta chave — o eixo segue em desvios-padrão da referência de cada ponto"}</span>
        {chart.target && (
          <ul aria-label="faixas da referência vigente" style={{ ...list, flexDirection: "row", flexWrap: "wrap", gap: 12, listStyle: "none", paddingLeft: 0 }}>
            {ljBands(chart.target).map((b) => <li key={b.k}>{`${b.label}: ${b.value}`}</li>)}
          </ul>
        )}
        {model.mixedVersions && <span>há pontos avaliados contra outra versão da referência — o eixo é em desvios-padrão, cada ponto contra a sua versão</span>}
        <span style={row}>
          <Tag tone="ok">ok</Tag><Tag tone="warn">aviso (1-2s)</Tag><Tag tone="down">reprovado</Tag>
        </span>
      </figcaption>
      <section aria-label="Pontos com regra disparada">
        <DataTable<LjRow>
          cols={[
            { label: "#", w: "0.4fr", card: "title", render: (r) => String(r.n) },
            { label: "Quando", w: "1fr", render: (r) => fmtDateTime(r.at) },
            { label: "Valor", w: "0.7fr", align: "right", render: (r) => fmtDecimal(r.value) },
            { label: "z", w: "0.5fr", align: "right", render: (r) => fmtZ(r.z) },
            { label: "Regras", w: "1fr", render: (r) => rulesText(r.rules) },
            { label: "Desfecho", w: "0.8fr", render: (r) => <Tag tone={outcomeTone(r.outcome)}>{outcomeLabel(r.outcome)}</Tag> },
            { label: "Referência", w: "0.6fr", render: (r) => `v${r.version}` }
          ]}
          rows={model.flagged} rowKey={(r) => String(r.n)} empty="nenhum ponto com regra disparada no período"
        />
      </section>
    </figure>
  );
}
