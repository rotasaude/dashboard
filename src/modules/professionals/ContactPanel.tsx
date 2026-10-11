// Endereço e telefone do prescritor (módulo 19d; spec §5 e §7; contrato §5):
// impressos na receita de controle especial (obrigatórios; sem eles o api
// recusa com prescriber_address_missing) e na de antimicrobiano. Só o próprio
// profissional lê e grava. Leitura com gcTime 0 (dado pessoal).
import { useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getProfessionalContact, saveProfessionalContact } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { onlyDigits } from "../../lib/attendance";
import {
  CONTACT_KEY, EMPTY_ADDRESS_DRAFT, addressDraftFrom, addressInput, addressLine, addressProblem, controlledError, formatPhone, phoneProblem,
  type AddressDraft
} from "../../lib/controlled";
import { Panel } from "../../components/Panel";
import { KeyValue } from "../../components/KeyValue";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { AddressFields } from "../documents/AddressFields";
import { alertStyle, labelStyle, mutedStyle, rowStyle } from "../documents/formStyles";

export function ContactPanel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = [ CONTACT_KEY, user?.id ?? null ];
  const query = useQuery({ queryKey: key, queryFn: getProfessionalContact, gcTime: 0, retry: false });
  const [ editing, setEditing ] = useState(false);
  const [ address, setAddress ] = useState<AddressDraft>(EMPTY_ADDRESS_DRAFT);
  const [ phone, setPhone ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ saved, setSaved ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const savingRef = useRef(false);
  const data = query.data;
  const missing = !!data && (!data.address || !data.phone);

  function startEditing() {
    setAddress(addressDraftFrom(data?.address));
    setPhone(data?.phone ? formatPhone(data.phone) : "");
    setProblem(null); setSaved(false); setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    const found = addressProblem(address, "endereço") ?? phoneProblem(phone);
    if (found) { setProblem(found); return; }
    savingRef.current = true;
    setBusy(true); setProblem(null);
    try {
      const next = await saveProfessionalContact({ address: addressInput(address), phone: onlyDigits(phone) });
      queryClient.setQueryData(key, next);
      // O telefone é o mesmo `professionals.phone` de "Nome e contato".
      void queryClient.invalidateQueries({ queryKey: [ "myProfessional", user?.id ?? null ] });
      setEditing(false); setSaved(true);
    } catch (err) {
      setProblem(controlledError(err));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Panel title="Endereço e telefone na receita de controle especial" sub="impressos na receita de controle especial e na de antimicrobiano">
      <div style={body}>
        {query.isPending && <p className="mono" style={mutedStyle}>carregando…</p>}
        {query.isError && <p role="alert" style={alertStyle}>{controlledError(query.error)}</p>}
        {saved && <p role="status" style={statusStyle}>Endereço e telefone salvos.</p>}
        {data && !editing && (
          <>
            <div style={grid}>
              <KeyValue k="Endereço" v={addressLine(data.address)} mono={false} />
              <KeyValue k="Telefone" v={formatPhone(data.phone)} />
            </div>
            {missing && (
              <p role="note" style={{ ...mutedStyle, fontWeight: 600, color: "var(--warn)" }}>
                sem endereço e telefone, a receita de controle especial não sai — cadastre aqui
              </p>
            )}
            <div>
              <button type="button" style={missing ? buttonStyle : secondaryButtonStyle} onClick={startEditing}>
                {missing ? "Cadastrar endereço e telefone" : "Alterar endereço e telefone"}
              </button>
            </div>
          </>
        )}
        {editing && (
          <form aria-label="Endereço e telefone do prescritor" onSubmit={(e) => void save(e)} style={body}>
            <AddressFields legend="Endereço de atendimento" value={address} onChange={setAddress} />
            <label style={labelStyle}>
              Telefone
              <input inputMode="tel" value={phone} style={inputStyle} onChange={(e) => setPhone(e.target.value)} />
            </label>
            {problem && <p role="alert" style={alertStyle}>{problem}</p>}
            <div style={rowStyle}>
              <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Salvar</button>
              <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={() => setEditing(false)}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}

const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const grid: CSSProperties = { display: "flex", gap: 24, flexWrap: "wrap" };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
