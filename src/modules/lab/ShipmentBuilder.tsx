// src/modules/lab/ShipmentBuilder.tsx
// Remessa da UBS (spec §5.3): a caixa é montada lendo as etiquetas (só na
// tela, sem chamar o api a cada leitura), com a temperatura, e enviada.
// Criar e enviar são duas chamadas: se o envio falhar, a remessa fica
// montada e aparece em "Remessas montadas" para reenviar.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createShipment, errorCode, sendShipment, type LabShipment } from "../../lib/api";
import { labError, parseTemperature, refreshLab, temperatureProblem } from "../../lib/lab";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ScanField, type ScanOutcome } from "./ScanField";
import { alert, fieldLabel, list, muted, okText, row, stack } from "../exams/styles";

export function shipmentErrorText(err: unknown): string {
  const body = (err as { body?: { barcode?: unknown } } | null)?.body;
  const code = errorCode(err) ? body?.barcode : undefined;
  return typeof code === "string" ? `${code}: ${labError(err)}` : labError(err);
}

export function ShipmentBuilder({ unitId, providerId, onSent }: { unitId: string; providerId: string; onSent(s: LabShipment | null): void }) {
  const queryClient = useQueryClient();
  const [ barcodes, setBarcodesState ] = useState<string[]>([]);
  // Espelho síncrono da lista: o ScanField pode entregar duas leituras antes
  // de um re-render, e a decisão "incluída" × "já está" não pode ler estado velho.
  const listRef = useRef<string[]>([]);
  const setBarcodes = (next: string[]) => { listRef.current = next; setBarcodesState(next); };
  const [ temperature, setTemperature ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  async function add(code: string): Promise<ScanOutcome> {
    if (listRef.current.includes(code)) return { ok: false, text: "já está nesta remessa" };
    setBarcodes([ ...listRef.current, code ]);
    return { ok: true, text: "incluída" };
  }

  async function send() {
    const problem = barcodes.length === 0 ? "leia ao menos uma etiqueta" : temperatureProblem(temperature);
    if (problem) { setError(problem); return; }
    setError(null);
    setNotice(null);
    let created: LabShipment;
    try {
      created = await createShipment({ origin_unit_id: unitId, provider_id: providerId, barcodes, temperature_celsius: parseTemperature(temperature) as number });
    } catch (err) {
      setError(shipmentErrorText(err));
      return;
    }
    // A remessa já existe: as listas (montadas, pendências da UBS) mudaram, enviar ou não.
    refreshLab(queryClient).catch(() => undefined);
    try {
      const sent = await sendShipment(created.id);
      refreshLab(queryClient).catch(() => undefined);
      setNotice(`Remessa enviada com ${barcodes.length} amostra${barcodes.length === 1 ? "" : "s"}.`);
      setBarcodes([]);
      setTemperature("");
      onSent(sent);
    } catch (err) {
      setError(`remessa montada, mas não enviada (${labError(err)}) — envie de novo em "Remessas montadas"`);
      setBarcodes([]);
      onSent(null);
    }
  }

  return (
    <div style={stack}>
      <ScanField label="Etiqueta do tubo para a remessa" onScan={add} hint="Leia cada tubo que vai na caixa." />
      {barcodes.length > 0 && (
        <ul aria-label="na remessa" style={list}>
          {barcodes.map((b) => (
            <li key={b} style={row}>
              <span className="mono">{b}</span>
              <button type="button" style={secondaryButtonStyle} aria-label={`Tirar ${b}`}
                onClick={() => setBarcodes(listRef.current.filter((x) => x !== b))}>Tirar</button>
            </li>
          ))}
        </ul>
      )}
      {barcodes.length === 0 && <p style={muted}>nenhum tubo lido ainda</p>}
      <label style={fieldLabel}>
        Temperatura da caixa (°C)
        <input value={temperature} inputMode="decimal" style={inputStyle} onChange={(e) => setTemperature(e.target.value)} />
      </label>
      <div><ActionButton onClick={send}>{`Enviar remessa (${barcodes.length})`}</ActionButton></div>
      {error && <p role="alert" style={alert}>{error}</p>}
      {notice && <p role="status" style={okText}>{notice}</p>}
    </div>
  );
}
