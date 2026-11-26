// Correção de saída externa já aceita pela BNAFAR (módulo 27b; contrato §3 "Recusas e correções"; Q8, Q25, Q44): `POST
// /pharmacy/bnafar/records/:id/correct`, só o `municipal_admin`, com step-up. Vale para a saída INTEIRA (Q8). Abre com o tipo e o destino
// atuais da saída (`getExternalExit`); a `expected_version` é a `stock_external_exit_version` do registro (Q44, sempre a da leitura do
// detalhe). Só o que mudou vai no corpo (o resto vem da saída atual, no api). `409 external_exit_changed` (e as outras recusas 409 do
// prazo, e o 404 do registro de outro ambiente, Q35) mostram a frase pelo `onStale`, que relê o detalhe uma vez, e a saída é relida
// também: o resumo e a base da diferença passam aos valores novos; o digitado fica e nada é reenviado sozinho. O rascunho só nasce de
// uma leitura feita depois de abrir (nunca do cache). O SensitiveAction fica FORA do <form> (sem formulário aninhado).
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, correctBnafarRecord, errorCode, getExternalExit, type BnafarCorrectionInput, type BnafarDomains, type BnafarRecord, type ExternalExit, type ExternalExitType } from "../../lib/api";
import { EXTERNAL_EXITS_KEY, STATIC_QUERY, bnafarError, bnafarErrorText, cnesProblem, cnpjProblem, docOf, exitTypeLabel, isStale } from "../../lib/bnafar";
import { SensitiveAction } from "../../components/SensitiveAction";
import { inputStyle, secondaryButtonStyle, buttonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";

// Frases (proposta).
export const CORRECTION_SENT = "Correção enviada. A BNAFAR substitui os registros desta saída.";
const NOTHING_CHANGED = "mude o tipo ou o destino da saída antes de corrigir";
const REASON_LENGTH = "o motivo da correção tem de 10 a 500 caracteres";
const DESCRIPTION = "A correção vale para a saída inteira: a BNAFAR substitui todos os registros desta saída pelos dados novos.";
const FALLBACK_TYPES: ExternalExitType[] = [ "S-DF", "S-TR", "S-D", "S-E" ];
// 409 do registro: a frase e uma releitura (o registro pode ter saído da janela ou ter sido corrigido por outra pessoa).
const STALE_CODES = [ "external_exit_changed", "correction_window_closed", "not_correctable" ];
// Q35: registro de outro ambiente (o ambiente trocou enquanto a tela estava aberta) volta 404.
export const RECORD_GONE = "este registro não está mais no ambiente em uso — a remessa foi relida";
function staleText(err: unknown): string | null {
  const code = STALE_CODES.find((c) => isStale(err, c));
  if (code) return bnafarErrorText(code);
  return err instanceof ApiError && err.status === 404 && errorCode(err) === "not_found" ? RECORD_GONE : null;
}

type Draft = { exitType: string; destinationKind: "cnes" | "cnpj"; destination: string; reason: string };

const length = (s: string): number => Array.from(s).length;

function problemsOf(d: Draft, exit: ExternalExit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!d.exitType) out.exit_type = "escolha o tipo da saída";
  const dest = d.destinationKind === "cnes" ? cnesProblem(d.destination) : cnpjProblem(d.destination);
  if (dest) out.destination_code = dest;
  const n = length(d.reason.trim());
  if (n < 10 || n > 500) out.reason = REASON_LENGTH;
  if (!out.exit_type && !out.destination_code && !changedType(d, exit) && !changedDestination(d, exit)) out.general = NOTHING_CHANGED;
  return out;
}
const changedType = (d: Draft, exit: ExternalExit): boolean => d.exitType !== exit.exit_type;
const changedDestination = (d: Draft, exit: ExternalExit): boolean =>
  d.destinationKind !== exit.destination_kind || (docOf(d.destination) ?? d.destination) !== exit.destination_code;

export function CorrectionForm({ record, domains, onDone, onCancel, onGoToSecurity, onStale }: {
  record: BnafarRecord; domains: BnafarDomains | null | undefined;
  onDone(): void; onCancel(): void; onGoToSecurity?(): void;
  // A frase do 409 e a releitura do detalhe (uma vez), na tela que mostra os registros.
  onStale(text: string): void;
}) {
  const exitId = record.stock_external_exit_id ?? "";
  const client = useQueryClient();
  const exit = useQuery({ queryKey: [ EXTERNAL_EXITS_KEY, "detail", exitId ], queryFn: () => getExternalExit(exitId), enabled: !!exitId, ...STATIC_QUERY });
  const [ draft, setDraft ] = useState<Draft | null>(null);
  const [ errors, setErrors ] = useState<Record<string, string>>({});
  const [ confirming, setConfirming ] = useState(false);

  // Abre com os valores atuais da saída, lidos depois de abrir, uma vez; a releitura depois de um 409 não apaga o digitado.
  useEffect(() => {
    if (exit.data && exit.isFetchedAfterMount && !draft) {
      setDraft({ exitType: exit.data.exit_type, destinationKind: exit.data.destination_kind, destination: exit.data.destination_code, reason: "" });
    }
  }, [ exit.data, exit.isFetchedAfterMount, draft ]);

  if (exit.isError) return <p role="alert" style={alert}>{bnafarError(exit.error)}</p>;
  if (!exit.data || !draft) return <p className="mono" style={muted}>carregando a saída…</p>;
  const current = exit.data;
  const set = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setConfirming(false); };
  const types = domains?.exit_types.map((t) => t.code) ?? FALLBACK_TYPES;
  const typeOptions = types.includes(current.exit_type) ? types : [ current.exit_type, ...types ];

  function review() {
    const found = problemsOf(draft!, current);
    setErrors(found);
    setConfirming(Object.keys(found).length === 0);
  }

  // O SensitiveAction desabilita o Confirmar enquanto a chamada corre: o duplo clique manda um pedido só.
  async function run() {
    const d = draft!;
    const body: BnafarCorrectionInput = { expected_version: record.stock_external_exit_version ?? current.version, reason: d.reason.trim() };
    if (changedType(d, current)) body.exit_type = d.exitType as ExternalExitType;
    if (changedDestination(d, current)) { body.destination_kind = d.destinationKind; body.destination_code = docOf(d.destination) ?? d.destination; }
    try {
      await correctBnafarRecord(record.id, body);
    } catch (err) {
      const text = staleText(err);
      if (text) { setConfirming(false); onStale(text); void exit.refetch(); }
      throw err;
    }
  }

  const ids = `corr-${record.id}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form aria-label={`Corrigir saída — ${record.item_label}`} noValidate style={form} onSubmit={(e) => { e.preventDefault(); review(); }}>
        <p style={muted}>
          Saída externa de <strong>{current.location.name}</strong>: {exitTypeLabel(domains, current.exit_type)} para{" "}
          {current.destination_kind === "cnes" ? "o CNES" : "o CNPJ"} <span className="mono">{current.destination_code}</span>.
        </p>
        <div style={fieldLabel}>
          <label style={fieldLabel}>
            Tipo da saída
            <select value={draft.exitType} style={inputStyle} aria-invalid={!!errors.exit_type} aria-describedby={errors.exit_type ? `${ids}-type` : undefined}
              onChange={(e) => set({ exitType: e.target.value })}>
              {typeOptions.map((code) => <option key={code} value={code}>{exitTypeLabel(domains, code)}</option>)}
            </select>
          </label>
          {errors.exit_type && <span id={`${ids}-type`} style={alert}>{errors.exit_type}</span>}
        </div>
        <div style={{ ...row, alignItems: "flex-start" }}>
          <label style={fieldLabel}>
            Destino
            <select value={draft.destinationKind} style={inputStyle} onChange={(e) => set({ destinationKind: e.target.value as Draft["destinationKind"] })}>
              <option value="cnes">CNES (estabelecimento de saúde)</option>
              <option value="cnpj">CNPJ</option>
            </select>
          </label>
          <div style={fieldLabel}>
            <label style={fieldLabel}>
              Código do destino
              <input value={draft.destination} style={inputStyle} aria-invalid={!!errors.destination_code}
                aria-describedby={errors.destination_code ? `${ids}-dest` : undefined} onChange={(e) => set({ destination: e.target.value })} />
            </label>
            {errors.destination_code && <span id={`${ids}-dest`} style={alert}>{errors.destination_code}</span>}
          </div>
        </div>
        <div style={fieldLabel}>
          <label style={fieldLabel}>
            Por que corrigir
            <textarea rows={3} value={draft.reason} style={inputStyle} aria-invalid={!!errors.reason}
              aria-describedby={errors.reason ? `${ids}-reason` : undefined} onChange={(e) => set({ reason: e.target.value })} />
          </label>
          {errors.reason && <span id={`${ids}-reason`} style={alert}>{errors.reason}</span>}
        </div>
        {errors.general && <p role="alert" style={alert}>{errors.general}</p>}
        {!confirming && (
          <div style={row}>
            <button type="submit" style={buttonStyle}>Corrigir</button>
            <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
          </div>
        )}
      </form>
      {confirming && (
        <SensitiveAction
          title="Corrigir a saída externa"
          description={DESCRIPTION}
          requiresStepUp
          confirmLabel="Confirmar correção"
          run={run}
          onDone={() => { setConfirming(false); void client.invalidateQueries({ queryKey: [ EXTERNAL_EXITS_KEY, "detail", exitId ] }); onDone(); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => bnafarError(err, { write: true })}
        />
      )}
    </div>
  );
}
