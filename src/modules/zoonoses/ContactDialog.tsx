// src/modules/zoonoses/ContactDialog.tsx
// Contato do tutor do animal agressor (módulo 35b, F-35.14; Q12). `getObservationContact` é chamado DIRETO, só no clique (sem
// useQuery, sem setQueryData): nome, telefone e endereço ficam só no estado deste componente, nunca no queryClient, em storage ou
// na URL, e somem ao fechar (Fechar ou Escape, pelo useDialog) ou ao desmontar. O api grava a trilha; não há step-up a mais.
import { useEffect, useRef, useState } from "react";
import { useDialog } from "../../lib/useDialog";
import { getObservationContact, type ObservationContact } from "../../lib/api";
import { isZoonosesStale, zoonosesError } from "../../lib/zoonoses";
import { ActionButton } from "../../components/ActionButton";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, row } from "../exams/styles";

export const CONTACT_DESCRIPTION = "A leitura fica registrada na trilha. Use o contato só para acompanhar o animal.";
export const NO_CONTACT = "sem dado no cadastro";

export function ContactDialog({ observationId, onClose, onStale }: { observationId: string; onClose?(): void; onStale?(err: unknown): void }) {
  const [ contact, setContact ] = useState<ObservationContact | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const alive = useRef(true);
  const sending = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function close() {
    setContact(null);
    onClose?.();
  }
  const dialogRef = useDialog<HTMLElement>(!!contact, close, trigger.current);

  async function read() {
    if (sending.current || contact) return;
    sending.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const c = await getObservationContact(observationId);
      if (alive.current) setContact(c);
    } catch (err) {
      if (!alive.current) return;
      setProblem(zoonosesError(err));
      if (isZoonosesStale(err)) onStale?.(err);
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <>
      <button ref={trigger} type="button" style={secondaryButtonStyle} aria-expanded={!!contact} aria-disabled={busy || !!contact || undefined}
        onClick={() => void read()}>Ver contato do tutor</button>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {contact && (
        <section ref={dialogRef} role="dialog" aria-label="Contato do tutor" style={box}>
          <strong>Contato do tutor</strong>
          <p style={muted}>Nome</p>
          <strong>{contact.animal_tutor_name ?? NO_CONTACT}</strong>
          <p style={muted}>Telefone</p>
          <strong>{contact.animal_tutor_phone ?? NO_CONTACT}</strong>
          <p style={muted}>Endereço do animal</p>
          <strong>{contact.animal_address ?? NO_CONTACT}</strong>
          <p style={muted}>{CONTACT_DESCRIPTION}</p>
          <div style={row}><ActionButton variant="secondary" onClick={close}>Fechar</ActionButton></div>
        </section>
      )}
    </>
  );
}
