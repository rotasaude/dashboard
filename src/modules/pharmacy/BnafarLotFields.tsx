// Campos do envio à BNAFAR no lote da entrada e da abertura (módulo 27b; contrato §2, Q7, Q15, Q21, Q41, F-10).
// Valor unitário em reais com vírgula; fabricante por CNPJ ou internacional (nome, sem CNPJ); ANVISA; programa de saúde (lista DM14 do
// `/pharmacy/bnafar/domains`; código fora da lista aparece cru); e o AMPP escolhido entre as apresentações do VMP. Exigido só onde o
// domínio está em `enabled_domains` (quem chama passa `required`); o campo não exigido leva "(opcional)" no rótulo. O IUM não tem campo.
// Escolher o AMPP preenche o ANVISA e o CNPJ que estiverem VAZIOS com os da apresentação.
import { useQuery } from "@tanstack/react-query";
import { getBnafarDomains, type BnafarField, type ObmPresentation } from "../../lib/api";
import { BNAFAR_DOMAINS_KEY, STATIC_QUERY, bnafarFieldLabel, type LotBnafarDraft } from "../../lib/bnafar";
import { inputStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, muted, row } from "../exams/styles";
import { AmppPick } from "./AmppPick";

export const PROGRAMS_ERROR = "não foi possível ler os programas de saúde — recarregue a tela";

// Lista de domínios compartilhada com quem calcula o `required` (a mesma chave de cache; sem polling).
export function useBnafarDomains() {
  return useQuery({ queryKey: [ BNAFAR_DOMAINS_KEY ], queryFn: getBnafarDomains, ...STATIC_QUERY });
}

export function BnafarLotFields({ value, onChange, required, vmpCode, label = (base) => base, disabled = false, vaccine = false, vector = false, externalName = false, ampp = true, errors = {} }: {
  value: LotBnafarDraft; onChange(next: LotBnafarDraft): void; required: BnafarField[]; vmpCode: string | null | undefined;
  label?(base: string): string; disabled?: boolean;
  // Vacina: sem fabricante nem CNPJ (Q21). Produto de campo: sem AMPP (F-31).
  vaccine?: boolean; vector?: boolean;
  // F-10: o nome do fabricante internacional é o campo "Fabricante" da linha, que quem chama já mostra.
  externalName?: boolean;
  // Complemento do lote: sem VMP não há AMPP a escolher nem aviso (`ampp` false). `errors`: a recusa do api por campo (path → frase).
  ampp?: boolean; errors?: Record<string, string>;
}) {
  const domains = useBnafarDomains();
  const patch = (over: Partial<LotBnafarDraft>) => onChange({ ...value, ...over });
  const need = (f: BnafarField) => required.includes(f);
  const field = (f: string, key: BnafarField) => (need(key) ? bnafarFieldLabel(f) : `${bnafarFieldLabel(f)} (opcional)`);
  const programs = domains.data?.programs ?? [];
  const known = programs.some((p) => p.code === value.program);
  // O aviso de sem VMP só onde o domínio está em `enabled_domains`: é onde o AMPP é exigido (`required` o traz).
  const domainOn = required.includes("ampp_code");
  const err = (key: string) => (errors[key] ? <small role="alert" style={alert}>{errors[key]}</small> : null);

  function pickAmpp(presentation: ObmPresentation | null, code: string) {
    const over: Partial<LotBnafarDraft> = { ampp: code };
    if (presentation) {
      if (value.anvisa.trim() === "" && presentation.anvisa_registration) over.anvisa = presentation.anvisa_registration;
      if (!vaccine && !value.international && value.cnpj.trim() === "" && presentation.manufacturer_cnpj) over.cnpj = presentation.manufacturer_cnpj;
    }
    patch(over);
  }

  const price = field("unit_price_cents", "unit_price_cents");
  const cnpj = field("manufacturer_cnpj", "manufacturer_cnpj");
  const anvisa = field("anvisa_registration", "anvisa_registration");
  const program = field("health_program", "health_program");
  const name = field("manufacturer", "manufacturer_cnpj");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={row}>
        <label style={fieldLabel}>
          {price}
          <input value={value.unitPrice} inputMode="decimal" style={inputStyle} aria-label={label(price)} disabled={disabled}
            onChange={(e) => patch({ unitPrice: e.target.value })} />
          {err("unit_price_cents")}
        </label>
        {!vaccine && !value.international && (
          <label style={fieldLabel}>
            {cnpj}
            <input value={value.cnpj} style={inputStyle} aria-label={label(cnpj)} disabled={disabled} onChange={(e) => patch({ cnpj: e.target.value })} />
            {err("manufacturer_cnpj")}
          </label>
        )}
        {!vaccine && value.international && !externalName && (
          <label style={fieldLabel}>
            {name}
            <input value={value.internationalName} style={inputStyle} aria-label={label(name)} disabled={disabled}
              onChange={(e) => patch({ internationalName: e.target.value })} />
            {err("manufacturer")}
          </label>
        )}
        <label style={fieldLabel}>
          {anvisa}
          <input value={value.anvisa} inputMode="numeric" style={inputStyle} aria-label={label(anvisa)} disabled={disabled}
            onChange={(e) => patch({ anvisa: e.target.value })} />
          {err("anvisa_registration")}
        </label>
        {domains.isError ? <small role="alert" style={alert}>{PROGRAMS_ERROR}</small> : (
          <label style={fieldLabel}>
            {program}
            <select value={value.program} style={inputStyle} aria-label={label(program)} disabled={disabled} onChange={(e) => patch({ program: e.target.value })}>
              <option value="">Escolha o programa</option>
              {value.program && !known && <option value={value.program}>{value.program}</option>}
              {programs.map((p) => <option key={p.code} value={p.code}>{`${p.code} — ${p.label}`}</option>)}
            </select>
            {err("health_program")}
          </label>
        )}
      </div>
      {!vaccine && (
        <label style={checkLabel}>
          <input type="checkbox" checked={value.international} disabled={disabled} aria-label={label("Fabricante internacional (sem CNPJ)")}
            onChange={(e) => patch({ international: e.target.checked })} />
          Fabricante internacional (sem CNPJ)
        </label>
      )}
      {value.international && externalName && <small style={muted}>informe o nome no campo Fabricante</small>}
      {!vector && ampp && (
        <AmppPick vmpCode={vmpCode} value={value.ampp} disabled={disabled} onPick={pickAmpp} notice={domainOn}
          label={field("ampp_code", "ampp_code")} ariaLabel={label(field("ampp_code", "ampp_code"))} />
      )}
      {err("ampp_code")}
    </div>
  );
}
