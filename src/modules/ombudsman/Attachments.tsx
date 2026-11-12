// Anexos da manifestação (módulo 33; Q2, Q14): o detalhe só traz `{ id, uploaded_by }` — a tela mostra "Anexo N" (ordem da
// lista) e quem enviou, nunca o nome do arquivo nem o tipo. Na identificada, técnico e ouvidor abrem direto pelo endereço curto;
// na preservada e na anônima só o ouvidor abre, com justificativa (`onProtected` abre o `IdentityDialog`; o api dá 403 aos outros).
import { useRef, useState } from "react";
import { getOmbudsmanAttachmentUrl, type OmbudsmanAttachment, type OmbudsmanManifestation } from "../../lib/api";
import { ombudsmanError, type OmbudsmanRoles } from "../../lib/ombudsman";
import { Panel } from "../../components/Panel";
import { disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, list, muted, row } from "../exams/styles";
import { openFile } from "./openFile";

const uploadedBy = (a: OmbudsmanAttachment): string => (a.uploaded_by === "staff" ? "enviado pela equipe" : "enviado pelo cidadão");

export function Attachments({ m, roles, onProtected }: {
  m: OmbudsmanManifestation; roles: OmbudsmanRoles; onProtected(a: OmbudsmanAttachment, opener: HTMLElement): void;
}) {
  const [ error, setError ] = useState<string | null>(null);
  // Sem duplo envio: o pedido do endereço grava trilha no api. Um pedido por anexo de cada vez (ref para o clique repetido antes
  // de a tela redesenhar; estado para desabilitar o botão). `window.open` continua no clique que passa (dentro de `openFile`).
  const inFlight = useRef(new Set<string>());
  const [ busy, setBusy ] = useState<string[]>([]);
  const open = async (a: OmbudsmanAttachment) => {
    if (inFlight.current.has(a.id)) return;
    inFlight.current.add(a.id);
    setBusy((b) => [ ...b, a.id ]);
    setError(null);
    try {
      setError(await openFile(() => getOmbudsmanAttachmentUrl(a.id), ombudsmanError));
    } finally {
      inFlight.current.delete(a.id);
      setBusy((b) => b.filter((x) => x !== a.id));
    }
  };
  const identified = m.identification_mode === "identified";
  if (m.attachments.length === 0) return <Panel title="Anexos"><p style={muted}>sem anexos</p></Panel>;
  return (
    <Panel title="Anexos">
      <ul style={list}>
        {m.attachments.map((a, i) => {
          const n = i + 1;
          return (
            <li key={a.id}>
              <div style={row}>
                <strong>{`Anexo ${n}`}</strong>
                <span style={muted}>{uploadedBy(a)}</span>
                {identified && roles.staff && (
                  <button type="button" style={busy.includes(a.id) ? disabledButtonStyle : secondaryButtonStyle}
                    disabled={busy.includes(a.id)} onClick={() => void open(a)}>{`Abrir anexo ${n}`}</button>
                )}
                {!identified && roles.lead && (
                  <button type="button" style={secondaryButtonStyle} onClick={(ev) => onProtected(a, ev.currentTarget)}>{`Abrir anexo ${n} (justificar)`}</button>
                )}
                {!identified && !roles.lead && <span style={muted}>anexo protegido — só o ouvidor abre</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" style={alert}>{error}</p>}
    </Panel>
  );
}
