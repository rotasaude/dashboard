// Aviso do Início para o liberador (spec §5.7): crítico liberado sem registro
// de quem foi avisado. Só a contagem; a lista abre na tela de liberação.
import { secondaryButtonStyle } from "../../components/formStyles";
import { box, row } from "../exams/styles";

export function LabCriticalNotice({ count, onOpen }: { count: number; onOpen(): void }) {
  if (count <= 0) return null;
  const text = count === 1
    ? "1 valor crítico liberado sem registro de aviso"
    : `${count} valores críticos liberados sem registro de aviso`;
  return (
    <div role="status" style={{ ...box, borderColor: "var(--down)" }}>
      <div style={row}>
        <strong>{text}</strong>
        <button type="button" style={secondaryButtonStyle} onClick={onOpen}>Registrar avisos</button>
      </div>
    </div>
  );
}
