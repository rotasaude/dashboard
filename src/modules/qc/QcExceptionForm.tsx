// Exceção do RT/substituto para um item bloqueado pelo CIQ (spec §5.5;
// contrato §3; C-E4): justificativa obrigatória (10..1000, C-E11), com
// step-up (C-E39); a liberação continua a do 21b (mesma assinatura), e o
// laudo não muda. `not_blocked` = o bloqueio já fechou e 409 `conflict` = a
// exceção já existia: a tela trata os dois como resolvidos. A exceção é do
// par bloqueio × item (release_check.rb), não atravessa para outro bloqueio.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode, grantQcException } from "../../lib/api";
import { QC_BLOCKS_KEY, QC_BLOCK_COUNT_KEY, QC_EXCEPTIONS_KEY, qcError, reasonProblem } from "../../lib/qc";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, row, stack } from "../exams/styles";

const RESOLVED = new Set([ "not_blocked", "conflict" ]);

export function QcExceptionForm({ blockId, itemId, onDone, onCancel, onGoToSecurity }: {
  blockId: string; itemId: string; onDone(): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const queryClient = useQueryClient();
  const [ text, setText ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);

  function check() {
    const problem = reasonProblem(text, "a justificativa da exceção");
    setError(problem);
    if (!problem) setConfirming(true);
  }

  function done() {
    // Só depois da ação (nenhuma releitura automática); /count é a única com polling.
    for (const key of [ QC_BLOCKS_KEY, QC_BLOCK_COUNT_KEY, QC_EXCEPTIONS_KEY ]) void queryClient.invalidateQueries({ queryKey: [ key ] }).catch(() => undefined);
    onDone();
  }

  return (
    <div style={stack}>
      <fieldset disabled={confirming} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label style={fieldLabel}>Justificativa da exceção
          <textarea value={text} rows={2} style={inputStyle} onChange={(e) => setText(e.target.value)} />
        </label>
      </fieldset>
      {error && <p role="alert" style={alert}>{error}</p>}
      {!confirming && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={check}>Registrar exceção</button>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      )}
      {confirming && (
        <SensitiveAction title="Liberar com exceção" requiresStepUp confirmLabel="Confirmar exceção"
          description="O exame poderá ser liberado apesar do bloqueio do controle de qualidade; a justificativa fica registrada com o seu nome."
          run={async () => {
            try {
              await grantQcException({ block_id: blockId, item_id: itemId, justification: text.trim() });
            } catch (err) {
              if (!RESOLVED.has(errorCode(err) ?? "")) throw err;
            }
          }}
          onDone={done} onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={(err) => qcError(err)} />
      )}
    </div>
  );
}
