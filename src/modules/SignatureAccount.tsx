// src/modules/SignatureAccount.tsx
// Conta → Assinatura digital (módulo 19b; spec §5 "Vínculo" e §9; contrato
// §3). Procura o certificado em nuvem pelo CPF, vincula (step-up + ida ao
// prestador), troca e desvincula (step-up). Sem certificado, a pessoa segue no
// papel. O OAuth é todo do api: aqui só se segue o authorize_url.
import { useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  discoverCertificates, getCurrentCertificate, linkCertificate, unlinkCertificate,
  type CertificateDiscovery, type SignatureProvider
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import {
  CERTIFICATE_HELP, CERTIFICATE_KEY, PENDING_KEY, RETURN_TO, SESSION_KEY, SIGNATURE_DISABLED, SIMULATED_NOTICE, canSign, certificateNotice, fmtDay,
  goToProvider, isSimulatedProvider, providerLabel, signatureError, usesSimulatedPsc
} from "../lib/signature";
import { SensitiveAction } from "../components/SensitiveAction";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { KeyValue } from "../components/KeyValue";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../components/formStyles";
import { toneColor } from "../theme/tokens";

const PAPER = "Você continua assinando no papel: as consultas saem para impressão e assinatura à mão.";
const NONE_FOUND = "nenhum certificado em nuvem encontrado para o seu CPF nos prestadores habilitados — você continua no papel";

interface Props {
  onGoToSecurity?(): void;
  redirect?(url: string): void;
}

export function SignatureAccount({ onGoToSecurity, redirect = goToProvider }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const allowed = canSign(user);
  const cert = useQuery({ queryKey: [ CERTIFICATE_KEY, user?.id ], queryFn: getCurrentCertificate, enabled: allowed });
  const discover = useMutation({ mutationFn: discoverCertificates });
  const [ searching, setSearching ] = useState(false);
  const [ chosen, setChosen ] = useState<SignatureProvider | null>(null);
  const [ unlinking, setUnlinking ] = useState(false);
  const [ unlinked, setUnlinked ] = useState(false);

  if (!allowed) {
    return (
      <div style={page}>
        <PageHeader title="Assinatura digital" sub="conta · certificado ICP-Brasil em nuvem" />
        <EmptyState title={hasFeature(user, "digital_signature") ? "só profissionais de saúde assinam documentos" : SIGNATURE_DISABLED} />
      </div>
    );
  }

  const current = cert.data ?? null;
  const notice = current ? certificateNotice(current) : null;
  // R10: aviso do PSC simulado (interruptor ligado, certificado ou resultado da procura simulados).
  const simulated = usesSimulatedPsc(user) || isSimulatedProvider(current?.provider)
    || !!discover.data?.providers.some((p) => p.found && isSimulatedProvider(p.provider));

  function stopSearching() {
    setSearching(false); setChosen(null); discover.reset();
  }

  return (
    <div style={page}>
      <PageHeader title="Assinatura digital" sub="conta · certificado ICP-Brasil em nuvem" />
      <Panel title="Certificado">
        <div style={body}>
          {simulated && <div><Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag></div>}
          {unlinked && <p style={text}>certificado desvinculado</p>}
          {cert.isPending && <p style={muted}>carregando…</p>}
          {cert.isError && <p role="alert" style={alert}>{signatureError(cert.error)}</p>}
          {cert.isSuccess && current && (
            <>
              <div style={grid}>
                <KeyValue k="Prestador" v={providerLabel(current.provider)} />
                <KeyValue k="Emissor" v={current.issuer} mono={false} />
                <KeyValue k="Número de série" v={current.serial_number} />
                <KeyValue k="Válido até" v={fmtDay(current.not_after)} />
              </div>
              {notice && <p role="status" style={{ ...text, color: toneColor(notice.tone).fg }}>{notice.text}</p>}
              {!searching && !unlinking && (
                <div style={row}>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setSearching(true)}>Trocar certificado</button>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setUnlinking(true)}>Desvincular</button>
                </div>
              )}
              {unlinking && (
                <SensitiveAction
                  title="Desvincular certificado"
                  description="Os documentos já assinados continuam válidos. As próximas consultas voltam ao papel até você vincular outro certificado."
                  requiresStepUp
                  confirmLabel="Desvincular"
                  run={async () => { await unlinkCertificate(); }}
                  onDone={() => {
                    setUnlinking(false); setUnlinked(true);
                    void queryClient.invalidateQueries({ queryKey: [ CERTIFICATE_KEY ] });
                    // o api revoga a sessão ativa ao desvincular
                    void queryClient.invalidateQueries({ queryKey: [ SESSION_KEY ] });
                    void queryClient.invalidateQueries({ queryKey: [ PENDING_KEY ] });
                  }}
                  onCancel={() => setUnlinking(false)}
                  onGoToSecurity={onGoToSecurity}
                  translateError={signatureError}
                />
              )}
            </>
          )}
          {cert.isSuccess && !current && (
            <>
              <p style={text}>{PAPER}</p>
              <p style={muted}>{CERTIFICATE_HELP}</p>
              {!searching && (
                <div><button type="button" style={buttonStyle} onClick={() => setSearching(true)}>Procurar meu certificado</button></div>
              )}
            </>
          )}
        </div>
      </Panel>

      {searching && (
        <Panel title="Procurar certificado pelo CPF">
          <div style={body}>
            <p style={muted}>O Rota Saúde procura, pelo seu CPF, um certificado em nuvem em cada prestador habilitado.</p>
            {!discover.data && (
              <div style={row}>
                <button type="button" disabled={discover.isPending} style={discover.isPending ? disabledButtonStyle : buttonStyle}
                  onClick={() => discover.mutate()}>Procurar</button>
                <button type="button" style={secondaryButtonStyle} onClick={stopSearching}>Cancelar</button>
              </div>
            )}
            {discover.isError && <p role="alert" style={alert}>{signatureError(discover.error)}</p>}
            {discover.data && !chosen && <DiscoveryResult data={discover.data} onChoose={setChosen} onCancel={stopSearching} />}
            {chosen && (
              <SensitiveAction
                title={`Vincular certificado ${providerLabel(chosen)}`}
                description="Você vai ao prestador autorizar o uso do certificado. Ele precisa estar emitido para o seu CPF."
                requiresStepUp
                confirmLabel="Ir ao prestador"
                run={async () => {
                  const { authorize_url } = await linkCertificate(chosen, RETURN_TO.account);
                  redirect(authorize_url);
                }}
                onDone={() => undefined}
                onCancel={() => setChosen(null)}
                onGoToSecurity={onGoToSecurity}
                translateError={signatureError}
              />
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

function DiscoveryResult({ data, onChoose, onCancel }: {
  data: CertificateDiscovery; onChoose(p: SignatureProvider): void; onCancel(): void;
}) {
  const found = data.providers.filter((p) => p.found).map((p) => p.provider);
  const missing = data.providers.filter((p) => !p.found).map((p) => providerLabel(p.provider));
  return (
    <div style={body}>
      {found.length === 0 ? <p style={text}>{NONE_FOUND}</p> : (
        <ul aria-label="certificados encontrados" style={list}>
          {found.map((p) => (
            <li key={p}>
              <button type="button" style={buttonStyle} onClick={() => onChoose(p)}>{`Vincular ${providerLabel(p)}`}</button>
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && <p style={muted}>{`não encontrado em: ${missing.join(", ")}`}</p>}
      {data.unavailable.length > 0 && (
        <p style={muted}>{`sem resposta: ${data.unavailable.map(providerLabel).join(", ")} — procure de novo em alguns minutos`}</p>
      )}
      <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Fechar</button></div>
    </div>
  );
}

const page: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, fontSize: 12.5 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };
const row: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const list: CSSProperties = { margin: 0, padding: 0, listStyle: "none", display: "flex", gap: 8, flexWrap: "wrap" };
const text: CSSProperties = { margin: 0, fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
