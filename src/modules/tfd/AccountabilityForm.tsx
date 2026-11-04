// Prestação de contas do TFD (módulo 30, F-30.6; Review Focus 5). Só com o processo `travelling` e todos os trechos vivos
// realizados (o api recusa `legs_pending`); pede segundo fator e conclui o processo. O comprovante é conferido ANTES de ser lido
// (tamanho até 10 MB e tipo PDF/JPG/PNG): fora disso, nada é lido nem enviado. O nome do arquivo nunca aparece na tela nem vai no
// corpo (pode trazer o nome do paciente) — o cliente manda só o tipo e o conteúdo em base64. Concluído, o comprovante abre por um
// endereço curto (5 min) pedido no clique.
import { useId, useState } from "react";
import { ApiError, fetchTfdAccountabilityFile, getTfdAccountabilityUrl, uploadTfdAccountability, type TfdCase } from "../../lib/api";
import { accountabilityFileProblem, tfdError } from "../../lib/tfd";
import { cityIsoDate } from "../../lib/format";
import { fmtIsoDay } from "../../lib/transport";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, okText, row } from "../exams/styles";
import { refusalText } from "./stepUpText";

export const ACCOUNTABILITY_DONE = "Processo concluído com a prestação de contas.";
const LEGS_PENDING = "há trecho sem baixa — dê baixa antes da prestação de contas";
const FLEET_PENDING = "o trecho da frota fecha com a viagem — peça à central";
export const PROOF_POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para ver o comprovante";
const PROOF_MISSING = "o comprovante não está disponível — feche e abra o processo de novo";
const BLOB_TTL_MS = 60_000;

// Mesmo caminho do openExamPdf/openLabPdf: a janela abre no clique (depois de um await o navegador a trataria como pop-up), sem
// `opener`, e recebe o arquivo por um endereço blob:. Recusa (410 link_expired, 404) vira frase na tela, nunca JSON na aba.
async function openProofWindow(caseId: string): Promise<string | null> {
  const win = window.open("", "_blank");
  if (!win) return PROOF_POPUP_BLOCKED;
  try { win.opener = null; } catch { /* algumas janelas não deixam */ }
  try {
    const file = await fetchTfdAccountabilityFile(await getTfdAccountabilityUrl(caseId));
    const url = URL.createObjectURL(file.blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
    return null;
  } catch (err) {
    win.close();
    return err instanceof ApiError && err.status === 404 ? PROOF_MISSING : tfdError(err);
  }
}

function pendingLegsProblem(c: TfdCase): string | null {
  const open = c.legs.filter((l) => !l.voided && !l.done);
  if (open.length === 0) return null;
  return open.some((l) => l.mode !== "fleet") ? LEGS_PENDING : FLEET_PENDING;
}
const NO_FILE = "escolha o comprovante de comparecimento";
const KIND: Record<string, string> = { "application/pdf": "PDF", "image/png": "PNG", "image/jpeg": "JPG" };

export function AccountabilityForm({ tfdCase, onDone, onGoToSecurity }: { tfdCase: TfdCase; onDone(c: TfdCase): void; onGoToSecurity?(): void }) {
  const fileId = useId();
  const [ finished, setFinished ] = useState<TfdCase | null>(null);
  const [ file, setFile ] = useState<File | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ pending, setPending ] = useState(false);
  const [ opening, setOpening ] = useState(false);
  const [ openError, setOpenError ] = useState<string | null>(null);
  const c = finished && finished.id === tfdCase.id ? finished : tfdCase;

  function choose(list: FileList | null) {
    setFile(list?.[0] ?? null);
    setProblem(null);
    setPending(false);
  }

  function send() {
    if (pending) return;
    // Conferência antes de qualquer leitura do arquivo.
    const found = !file ? NO_FILE : accountabilityFileProblem(file) ?? pendingLegsProblem(c);
    setProblem(found);
    if (found === null) setPending(true);
  }

  async function openProof() {
    if (opening) return;
    setOpenError(null);
    setOpening(true);
    try {
      setOpenError(await openProofWindow(c.id));
    } finally {
      setOpening(false);
    }
  }

  if (c.accountability) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {finished && <p role="status" style={okText}>{ACCOUNTABILITY_DONE}</p>}
        <p style={muted}>{`comprovante enviado em ${fmtIsoDay(cityIsoDate(new Date(c.accountability.closed_at)))}`}</p>
        <div style={row}>
          <button type="button" disabled={opening} style={secondaryButtonStyle} onClick={() => void openProof()}>Abrir o comprovante</button>
        </div>
        <p style={muted}>o endereço vale por 5 minutos; se expirar, abra de novo</p>
        {openError && <p role="alert" style={alert}>{openError}</p>}
      </div>
    );
  }

  if (c.status !== "travelling") return <p style={muted}>a prestação de contas se faz com o processo em viagem e os trechos realizados</p>;

  return (
    <div style={form}>
      <p style={muted}>Envie o comprovante de comparecimento (PDF, JPG ou PNG, até 10 MB). O processo é concluído com ele.</p>
      <label style={fieldLabel} htmlFor={fileId}>Comprovante de comparecimento</label>
      <input id={fileId} type="file" accept="application/pdf,image/jpeg,image/png" disabled={pending} style={inputStyle}
        aria-invalid={problem ? true : undefined} onChange={(e) => choose(e.target.files)} />
      {file && <p style={muted}>{`arquivo escolhido: ${KIND[file.type] ?? "outro tipo"}, ${Math.ceil(file.size / 1024)} KB`}</p>}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {!pending && (
        <div style={row}><button type="button" style={buttonStyle} onClick={send}>Enviar e concluir o processo</button></div>
      )}
      {pending && file && (
        <SensitiveAction title="Confirmar prestação de contas" requiresStepUp onGoToSecurity={onGoToSecurity}
          description="O comprovante fica no processo e o processo é concluído; não dá para trocar depois."
          translateError={refusalText}
          run={async () => {
            let next: TfdCase;
            try {
              next = await uploadTfdAccountability(c.id, file);
            } catch (err) {
              // Segundo fator e sessão continuam com o SensitiveAction; outra recusa fecha a confirmação e libera o arquivo.
              if (err instanceof ApiError && err.status === 401) throw err;
              setProblem(refusalText(err));
              return;
            }
            setFinished(next);
            onDone(next);
          }}
          onDone={() => setPending(false)} onCancel={() => setPending(false)} />
      )}
    </div>
  );
}
