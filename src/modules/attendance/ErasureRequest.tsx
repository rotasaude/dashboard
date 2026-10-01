import { useState } from "react";
import { requestErasure } from "../../lib/api";
import { attendanceError, isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { Panel } from "../../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";

// Exclusão do cadastro a pedido do cidadão (ADR 0026): o verificador registra
// o pedido no balcão, conferindo o documento com foto; quem apaga é um
// administrador (ErasureRequests). Se há registro de atendimento, a base legal
// retém o cadastro e nada é apagado.
export const PENDING_MESSAGE = "Pedido registrado. Um administrador precisa confirmar.";
export const RETAINED_MESSAGE = "Cadastro retido por base legal: há registro de atendimento. Nada foi apagado.";

export function ErasureRequest() {
  const [ cpf, setCpf ] = useState("");
  const [ checked, setChecked ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ done, setDone ] = useState<string | null>(null);

  const valid = isValidCpf(cpf) && checked;

  async function submit() {
    if (busy || !valid) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const { request } = await requestErasure(onlyDigits(cpf), true);
      setDone(request.status === "retained" ? RETAINED_MESSAGE : PENDING_MESSAGE);
      setCpf(""); setChecked(false);
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Exclusão de cadastro" sub="a pedido do cidadão, com documento">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 360 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
        {done && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{done}</p>}
        <label style={labelStyle}>
          CPF do cidadão (exclusão)
          <input value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} style={inputStyle} inputMode="numeric" />
        </label>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          Conferi o documento com foto
        </label>
        <div>
          <button type="button" disabled={!valid || busy} onClick={() => void submit()} style={(!valid || busy) ? disabledButtonStyle : buttonStyle}>
            Registrar pedido
          </button>
        </div>
      </div>
    </Panel>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
