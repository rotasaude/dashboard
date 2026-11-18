// src/modules/homeVisits/InspectionDetail.tsx
// Leitura do boletim do agente de endemias no detalhe da visita (módulo 35a, F-35.2, F-35.8), na forma do <home_visit> do api
// (VectorControl::Json#inspection): atividade, trabalho, situação (recuperado), horários, quarteirão, depósitos por grupo, medidas
// com produto e quantidade, amostras com a etiqueta definitiva e o resultado, ação educativa. O risco não vem no boletim (fica no
// perfil do imóvel). Os rótulos vêm de GET /vector_control/domains, que todo leitor da visita do 24b lê (Q32); se a leitura
// falhar (403, rede), ou o código for novo, o código aparece cru.
import type { VectorControlDomains, VectorInspection } from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import { domainLabel } from "../../lib/vectorControl";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { box, grid, muted } from "../exams/styles";

type ListKey = "activities" | "work_types" | "situations" | "deposit_groups" | "measure_methods";
const item = { display: "flex", flexDirection: "column", gap: 2, fontSize: 13 } as const;
const decimal = (n: number | string) => String(n).replace(".", ",");
const chargesText = (n: number) => `${decimal(n)} ${n === 1 ? "carga" : "cargas"}`;

export function InspectionDetail({ inspection: i, domains }: { inspection: VectorInspection; domains: VectorControlDomains | null }) {
  const label = (key: ListKey, code: string) => (domains ? domainLabel(domains[key], code) : code);
  const hours = i.entered_at && i.left_at ? `${fmtHourMinute(i.entered_at)}–${fmtHourMinute(i.left_at)}` : "—";
  return (
    <section aria-label="Boletim do agente de endemias" style={box}>
      <strong style={{ fontSize: 12.5 }}>Boletim do agente de endemias</strong>
      <div style={grid}>
        <KeyValue k="Atividade" v={label("activities", i.activity)} mono={false} />
        <KeyValue k="Trabalho" v={label("work_types", i.work_type)} mono={false} />
        <KeyValue k="Situação" mono={false} v={
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span>{label("situations", i.situation)}</span>
            {i.recovered && <Tag tone="info" mono={false}>recuperado</Tag>}
          </span>
        } />
        <KeyValue k="Entrada e saída" v={hours} />
        <KeyValue k="Quarteirão" v={i.city_block?.number ?? "—"} />
        <KeyValue k="Ação educativa" v={i.educational_action ? "sim" : "não"} mono={false} />
      </div>

      <strong style={{ fontSize: 12.5 }}>Depósitos</strong>
      {i.deposits.length === 0 ? <p style={muted}>sem depósito</p> : i.deposits.map((d) => (
        <div key={d.group} style={item}>
          <span>{label("deposit_groups", d.group)}</span>
          <span style={muted}>{`${d.existing} existentes · ${d.with_water} com água · ${d.with_larvae} com larva · ${d.eliminated} eliminados · ${d.treated} tratados`}</span>
        </div>
      ))}

      <strong style={{ fontSize: 12.5 }}>Medidas</strong>
      {i.measures.length === 0 ? <p style={muted}>sem medida</p> : i.measures.map((m, n) => (
        <div key={`${m.method}-${m.vector_product_id ?? n}`} style={item}>
          <span>{label("measure_methods", m.method)}</span>
          {m.product && (
            <span style={muted}>
              {[ m.product.name, m.charges !== undefined ? chargesText(m.charges) : null, m.quantity ? `${decimal(m.quantity)} ${m.product.unit}` : null ]
                .filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      ))}

      <strong style={{ fontSize: 12.5 }}>Amostras</strong>
      {i.samples.length === 0 ? <p style={muted}>sem amostra</p> : i.samples.map((s) => (
        <div key={s.id} style={item}>
          <span className="mono">{s.label}</span>
          <span style={muted}>{`grupo ${s.deposit_group} · ${s.larvae_collected} larvas`}</span>
          {s.result ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span>{`examinadas ${s.result.examined_larvae} · Ae. aegypti ${s.result.aegypti_larvae} · Ae. albopictus ${s.result.albopictus_larvae}`}</span>
              {s.result.corrected && <Tag tone="neutral" mono={false}>corrigido</Tag>}
            </span>
          ) : <span style={muted}>aguardando resultado</span>}
        </div>
      ))}
    </section>
  );
}
