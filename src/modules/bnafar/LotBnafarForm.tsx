// Complemento BNAFAR de um lote (módulo 27b; contrato Q16, F-10, F-11, F-32): `PATCH /pharmacy/lots/:id/bnafar` com `expected_version`.
// Usado só em "Pendências do envio à BNAFAR". Abre vazio (a pendência não traz os valores): os campos do `missing` são exigidos e os
// outros opcionais. Lote antigo manda `expected_version: 0`. `409 lot_bnafar_changed` mostra a frase, relê UMA vez e mantém o digitado
// (a versão relida vale no envio seguinte, sem reenvio automático). Recusa com `path` vai ao campo. Sem step-up (contrato §6).
import { useRef, useState } from "react";
import { updateLotBnafar, type LotBnafar, type LotBnafarState } from "../../lib/api";
import {
  EMPTY_LOT_BNAFAR, LOT_BNAFAR_SAVED, LOT_MISMATCH_FIELD, VACCINE_CNPJ_FROM_CATALOG, bnafarErrorText, bnafarFieldLabel, fmtCents, isStale,
  lotBnafarBody, lotBnafarProblems, missingFields, vaccineBnafarBody, type LotBnafarDraft
} from "../../lib/bnafar";
import { hasBnafarError } from "../../lib/bnafarErrors";
import { pharmacyRefusals } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, list, muted, okText, row } from "../exams/styles";
import { BnafarLotFields } from "../pharmacy/BnafarLotFields";

const FIELDS = new Set([ "unit_price_cents", "manufacturer_cnpj", "manufacturer", "anvisa_registration", "health_program", "ampp_code" ]);

export function LotBnafarForm({ lotId, lotNumber, locationId, state, hasVmp, vmpCode = null, vaccine = false, onSaved, onCancel, reload }: {
  lotId: string; lotNumber: string; locationId: string; state: LotBnafarState; hasVmp: boolean;
  // O VMP do item (a lista de AMPP vem dele); sem ele, o AMPP não é oferecido.
  vmpCode?: string | null;
  // F-11: vacina não tem campo de fabricante; o CNPJ faltante é frase, não campo.
  vaccine?: boolean;
  onSaved(lot: LotBnafar): void; onCancel(): void; reload(): Promise<LotBnafarState | null>;
}) {
  const [ draft, setDraft ] = useState<LotBnafarDraft>(EMPTY_LOT_BNAFAR);
  const [ current, setCurrent ] = useState<LotBnafarState>(state);
  const [ fieldErrors, setFieldErrors ] = useState<Record<string, string>>({});
  const [ general, setGeneral ] = useState<string[]>([]);
  const [ saved, setSaved ] = useState<LotBnafar | null>(null);
  const [ busy, setBusy ] = useState(false);
  const inFlight = useRef(false);

  const missing = missingFields(current);
  const catalogCnpj = vaccine && (current.missing ?? []).includes("manufacturer_cnpj");
  const required = vaccine ? missing.filter((f) => f !== "manufacturer_cnpj") : missing;

  async function submit() {
    if (inFlight.current) return;
    const problems = lotBnafarProblems(draft, required, { hasVmp });
    setSaved(null);
    if (problems.length > 0) {
      setFieldErrors(Object.fromEntries(problems.map((p) => [ p.field, p.text ]))); setGeneral([]);
      return;
    }
    const body = vaccine ? vaccineBnafarBody(draft) : lotBnafarBody(draft);
    if (Object.keys(body).length === 0) { setFieldErrors({}); setGeneral([ "preencha ao menos um campo" ]); return; }
    inFlight.current = true; setBusy(true); setFieldErrors({}); setGeneral([]);
    try {
      const result = await updateLotBnafar(lotId, { location_id: locationId, expected_version: current.version, ...body });
      setCurrent({ version: result.bnafar.version, missing: result.bnafar.missing });
      setSaved(result.bnafar);
      onSaved(result.bnafar);
    } catch (err) {
      if (isStale(err, "lot_bnafar_changed")) {
        setGeneral([ bnafarErrorText("lot_bnafar_changed") ]);
        const fresh = await reload().catch(() => null);
        if (fresh) setCurrent(fresh);
      } else {
        const byField: Record<string, string> = {}, rest: string[] = [];
        for (const r of pharmacyRefusals(err)) {
          const text = r.code === "lot_mismatch" ? LOT_MISMATCH_FIELD : r.code && hasBnafarError(r.code) ? bnafarErrorText(r.code) : r.text;
          if (FIELDS.has(r.path)) byField[r.path] = text; else rest.push(text);
        }
        setFieldErrors(byField); setGeneral(rest);
      }
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  return (
    <form aria-label={`Dados do lote ${lotNumber}`} style={{ display: "flex", flexDirection: "column", gap: 12 }}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p style={muted}>Lote <strong>{lotNumber}</strong>: informe os dados que a BNAFAR pede. {missing.length > 0 && `Faltam: ${missing.map(bnafarFieldLabel).join(", ")}.`}</p>
      {catalogCnpj && <p style={muted}>{VACCINE_CNPJ_FROM_CATALOG}</p>}
      <BnafarLotFields value={draft} onChange={setDraft} required={required} vmpCode={vmpCode} disabled={busy} vaccine={vaccine}
        ampp={hasVmp && !!vmpCode} errors={fieldErrors} />
      {general.length > 0 && (
        <ul role="alert" style={{ ...list, ...alert }}>{general.map((t) => <li key={t}>{t}</li>)}</ul>
      )}
      {saved && (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={okText}>{LOT_BNAFAR_SAVED}</p>
          <small style={muted}>
            {[ saved.unit_price_cents !== null && `Valor R$ ${fmtCents(saved.unit_price_cents)}`, saved.manufacturer_cnpj && `CNPJ ${saved.manufacturer_cnpj}`,
              saved.manufacturer_international && "Fabricante internacional", saved.anvisa_registration && `ANVISA ${saved.anvisa_registration}`,
              saved.health_program && `Programa ${saved.health_program}`, saved.ampp_code && `AMPP ${saved.ampp_code}` ].filter(Boolean).join(" · ")}
          </small>
        </div>
      )}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Salvar dados do lote</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Fechar</button>
      </div>
    </form>
  );
}
