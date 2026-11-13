// src/modules/homeVisits/DeviceQrDialog.tsx
// QR do aparelho de campo recém-cadastrado (módulo 24b, F-24.17; D-15, Q20). O token só existe aqui: `created` chega por prop de quem
// o guarda num ref, vira QR (`toDataURL` do `qr_payload`) no estado local e some com o diálogo. O texto do token nunca vai ao DOM,
// ao cache, ao storage, ao console nem à URL. Fechar zera o `src` e avisa o pai, que zera o ref.
import { useEffect, useState } from "react";
import { toDataURL } from "qrcode";
import type { FieldDeviceCreated } from "../../lib/api";
import { useDialog } from "../../lib/useDialog";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, row } from "../exams/styles";

export const QR_WARNING = "Leia o QR agora no app de campo. Ele não aparece de novo: se fechar antes, revogue e cadastre outra vez.";
const QR_FAILED = "não foi possível desenhar o QR — feche, revogue o aparelho e cadastre outra vez";

const overlay = {
  position: "fixed", inset: 0, background: "color-mix(in srgb, var(--ink) 32%, transparent)", backdropFilter: "blur(2px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 80
} as const;
const panel = {
  width: "min(420px, 100%)", maxHeight: "100%", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--rule)",
  borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12
} as const;

export function DeviceQrDialog({ created, onClose }: { created: FieldDeviceCreated; onClose(): void }) {
  const [ src, setSrc ] = useState<string | null>(null);
  const [ failed, setFailed ] = useState(false);
  const ref = useDialog<HTMLDivElement>(true, close);
  const payload = created.qr_payload;

  useEffect(() => {
    let live = true;
    toDataURL(payload).then((url) => { if (live) setSrc(url); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [ payload ]);

  function close() {
    setSrc(null);
    onClose();
  }

  return (
    <div style={overlay}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="QR do aparelho de campo" style={panel}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{created.device.name}</p>
        {src && <img src={src} alt="QR do aparelho de campo" style={{ width: 240, height: 240, alignSelf: "center" }} />}
        {!src && !failed && <p role="status" style={muted}>Gerando o QR…</p>}
        {failed && <p role="alert" style={alert}>{QR_FAILED}</p>}
        <p style={muted}>{QR_WARNING}</p>
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={close}>Fechar</button></div>
      </div>
    </div>
  );
}
