// src/modules/territory/HouseholdDetail.tsx
// Um domicílio (contrato §4–§6): endereço, ponto de referência, famílias e os
// moradores com a situação do cadastro de cada um. O domicílio e os moradores
// são leituras NOMINAIS com trilha: uma vez cada ao abrir, nunca sozinhas.
// Moradores = só os cadastros ativos do domicílio que o usuário pode ler (C16).
import { useQuery } from "@tanstack/react-query";
import { getHousehold, listRegistrations, type Family, type Registration } from "../../lib/api";
import {
  HOUSEHOLD_KEY, NOMINAL_QUERY, RESIDENTS_KEY, fmtDay, registryStatusLabel, registryStatusTone, territoryError
} from "../../lib/territoryRegistry";
import { patientDocument } from "../../lib/patientDocument";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { KeyValue } from "../../components/KeyValue";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, grid, list, muted, row, stack } from "../exams/styles";
import { addressLine, householdStatus } from "./HouseholdList";

const NO_NAME = "sem nome no cadastro";

export function familyLine(f: Family): string {
  const name = f.responsible.display_name ?? `pessoa ${NO_NAME}`;
  if (f.members_count === null) return `Responsável: ${name}`;
  return `Responsável: ${name} · ${f.members_count} ${f.members_count === 1 ? "pessoa" : "pessoas"}`;
}

export function HouseholdDetail({ householdId, onBack }: { householdId: string; onBack(): void }) {
  const household = useQuery({ queryKey: [ HOUSEHOLD_KEY, householdId ], queryFn: () => getHousehold(householdId), ...NOMINAL_QUERY });
  const residents = useQuery({
    queryKey: [ RESIDENTS_KEY, householdId ], queryFn: () => listRegistrations({ householdId }), ...NOMINAL_QUERY
  });
  const h = household.data;
  const status = h && householdStatus(h);

  return (
    <Panel title={h ? addressLine(h.address) : "Domicílio"} sub={h ? `microárea ${h.micro_area.code}` : undefined}
      right={<button type="button" style={secondaryButtonStyle} onClick={onBack}>Fechar</button>}>
      <div style={{ ...stack, padding: 16 }}>
        {household.isPending && <p className="mono" style={muted}>carregando…</p>}
        {household.isError && <p role="alert" style={alert}>{territoryError(household.error)}</p>}
        {h && status && (
          <>
            <div style={grid}>
              {h.address.complement && <KeyValue k="Complemento" v={h.address.complement} mono={false} />}
              <KeyValue k="Ponto de referência" v={h.address.reference || "—"} mono={false} />
              <KeyValue k="Tipo de imóvel" v={h.property_type} />
              <KeyValue k="Situação" v={<Tag tone={status.tone}>{status.label}</Tag>} />
              <KeyValue k="Cadastrado em" v={`${fmtDay(h.registered_at)}${h.registered_by.name ? ` · ${h.registered_by.name}` : ""}`} mono={false} />
            </div>
            <section aria-label="Famílias" style={stack}>
              <strong>Famílias</strong>
              {h.families.length === 0 ? <p style={muted}>nenhuma família</p> : (
                <ul style={list}>
                  {h.families.map((f) => (
                    <li key={f.id} style={row}>
                      <span>{familyLine(f)}</span>
                      {f.moved_out && <Tag tone="neutral">mudou-se</Tag>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
        <section aria-label="Moradores" style={stack}>
          <strong>Moradores</strong>
          {residents.isPending && <p className="mono" style={muted}>carregando…</p>}
          {residents.isError && <p role="alert" style={alert}>{territoryError(residents.error)}</p>}
          {residents.data && (
            <DataTable<Registration>
              cols={[
                { label: "Nome", w: "2fr", card: "title", render: (r) => r.patient.display_name ?? NO_NAME },
                { label: "Documento", w: "1.6fr", render: (r) => patientDocument(r.patient).v },
                { label: "Situação", w: "180px", render: (r) => <Tag tone={registryStatusTone(r.status)}>{registryStatusLabel(r.status)}</Tag> },
                { label: "Família", w: "130px", render: (r) => (r.is_responsible ? "responsável" : "—") }
              ]}
              rows={residents.data} rowKey={(r) => r.id} empty="nenhum morador com cadastro ativo que você possa ver"
            />
          )}
        </section>
      </div>
    </Panel>
  );
}
