// Aviso no Início para quem pede exames (spec §5 "Alertas"): resultados
// aguardando a ciência dele e exames negados pela regulação.
import { pendingNoticeText } from "../../lib/exams";
import { secondaryButtonStyle } from "../../components/formStyles";
import { row } from "./styles";

export function AcknowledgementNotice({ pending, denied, hasMore = false, onOpen }: { pending: number; denied: number; hasMore?: boolean; onOpen(): void }) {
  const text = pendingNoticeText(pending, denied, hasMore);
  if (!text) return null;
  return (
    <section aria-label="Seus exames"
      style={{ ...row, gap: 12, padding: 12, marginBottom: 16, border: "1px solid var(--rule)", borderRadius: 8, background: "var(--sunken)" }}>
      <p role="status" style={{ margin: 0, fontSize: 13, color: "var(--ink)" }}>{text}</p>
      <button type="button" style={secondaryButtonStyle} onClick={onOpen}>Ver resultados</button>
    </section>
  );
}
