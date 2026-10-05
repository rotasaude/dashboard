// src/modules/protocols/TriageOfferForm.tsx
// Edição de uma linha do catálogo da cidade (módulo 15; ADR 0027; contratos
// §4.2): oferecer ou pausar, ordem, restrição e período. Só municipal_admin,
// sempre com step-up (SensitiveAction). A restrição soma com E à elegibilidade
// assinada: a cidade restringe, nunca amplia.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPanelNeighborhoods, updateTriageOffer, type TriageOffer } from "../../lib/api";
import { fieldsFor } from "../../lib/condition";
import { describeCondition } from "../../lib/conditionPhrase";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { formFrom, offerFormProblem, offerPayload, triageCatalogError, type OfferFormState } from "../../lib/triageCatalog";
import { ConditionBuilder } from "./ConditionBuilder";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

export function TriageOfferForm({ offer, all, onSaved, onCancel, onGoToSecurity }: {
  offer: TriageOffer; all: TriageOffer[]; onSaved(): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const [ form, setForm ] = useState<OfferFormState>(() => formFrom(offer, all));
  const [ confirming, setConfirming ] = useState(false);
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods });
  const restrictionFields = fieldsFor("restriction", { neighborhoods: neighborhoods.data ?? [] });
  const problem = offerFormProblem(form);
  // Mexer no formulário depois de abrir a confirmação fecha a confirmação:
  // o que se confirma é sempre o que está na tela.
  const set = (patch: Partial<OfferFormState>) => { setConfirming(false); setForm((f) => ({ ...f, ...patch })); };

  return (
    <section aria-label={`Editar ${offer.title}`} style={panel}>
      <strong>
        {offer.title} <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{offer.protocol_name}</span>
      </strong>
      <p style={hint}>
        Elegibilidade assinada: {describeCondition(offer.eligibility, fieldsFor("eligibility"), "para todos")}.
        A restrição abaixo soma com E: só restringe, nunca amplia.
      </p>
      <label style={{ ...label, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Oferecer no catálogo
      </label>
      <label style={label}>
        Ordem no catálogo
        <input inputMode="numeric" value={form.position} style={{ ...inputStyle, width: 120 }}
          onChange={(e) => set({ position: e.target.value })} />
      </label>
      <ConditionBuilder label="Restrição da cidade" fields={restrictionFields} value={form.restriction}
        emptyText="nenhuma" onChange={(tree) => set({ restriction: tree })} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={label}>
          Disponível a partir de
          <input type="date" value={form.from} style={inputStyle} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label style={label}>
          Disponível até
          <input type="date" value={form.until} style={inputStyle} onChange={(e) => set({ until: e.target.value })} />
        </label>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {!confirming && (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={problem !== null} style={problem ? disabledButtonStyle : buttonStyle}
            onClick={() => setConfirming(true)}>Salvar no catálogo…</button>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      )}
      {confirming && (
        <SensitiveAction
          title={`Salvar ${offer.title} no catálogo`}
          description="Vale para os próximos catálogos montados no wpda e fica registrado na auditoria."
          requiresStepUp
          run={async () => { await updateTriageOffer(offer.protocol_name, offerPayload(form)); }}
          translateError={triageCatalogError}
          onDone={onSaved}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
        />
      )}
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, marginTop: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
