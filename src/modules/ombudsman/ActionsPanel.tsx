// Ações da equipe sobre a manifestação (módulo 33; F-33.5, F-33.6). Um botão por ação de `availableActions` (a matriz decide
// o que aparece); o `can` do api decide se está habilitada, e o motivo do bloqueio fica escrito ao lado (`blockedReason`).
// Uma ação aberta por vez. Tela velha (`useManifestationAction`): a frase fica no painel, o detalhe é relido uma vez e o
// formulário aberto continua aberto, com o que foi digitado, só se a ação ainda couber no estado novo; senão fecha. Com uma
// chamada em voo, as outras ações ficam desabilitadas (nada de uma segunda escrita com o mesmo estado). Só classificar e
// encaminhar esperam as opções; as ações de texto abrem sem elas.
// As ações do ouvidor (prorrogar, arquivar, reabrir, resolutividade) seguem o mesmo molde; a ordem dos botões é a de `availableActions`.
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOmbudsmanOptions, type OmbudsmanActionName, type OmbudsmanManifestation, type OmbudsmanOptions } from "../../lib/api";
import { OMB_OPTIONS_KEY, STATIC_QUERY, availableActions, blockedReason, ombudsmanError, type OmbudsmanRoles } from "../../lib/ombudsman";
import { Panel } from "../../components/Panel";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, row, stack } from "../exams/styles";
import { ArchiveForm } from "./actions/ArchiveForm";
import { ClassifyForm } from "./actions/ClassifyForm";
import { ComplementForm } from "./actions/ComplementForm";
import { ExtendForm } from "./actions/ExtendForm";
import { ForwardForm } from "./actions/ForwardForm";
import { ReopenForm } from "./actions/ReopenForm";
import { RequestComplementForm } from "./actions/RequestComplementForm";
import { ResolutionForm } from "./actions/ResolutionForm";
import { ResponseForm } from "./actions/ResponseForm";
import { useManifestationAction, type RunAction } from "./useManifestationAction";

const LABELS: Partial<Record<OmbudsmanActionName, string>> = {
  classify: "Classificar", forward: "Encaminhar", request_complement: "Pedir complemento", complement: "Registrar complemento recebido",
  interim_response: "Resposta intermediária", final_response: "Resposta conclusiva", extend: "Prorrogar prazo", archive: "Arquivar",
  reopen: "Reabrir", change_resolution: "Alterar resolutividade"
};
// Precisam de `GET /ombudsman/options` (assuntos, unidades, setores, profissionais).
const NEEDS_OPTIONS: OmbudsmanActionName[] = [ "classify", "forward" ];

function ActionToggle({ label, open, reason, busy, onOpen }: {
  label: string; open: boolean; reason: string | null; busy: boolean; onOpen(): void;
}) {
  const reasonId = useId();
  const off = !!reason || busy;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" disabled={off} aria-expanded={open} aria-describedby={reason ? reasonId : undefined}
        style={off ? disabledButtonStyle : open ? buttonStyle : secondaryButtonStyle} onClick={onOpen}>{label}</button>
      {reason && <p id={reasonId} style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>{reason}</p>}
    </span>
  );
}

export function ActionsPanel({ m, roles, onChanged }: {
  m: OmbudsmanManifestation; roles: OmbudsmanRoles; onChanged(next: OmbudsmanManifestation | null): void;
}) {
  const { run, changedNotice, busy } = useManifestationAction(m, onChanged);
  const [ open, setOpen ] = useState<OmbudsmanActionName | null>(null);
  const actions = availableActions(m, roles).filter((a) => LABELS[a] !== undefined);
  const options = useQuery({ queryKey: [ OMB_OPTIONS_KEY ], queryFn: getOmbudsmanOptions, ...STATIC_QUERY, enabled: roles.staff });
  // A ação aberta ainda cabe no estado (que pode ter sido relido)?
  const shown = open !== null && actions.includes(open) && m.can[open] ? open : null;
  useEffect(() => { if (open !== null && shown === null) setOpen(null); }, [ open, shown ]);

  if (actions.length === 0 && !changedNotice) return null;
  const waiting = (a: OmbudsmanActionName) => NEEDS_OPTIONS.includes(a) && options.isPending;
  const toggles = actions.filter((a) => !waiting(a));
  const optionsError = options.isError ? ombudsmanError(options.error) : null;
  const reasonOf = (a: OmbudsmanActionName): string | null =>
    blockedReason(m, a) ?? (NEEDS_OPTIONS.includes(a) && optionsError ? optionsError : null);
  const done = () => setOpen(null);

  return (
    <Panel title="Ações">
      <div style={stack}>
        {changedNotice && <p role="alert" style={alert}>{changedNotice}</p>}
        {toggles.length > 0 && (
          <div style={{ ...row, alignItems: "flex-start" }}>
            {toggles.map((a) => (
              <ActionToggle key={a} label={LABELS[a] as string} open={shown === a} reason={reasonOf(a)} busy={busy} onOpen={() => setOpen(a)} />
            ))}
          </div>
        )}
        {actions.some(waiting) && <p className="mono" style={muted}>carregando as opções…</p>}
        {shown && <ActionForm action={shown} m={m} run={run} options={options.data} onDone={done} onClose={done} />}
      </div>
    </Panel>
  );
}

function ActionForm({ action, m, run, options, onDone, onClose }: {
  action: OmbudsmanActionName; m: OmbudsmanManifestation; run: RunAction; options: OmbudsmanOptions | undefined;
  onDone(): void; onClose(): void;
}) {
  const p = { m, run, onDone, onClose };
  switch (action) {
    case "classify": return options ? <ClassifyForm {...p} options={options} /> : null;
    case "forward": return options ? <ForwardForm {...p} options={options} /> : null;
    case "request_complement": return <RequestComplementForm {...p} />;
    case "complement": return <ComplementForm {...p} />;
    case "interim_response": return <ResponseForm {...p} final={false} />;
    case "final_response": return <ResponseForm {...p} final />;
    case "extend": return <ExtendForm {...p} />;
    case "archive": return <ArchiveForm {...p} />;
    case "reopen": return <ReopenForm {...p} />;
    case "change_resolution": return <ResolutionForm {...p} />;
    default: return null;
  }
}
