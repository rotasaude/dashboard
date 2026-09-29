// src/modules/campaigns/SmsSettingPanel.tsx
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSmsSetting, setSmsSetting, type SmsSetting } from "../../lib/api";
import { SMS_SETTING_KEY, campaignError, campaignErrorOrNull } from "../../lib/campaigns";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle } from "../../components/formStyles";
import { alertStyle, columnStyle, noteStyle, rowStyle, warnStyle } from "./styles";

// Chave de SMS da cidade (spec 2026-09-29 §7, D1): só o municipal_admin liga
// ou desliga, com step-up. Ligar sem provedor é permitido: os avisos saem e o
// SMS de cada destinatário fica "unavailable" — a tela avisa.
export const GATEWAY_WARNING =
  "A plataforma ainda não tem provedor de SMS: os avisos saem, o SMS fica pendente como não enviado";

export function SmsSettingPanel({ onGoToSecurity }: { onGoToSecurity(): void }) {
  const query = useQuery({ queryKey: SMS_SETTING_KEY, queryFn: getSmsSetting });
  return (
    <Panel title="SMS das campanhas" sub="chave da cidade · só o administrador municipal muda">
      {query.isError
        ? <p role="alert" style={alertStyle}>{campaignError(query.error)}</p>
        : query.isPending
          ? <p className="mono" style={noteStyle}>carregando…</p>
          : <SmsSwitch setting={query.data} onGoToSecurity={onGoToSecurity} />}
    </Panel>
  );
}

function SmsSwitch({ setting, onGoToSecurity }: { setting: SmsSetting; onGoToSecurity(): void }) {
  const queryClient = useQueryClient();
  const [ confirming, setConfirming ] = useState(false);
  const [ done, setDone ] = useState<string | null>(null);
  const result = useRef<SmsSetting | null>(null);
  const turningOn = !setting.enabled;

  return (
    <div style={columnStyle}>
      <div style={{ ...rowStyle, alignItems: "center" }}>
        <span style={{ fontSize: 13 }}>SMS nesta cidade:</span>
        <Tag tone={setting.enabled ? "ok" : undefined}>{setting.enabled ? "ligado" : "desligado"}</Tag>
        {!confirming && (
          <button type="button" style={buttonStyle} onClick={() => { setDone(null); setConfirming(true); }}>
            {turningOn ? "Ligar SMS" : "Desligar SMS"}
          </button>
        )}
      </div>
      <p style={noteStyle}>
        o SMS nunca leva o texto do aviso: só "você tem um aviso novo" e o link do wpda, entre 8h e 20h, para quem aceitou receber
      </p>
      {!setting.gateway_configured && <p role="note" style={warnStyle}>{GATEWAY_WARNING}</p>}
      {done && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{done}</p>}
      {confirming && (
        <SensitiveAction
          title={turningOn ? "Ligar o SMS das campanhas" : "Desligar o SMS das campanhas"}
          description={turningOn
            ? "Nas próximas campanhas, quem aceitou receber SMS ganha um SMS avisando que há um aviso novo no wpda."
            : "As próximas campanhas saem só como aviso no wpda. Campanha já enviada não muda."}
          requiresStepUp
          confirmLabel={turningOn ? "Ligar" : "Desligar"}
          run={async () => { result.current = await setSmsSetting(turningOn); }}
          onDone={() => {
            const next = result.current as SmsSetting;
            setConfirming(false);
            queryClient.setQueryData(SMS_SETTING_KEY, next);
            setDone(next.enabled ? "SMS ligado" : "SMS desligado");
          }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={campaignErrorOrNull}
        />
      )}
    </div>
  );
}
