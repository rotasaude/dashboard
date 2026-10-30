// Leitura da consulta odontológica finalizada (F-28.2, F-28.3): só o que a consulta gravou em `consultation.dental`,
// sem reler o odontograma. Os rótulos vêm do vocabulário das opções (O4); código desconhecido aparece cru.
// O bloco aparece também com o interruptor `dental_care` desligado: o registro clínico retido segue legível (O16, ADR 0026).
import type { AddendumChanges, Consultation, DentalFinding, DentalVocabulary } from "../../lib/api";
import { codedLabel, locationLabel, situationLabel } from "../../lib/dental";
import { muted, list as listStyle } from "../exams/styles";

type Situations = DentalVocabulary["situations"];

export function findingLocation(f: DentalFinding): string {
  if (f.tooth === null) return f.arch ? locationLabel({ kind: "arch", tooth: null, face: null, sextant: null, arch: f.arch }) : "arcada";
  const where = locationLabel({ kind: f.face ? "face" : "tooth", tooth: f.tooth, face: f.face, sextant: null, arch: null });
  return f.part === "root" ? `${where}, raiz` : where;
}
export const findingText = (f: DentalFinding, situations?: Situations): string =>
  `${findingLocation(f)}: ${situationLabel(f.situation, situations, f.tooth === null ? "arch" : f.face ? "face" : f.part)}`;

// Linhas do adendo odontológico na leitura do adendo.
export function dentalChangesLines(changes: AddendumChanges | null | undefined, situations?: Situations): string[] {
  const d = changes?.dental;
  if (!d) return [];
  const lines: string[] = [];
  if (d.findings.length > 0) lines.push(`Achados: ${d.findings.map((f) => findingText(f, situations)).join("; ")}`);
  const n = d.plan_changes.cancel.length;
  if (n > 0) lines.push(`Plano: ${n} ${n === 1 ? "item cancelado" : "itens cancelados"}`);
  return lines;
}

interface Props { consultation: Consultation; vocabulary?: DentalVocabulary; situations?: Situations }

export function DentalSummary({ consultation: c, vocabulary, situations }: Props) {
  const d = c.dental;
  if (!d) return null;
  const sit = situations ?? vocabulary?.situations;
  const fao: [ string, string[] ][] = [
    [ "Tipo de atendimento", d.care_type ? [ codedLabel(vocabulary?.care_types, d.care_type) ] : [] ],
    [ "Tipo de consulta odontológica", d.dental_consultation_type ? [ codedLabel(vocabulary?.consultation_types, d.dental_consultation_type) ] : [] ],
    [ "Vigilância em saúde bucal", d.oral_health_surveillance.map((x) => codedLabel(vocabulary?.surveillance, x)) ],
    [ "Fornecimento", d.supplies.map((x) => codedLabel(vocabulary?.supplies, x)) ],
    [ "Desfecho", d.dental_outcomes.map((x) => codedLabel(vocabulary?.outcomes, x)) ]
  ];
  const cancels = d.plan_changes.cancel;
  const adds = d.plan_changes.add;

  return (
    <section aria-label="Consulta odontológica" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong style={{ fontSize: 12 }}>Consulta odontológica</strong>
      {c.baseline && <p style={muted}>Registro inicial (sem ficha do e-SUS)</p>}
      {fao.filter(([ , items ]) => items.length > 0).map(([ label, items ]) => (
        <div key={label} style={{ fontSize: 12.5 }}>
          <span style={muted}>{label}</span>
          <ul style={{ ...listStyle, listStyle: "none", paddingLeft: 0 }}>{items.map((t, i) => <li key={`${t}-${i}`}>{t}</li>)}</ul>
        </div>
      ))}
      {d.special_needs && <p style={{ margin: 0, fontSize: 12.5 }}>Paciente com necessidades especiais</p>}
      {d.pregnant === true && <p style={{ margin: 0, fontSize: 12.5 }}>Gestante</p>}
      {d.procedures.length > 0 && (
        <div style={{ fontSize: 12.5 }}>
          <span style={muted}>Procedimentos</span>
          <ul aria-label="procedimentos" style={listStyle}>
            {d.procedures.map((p, i) => <li key={p.id ?? i}>{`${p.name ?? p.sigtap} · ${locationLabel(p.location)} · ${p.quantity}`}</li>)}
          </ul>
        </div>
      )}
      {d.findings.length > 0 && (
        <div style={{ fontSize: 12.5 }}>
          <span style={muted}>Achados</span>
          <ul aria-label="achados" style={listStyle}>{d.findings.map((f, i) => <li key={`${findingText(f, sit)}-${i}`}>{findingText(f, sit)}</li>)}</ul>
        </div>
      )}
      {(adds.length > 0 || cancels.length > 0 || d.plan_changes.cancel_plan) && (
        <div style={{ fontSize: 12.5 }}>
          <span style={muted}>Plano de tratamento</span>
          <ul aria-label="mudanças do plano" style={listStyle}>
            {adds.map((a, i) => <li key={`a${i}`}>{`incluído: ${a.name ?? a.sigtap} · ${locationLabel(a.location)}`}</li>)}
            {cancels.map((x) => <li key={`${x.item_id}`}>{`item cancelado — ${x.reason}`}</li>)}
            {d.plan_changes.cancel_plan && <li>{`plano cancelado — ${d.plan_changes.cancel_plan.reason}`}</li>}
          </ul>
        </div>
      )}
      {d.periodontal_screening && (
        <p style={{ margin: 0, fontSize: 12.5 }}>
          {`Registro periodontal: ${d.periodontal_screening.sextants.map((s) => `${s.sextant} ${s.code ?? "X"}${s.star ? "*" : ""}`).join(" · ")}`}
        </p>
      )}
      {d.periodontal_chart && <p style={{ margin: 0, fontSize: 12.5 }}>{`Periograma: ${d.periodontal_chart.teeth.length} ${d.periodontal_chart.teeth.length === 1 ? "dente" : "dentes"}`}</p>}
      {d.endodontics.length > 0 && (
        <div style={{ fontSize: 12.5 }}>
          <span style={muted}>Endodontia</span>
          <ul aria-label="endodontia" style={listStyle}>
            {d.endodontics.map((e, i) => <li key={`${e.tooth}-${i}`}>{`dente ${e.tooth} · ${e.canals} ${e.canals === 1 ? "canal" : "canais"} · ${e.status === "completed" ? "concluída" : "em andamento"}`}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
