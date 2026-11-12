// Depois do registro pela equipe (módulo 33; F-33.4): o protocolo e o prazo, e o comprovante para impressão. O comprovante leva
// só protocolo, tipo, canal, data de recebimento e prazo (`GET …/receipt`) — nunca texto, nome, CPF ou contato. É lido ao
// aparecer, para a janela de impressão abrir NO CLIQUE sem esperar o api (molde de `printDocument`); bloqueada, a frase
// POPUP_BLOCKED. A denúncia anônima não tem comprovante (o api responde 404): só a frase e "Registrar outra".
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOmbudsmanReceipt, type IdentificationMode, type OmbudsmanCreated, type OmbudsmanReceipt } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtDateTime } from "../../lib/format";
import { NOMINAL_QUERY, NO_RECEIPT_ANONYMOUS, channelLabel, kindLabel, ombudsmanError } from "../../lib/ombudsman";
import { Panel } from "../../components/Panel";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, row, stack } from "../exams/styles";
import { printSheet } from "./printSheet";

export type CreatedManifestation = OmbudsmanCreated & { identification_mode: IdentificationMode };

const OMB_RECEIPT_KEY = "ombudsmanReceipt";
const SHEET_TITLE = "Comprovante de manifestação — Ouvidoria da Saúde";
const KEEP_NUMBER = "Guarde este número para acompanhar a sua manifestação.";
const protocolStyle = { margin: 0, fontSize: 28, fontWeight: 600 } as const;
const headingStyle = { margin: 0, fontSize: 14 } as const;

export const receiptRows = (r: OmbudsmanReceipt): [ string, string ][] => [
  [ "Protocolo", r.protocol ],
  [ "Tipo", kindLabel(r.kind) ],
  [ "Canal", channelLabel(r.channel) ],
  [ "Recebida em", fmtDateTime(r.received_at) ],
  [ "Prazo de resposta", fmtDay(r.due_on) ]
];

export function Receipt({ created, onNew, onOpen }: { created: CreatedManifestation; onNew(): void; onOpen(): void }) {
  const anonymous = created.identification_mode === "anonymous";
  const receipt = useQuery({
    queryKey: [ OMB_RECEIPT_KEY, created.id ], queryFn: () => getOmbudsmanReceipt(created.id), ...NOMINAL_QUERY, enabled: !anonymous
  });
  const [ printError, setPrintError ] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  // O formulário sumiu: o foco vai ao resultado.
  useEffect(() => { headingRef.current?.focus(); }, []);

  if (anonymous) {
    return (
      <Panel title="Denúncia registrada">
        <div style={stack}>
          <h2 ref={headingRef} tabIndex={-1} style={headingStyle}>{NO_RECEIPT_ANONYMOUS}</h2>
          <div style={row}><button type="button" style={buttonStyle} onClick={onNew}>Registrar outra</button></div>
        </div>
      </Panel>
    );
  }

  const ready = receipt.data !== undefined;
  const print = () => {
    if (!receipt.data) return;
    setPrintError(printSheet(SHEET_TITLE, receiptRows(receipt.data), [ { title: "", text: KEEP_NUMBER } ]));
  };
  return (
    <Panel title="Manifestação registrada">
      <div style={stack}>
        <h2 ref={headingRef} tabIndex={-1} style={headingStyle}>Protocolo</h2>
        <p className="mono" style={protocolStyle}>{created.protocol}</p>
        <p style={muted}>{`Prazo de resposta: ${fmtDay(created.due_on)}`}</p>
        {receipt.isError && <p role="alert" style={alert}>{ombudsmanError(receipt.error)}</p>}
        {printError && <p role="alert" style={alert}>{printError}</p>}
        <div style={row}>
          <button type="button" style={ready ? buttonStyle : disabledButtonStyle} disabled={!ready} onClick={print}>Imprimir comprovante</button>
          {receipt.isError && (
            <button type="button" style={secondaryButtonStyle} onClick={() => { void receipt.refetch(); }}>Ler o comprovante de novo</button>
          )}
          <button type="button" style={secondaryButtonStyle} onClick={onOpen}>Abrir a manifestação</button>
          <button type="button" style={secondaryButtonStyle} onClick={onNew}>Registrar outra</button>
        </div>
      </div>
    </Panel>
  );
}
