// Cartão da receita encontrada (módulo 27a; F-27.5; contrato §7, H3). Só mostra o que o api devolveu: paciente (sem CPF e CNS
// mascarado como no 24a), emissão e validade da receita e de cada item, profissional, itens com quantidade e posologia.
// O que impede dispensar (receita cancelada ou vencida) aparece NO LUGAR do botão "Dispensar"; as regras por item e a retenção
// ficam no formulário da dispensação. Nada daqui vai a URL, log ou storage.
import type { PrescriptionItemView, PrescriptionView } from "../../lib/api";
import { fmtDay } from "../../lib/exams";
import { fmtQuantity, prescriptionBlock } from "../../lib/pharmacy";
import { NO_NAME } from "../../lib/territoryRegistry";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { box, muted, row } from "../exams/styles";

const NO_PRESCRIBER = "profissional sem nome no cadastro";
const itemLine = { margin: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: 12.5 } as const;

export const prescriptionKindLabel = (kind: string): string => (kind === "external" ? "Receita externa" : "Receita digital");

// O api já manda "ABCDE-23456"; o formato de 10 caracteres (sem hífen) também se mostra como vem impresso.
export const fmtShortCode = (code: string): string => (code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code);

function itemValidity(i: PrescriptionItemView): string {
  return i.expired ? `vencido em ${fmtDay(i.valid_until)}` : `vale até ${fmtDay(i.valid_until)}`;
}

export function PrescriptionCard({ p, onDispense, onHistory }: { p: PrescriptionView; onDispense?(): void; onHistory?(): void }) {
  const kind = prescriptionKindLabel(p.kind);
  const block = prescriptionBlock(p);
  return (
    <article aria-label={`${kind} de ${fmtDay(p.issued_on)}`} style={box}>
      <div style={row}>
        <Tag tone="info">{kind}</Tag>
        {p.short_code && <span className="mono" style={muted}>{fmtShortCode(p.short_code)}</span>}
      </div>
      <div style={row}>
        <strong>{p.patient.display_name ?? NO_NAME}</strong>
        {!p.patient.has_cpf && <Tag tone="warn">sem CPF</Tag>}
        {p.patient.cns_masked && <span className="mono" style={muted}>{`CNS ${p.patient.cns_masked}`}</span>}
      </div>
      <p style={muted}>{`emitida em ${fmtDay(p.issued_on)} · vale até ${fmtDay(p.valid_until)}`}</p>
      <p style={muted}>{[ p.prescriber.name ?? NO_PRESCRIBER, p.prescriber.council ].filter(Boolean).join(" · ")}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
        {p.items.map((i) => {
          const validity = itemValidity(i);
          return (
            <li key={i.id} style={itemLine}>
              <span style={row}>
                <strong>{i.printed_description}</strong>
                {i.continuous && <Tag tone="info">uso contínuo</Tag>}
                {i.controlled && <Tag tone="warn">controlado</Tag>}
                {i.retention_required && <Tag tone="warn">retém a receita</Tag>}
                {i.completed && <Tag tone="neutral">dispensado por completo</Tag>}
              </span>
              <span>{`${fmtQuantity(i.quantity)} ${i.quantity_unit} · já dispensado ${fmtQuantity(i.dispensed_total)}`}</span>
              <span style={muted}>{i.dosage_instructions}</span>
              {i.expired ? <span style={row}><Tag tone="down" mono={false}>{validity}</Tag></span> : <span style={muted}>{validity}</span>}
            </li>
          );
        })}
      </ul>
      {block ? <div style={row}><Tag tone="down" mono={false}>{block}</Tag></div> : onDispense && (
        <div style={row}><button type="button" style={buttonStyle} onClick={onDispense}>Dispensar</button></div>
      )}
      {/* O histórico de retiradas é do paciente, não da receita: o botão vale mesmo com a receita vencida ou cancelada. */}
      {onHistory && <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onHistory}>Histórico de retiradas</button></div>}
    </article>
  );
}
