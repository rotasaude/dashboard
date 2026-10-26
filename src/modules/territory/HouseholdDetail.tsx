// src/modules/territory/HouseholdDetail.tsx
// Um domicílio (contrato §4–§6): endereço, ponto de referência, famílias e os
// moradores com a situação do cadastro de cada um. O domicílio e os moradores
// são leituras NOMINAIS com trilha: uma vez cada ao abrir, nunca sozinhas.
// Moradores = só os cadastros ativos do domicílio que o usuário pode ler (C16).
// Fichas (Task 11): "Editar domicílio"; "Nova família" só em domicílio (tipo
// 01) sem recusa, com responsável entre os moradores que ainda não respondem
// por família; "Editar família" só da família que não se mudou (a mudança é
// definitiva). Salvar relê o domicílio uma vez (ação do usuário).
// Ficha individual (Task 12): "Adicionar morador" (domicílio ativo) escolhe a
// família (a única morando já vem escolhida; "sem família" vale), acha a
// pessoa (PersonStart) e abre a ficha com o domicílio; "Abrir cadastro" de um
// morador abre a ficha dele. Salvar relê os moradores uma vez.
import { useState } from "react";
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
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { allowsFamilies, dictLabel } from "../../lib/territoryDictionaries";
import { alert, box, fieldLabel, grid, list, muted, okText, row, stack } from "../exams/styles";
import { HOUSEHOLD_SAVED, addressLine, householdStatus } from "./HouseholdList";
import { HouseholdForm } from "./HouseholdForm";
import { FamilyForm } from "./FamilyForm";
import { PersonStart, type PersonChoice } from "./PersonStart";
import { REGISTRATION_EXITED, REGISTRATION_SAVED, RegistrationForm } from "./RegistrationForm";

const NO_NAME = "sem nome no cadastro";
export const FAMILY_SAVED = "Família salva. Nova versão do domicílio enviada ao e-SUS.";
type Editing =
  | { kind: "household" } | { kind: "newFamily" } | { kind: "family"; family: Family }
  | { kind: "resident"; familyId: string; choice: PersonChoice | null } | { kind: "registration"; id: string; name: string } | null;

export function familyLine(f: Family): string {
  const name = f.responsible.display_name ?? `pessoa ${NO_NAME}`;
  if (f.members_count === null) return `Responsável: ${name}`;
  return `Responsável: ${name} · ${f.members_count} ${f.members_count === 1 ? "pessoa" : "pessoas"}`;
}

export function HouseholdDetail({ householdId, onBack, today }: { householdId: string; onBack(): void; today?: string }) {
  const [ editing, setEditing ] = useState<Editing>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const household = useQuery({ queryKey: [ HOUSEHOLD_KEY, householdId ], queryFn: () => getHousehold(householdId), ...NOMINAL_QUERY });
  const residents = useQuery({
    queryKey: [ RESIDENTS_KEY, householdId ], queryFn: () => listRegistrations({ householdId }), ...NOMINAL_QUERY
  });
  const h = household.data;
  const status = h && householdStatus(h);
  const open = (next: Editing) => { setNotice(null); setEditing(next); };
  const saved = (text: string) => () => { setEditing(null); setNotice(text); };
  const responsibles = new Set((h?.families ?? []).filter((f) => !f.moved_out).map((f) => f.responsible.patient_id));
  const candidates = (residents.data ?? []).filter((r) => !responsibles.has(r.patient.id))
    .map((r) => ({ patient_id: r.patient.id, display_name: r.patient.display_name }));
  const familyName = (f: Family) => f.responsible.display_name ?? `pessoa ${NO_NAME}`;
  const living = (h?.families ?? []).filter((f) => !f.moved_out);
  const residentName = (r: Registration) => r.patient.display_name ?? NO_NAME;

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
              <KeyValue k="Tipo de imóvel" v={dictLabel("tipo_de_imovel", h.property_type)} mono={false} />
              <KeyValue k="Situação" v={<Tag tone={status.tone}>{status.label}</Tag>} />
              <KeyValue k="Cadastrado em" v={`${fmtDay(h.registered_at)}${h.registered_by.name ? ` · ${h.registered_by.name}` : ""}`} mono={false} />
            </div>
            {notice && <p role="status" style={okText}>{notice}</p>}
            {editing?.kind === "household" ? (
              <div style={box}>
                <strong>Editar domicílio</strong>
                <HouseholdForm microAreaId={h.micro_area.id} initial={h} onCancel={() => setEditing(null)} onSaved={saved(HOUSEHOLD_SAVED)} />
              </div>
            ) : !editing && (
              <div style={row}>
                <button type="button" style={secondaryButtonStyle} onClick={() => open({ kind: "household" })}>Editar domicílio</button>
                {allowsFamilies(h.property_type) && !h.refused && (
                  <button type="button" style={secondaryButtonStyle} onClick={() => open({ kind: "newFamily" })}>Nova família</button>
                )}
                {h.status === "active" && (
                  <button type="button" style={secondaryButtonStyle}
                    onClick={() => open({ kind: "resident", familyId: living.length === 1 ? living[0].id : "", choice: null })}>
                    Adicionar morador
                  </button>
                )}
              </div>
            )}
            {editing?.kind === "resident" && (
              <div style={box}>
                <strong>Adicionar morador</strong>
                {living.length > 0 && (
                  <label style={fieldLabel}>
                    Família
                    <select value={editing.familyId} style={inputStyle} onChange={(e) => setEditing({ ...editing, familyId: e.target.value })}>
                      <option value="">sem família</option>
                      {living.map((f) => <option key={f.id} value={f.id}>{`Responsável: ${familyName(f)}`}</option>)}
                    </select>
                  </label>
                )}
                {editing.choice ? (
                  <RegistrationForm today={today} choice={editing.choice} onCancel={() => setEditing(null)} onSaved={saved(REGISTRATION_SAVED)}
                    household={{ id: h.id, familyId: editing.familyId || null,
                      responsiblePatientId: living.find((f) => f.id === editing.familyId)?.responsible.patient_id ?? null }} />
                ) : (
                  <PersonStart today={today} onCancel={() => setEditing(null)} onChoose={(choice) => setEditing({ ...editing, choice })} />
                )}
              </div>
            )}
            {editing?.kind === "registration" && (
              <div style={box}>
                <strong>{`Cadastro de ${editing.name}`}</strong>
                <RegistrationForm today={today} registrationId={editing.id} onCancel={() => setEditing(null)} onSaved={saved(REGISTRATION_SAVED)}
                  onExited={saved(REGISTRATION_EXITED)} />
              </div>
            )}
            {(editing?.kind === "newFamily" || editing?.kind === "family") && (
              <div style={box}>
                <strong>{editing.kind === "family" ? "Editar família" : "Nova família"}</strong>
                <FamilyForm household={h} initial={editing.kind === "family" ? editing.family : undefined} candidates={candidates}
                  today={today} onCancel={() => setEditing(null)} onSaved={saved(FAMILY_SAVED)} />
              </div>
            )}
            <section aria-label="Famílias" style={stack}>
              <strong>Famílias</strong>
              {h.families.length === 0 ? <p style={muted}>nenhuma família</p> : (
                <ul style={list}>
                  {h.families.map((f) => (
                    <li key={f.id} style={row}>
                      <span>{familyLine(f)}</span>
                      {f.moved_out ? <Tag tone="neutral">mudou-se</Tag> : !editing && (
                        <button type="button" style={secondaryButtonStyle} aria-label={`Editar família de ${familyName(f)}`}
                          onClick={() => open({ kind: "family", family: f })}>Editar família</button>
                      )}
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
                { label: "Nome", w: "2fr", card: "title", render: residentName },
                { label: "Documento", w: "1.6fr", render: (r) => patientDocument(r.patient).v },
                { label: "Situação", w: "180px", render: (r) => <Tag tone={registryStatusTone(r.status)}>{registryStatusLabel(r.status)}</Tag> },
                { label: "Família", w: "130px", render: (r) => (r.is_responsible ? "responsável" : "—") },
                {
                  label: "Ação", w: "140px", card: "actions",
                  render: (r) => !editing && (
                    <button type="button" style={secondaryButtonStyle} aria-label={`Abrir cadastro de ${residentName(r)}`}
                      onClick={() => open({ kind: "registration", id: r.id, name: residentName(r) })}>
                      Abrir cadastro
                    </button>
                  )
                }
              ]}
              rows={residents.data} rowKey={(r) => r.id} empty="nenhum morador com cadastro ativo que você possa ver"
            />
          )}
        </section>
      </div>
    </Panel>
  );
}
