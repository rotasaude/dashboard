// Escolha da apresentação (AMPP) entre as do VMP do item (módulo 27b; contrato Q15, Q43). O AMPP nunca é digitado: vem da lista do
// `GET /pharmacy/obm_presentations?vmp_code=`, lida ao abrir e sem polling. Sem VMP no catálogo não há o que escolher: a entrada segue
// e o lote cai nas pendências do envio (o AMPP só é exigido quando o item tem VMP).
import { useQuery } from "@tanstack/react-query";
import { listObmPresentations, type ObmPresentation } from "../../lib/api";
import { BNAFAR_PRESENTATIONS_KEY, STATIC_QUERY, bnafarError } from "../../lib/bnafar";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted } from "../exams/styles";

export const NO_VMP_TEXT = "este produto ainda não tem VMP no catálogo — a entrada segue, e o lote fica nas pendências do envio";

// `notice`: o aviso de sem VMP só vale onde o domínio do item está em `enabled_domains` (quem chama decide).
export function AmppPick({ vmpCode, value, onPick, disabled = false, label = "Apresentação (AMPP)", ariaLabel, notice = true }: {
  vmpCode: string | null | undefined; value: string; onPick(presentation: ObmPresentation | null, code: string): void;
  disabled?: boolean; label?: string; ariaLabel?: string; notice?: boolean;
}) {
  const query = useQuery({
    queryKey: [ BNAFAR_PRESENTATIONS_KEY, vmpCode ], queryFn: () => listObmPresentations(vmpCode ?? ""), enabled: !!vmpCode, ...STATIC_QUERY
  });
  if (!vmpCode) return notice ? <small style={muted}>{NO_VMP_TEXT}</small> : null;
  const items = query.data ?? [];
  const known = items.some((p) => p.ampp_code === value);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={fieldLabel}>
        {label}
        <select value={value} style={inputStyle} aria-label={ariaLabel ?? label} disabled={disabled || query.isPending}
          onChange={(e) => onPick(items.find((p) => p.ampp_code === e.target.value) ?? null, e.target.value)}>
          <option value="">{query.isPending ? "carregando…" : "Escolha a apresentação"}</option>
          {value && !known && <option value={value}>{value}</option>}
          {items.map((p) => <option key={p.ampp_code} value={p.ampp_code}>{`${p.description} · AMPP ${p.ampp_code}`}</option>)}
        </select>
      </label>
      {query.isError && <p role="alert" style={alert}>{bnafarError(query.error)}</p>}
    </div>
  );
}
