// src/modules/signature/SignatureDetail.tsx
// O que foi assinado (módulo 19b; spec §5 "Validação", §7 e §9; contrato §6):
// quem, quando, política, validação e o JSON canônico; PDF assinado, pacote
// (.json + .p7s) e Revalidar. Ler passa pelo controle de acesso do prontuário
// no api (trilha `clinical_record.viewed`); o conteúdo some ao fechar (gcTime 0).
// Leitura administrativa (`readOnly`, Ruling R6): passa pelo step-up e mostra
// só o conteúdo — o api recusa PDF, pacote e Revalidar ao municipal_admin.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, fetchSignatureFile, getSignature, verifySignature,
  type SignatureDetail as Detail, type SignatureFileKind
} from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { CONSULTATION_KEY } from "../../lib/consultation";
import {
  SIGNATURE_KEY, SIMULATED_NOTICE, VERIFICATION_VIEW, saveBlob, signatureError, signatureFileName
} from "../../lib/signature";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props {
  id: string;
  readOnly?: boolean;
  onOpeningRequired?(): void;
  // Leitura administrativa: Cancelar no step-up fecha o detalhe.
  onClose?(): void;
}

export function SignatureDetail(props: Props) {
  return props.readOnly ? <AdministrativeDetail {...props} /> : <AuthorDetail {...props} />;
}

const verificationView = (v: string) => VERIFICATION_VIEW[v as Detail["verification"]] ?? { label: v, tone: "warn" };

function AdministrativeDetail({ id, onClose }: Props) {
  // Só em estado local: nada fica no cache depois de fechar.
  const [ detail, setDetail ] = useState<Detail | null>(null);
  const got = useRef<Detail | null>(null);
  if (detail) return <SignedContent s={detail} />;
  return (
    <SensitiveAction
      title="Leitura do que foi assinado"
      description="A leitura administrativa exige verificação em duas etapas e fica registrada no relatório de aberturas."
      requiresStepUp
      confirmLabel="Ver o conteúdo"
      run={async () => { got.current = await getSignature(id); }}
      onDone={() => { setDetail(got.current); got.current = null; }}
      onCancel={() => onClose?.()}
      translateError={signatureError}
    />
  );
}

function AuthorDetail({ id, onOpeningRequired }: Props) {
  const queryClient = useQueryClient();
  const key = [ SIGNATURE_KEY, id ];
  const query = useQuery({ queryKey: key, queryFn: () => getSignature(id), gcTime: 0, staleTime: 0 });
  const [ busy, setBusy ] = useState<SignatureFileKind | "verify" | null>(null);
  const [ message, setMessage ] = useState<string | null>(null);
  const [ failure, setFailure ] = useState<string | null>(null);
  const openingGone = query.isError && errorCode(query.error) === "opening_required";

  useEffect(() => {
    if (openingGone) onOpeningRequired?.();
  }, [ openingGone, onOpeningRequired ]);

  function fail(err: unknown) {
    if (errorCode(err) === "opening_required") onOpeningRequired?.();
    setFailure(signatureError(err));
  }

  async function download(kind: SignatureFileKind) {
    if (busy) return;
    setBusy(kind); setFailure(null); setMessage(null);
    try {
      // O nome do api (Ruling R5) vence; sem ele, um nome só com o id.
      const { blob, filename } = await fetchSignatureFile(id, kind);
      saveBlob(blob, filename ?? signatureFileName(id, kind));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function revalidate() {
    if (busy) return;
    setBusy("verify"); setFailure(null); setMessage(null);
    try {
      const fresh = await verifySignature(id);
      queryClient.setQueryData(key, fresh);
      setMessage(`revalidada: ${verificationView(fresh.verification).label}`);
      void queryClient.invalidateQueries({ queryKey: [ CONSULTATION_KEY ] });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  if (query.isPending) return <p style={muted}>carregando o que foi assinado…</p>;
  if (query.isError) return <p role="alert" style={alert}>{signatureError(query.error)}</p>;

  return (
    <SignedContent s={query.data}>
      {message && <p role="status" style={text}>{message}</p>}
      {failure && <p role="alert" style={alert}>{failure}</p>}
      <div style={row}>
        <button type="button" disabled={busy !== null} style={busy ? disabledButtonStyle : buttonStyle}
          onClick={() => void download("pdf")}>Baixar PDF assinado</button>
        <button type="button" disabled={busy !== null} style={secondaryButtonStyle}
          onClick={() => void download("package")}>Baixar .p7s</button>
        <button type="button" disabled={busy !== null} style={secondaryButtonStyle}
          onClick={() => void revalidate()}>Revalidar</button>
      </div>
      <p style={muted}>O pacote traz o documento (.json) e a assinatura (.p7s). Os dois arquivos podem ser conferidos em validar.iti.gov.br.</p>
    </SignedContent>
  );
}

function SignedContent({ s, children }: { s: Detail; children?: React.ReactNode }) {
  const verification = verificationView(s.verification);
  return (
    <section aria-label="O que foi assinado" style={panel}>
      {s.simulated && <div><Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag></div>}
      <div style={grid}>
        <KeyValue k="Assinado por" v={s.signer_name} mono={false} />
        <KeyValue k="CPF" v={s.signer_cpf_masked} />
        <KeyValue k="Assinado em" v={fmtDateTime(s.signed_at)} />
        <KeyValue k="Política" v={s.policy} />
      </div>
      <div style={row}>
        <Tag tone={verification.tone}>{verification.label}</Tag>
        <span style={muted}>{`verificada em ${fmtDateTime(s.verified_at)}`}</span>
      </div>
      {s.verification_reasons.length > 0 && <p style={muted}>{`motivos: ${s.verification_reasons.join(", ")}`}</p>}
      <pre aria-label="conteúdo assinado" style={pre}>{JSON.stringify(s.content, null, 2)}</pre>
      {children}
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 };
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const pre: CSSProperties = {
  margin: 0, padding: 10, maxHeight: 320, overflow: "auto", fontSize: 11.5, background: "var(--sunken)",
  border: "1px solid var(--rule)", borderRadius: 6, whiteSpace: "pre-wrap"
};
const text: CSSProperties = { margin: 0, fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
