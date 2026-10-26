// src/modules/TerritoryMicroAreas.tsx
// Microáreas (módulo 24a; contrato §3; F-24.1): o municipal_admin cria,
// renomeia, troca o ACS e desativa/reativa as microáreas das equipes 70/76.
// Código e nome são conferidos aqui antes da confirmação (recusar, nunca
// cortar) e de novo no api; toda escrita passa pelo step-up. Código e equipe
// nunca mudam depois de criados. Desativar não apaga domicílio nem cadastro.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMicroArea, errorCode, listMicroAreas, listTerritoryAdminTeams, updateMicroArea,
  type MicroArea, type MicroAreaInput, type TerritoryAdminTeam
} from "../lib/api";
import {
  ADMIN_TEAMS_KEY, MICRO_AREAS_KEY, MICRO_AREA_NAME_MAX, STATIC_QUERY, microAreaCodeProblem, microAreaNameProblem, teamName, territoryError
} from "../lib/territoryRegistry";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, form, muted, row, stack } from "./exams/styles";
import { TerritoryGate } from "./territory/TerritoryGate";

type Pending =
  | { kind: "create"; input: MicroAreaInput }
  | { kind: "rename"; area: MicroArea; name: string }
  | { kind: "acs"; area: MicroArea; id: string | null }
  | { kind: "toggle"; area: MicroArea }
  | null;

// O formulário aberto (o que está na tela); a confirmação não o apaga:
// cancelar ou uma recusa do api devolvem o que foi digitado.
type Editor =
  | { kind: "create"; code: string; name: string; acs: string }
  | { kind: "rename"; area: MicroArea; name: string }
  | { kind: "acs"; area: MicroArea; acs: string }
  | null;

export function TerritoryMicroAreas({ onGoToSecurity }: { onGoToSecurity?: () => void } = {}) {
  return (
    <TerritoryGate title="Microáreas" sub="cadastro territorial · microáreas das equipes e o ACS responsável" allow={(r) => r.admin}>
      {() => <MicroAreasBody onGoToSecurity={onGoToSecurity} />}
    </TerritoryGate>
  );
}

const NOTHING_CHANGED = { name: "nada mudou: o nome é o mesmo", acs: "nada mudou: o ACS é o mesmo" };
const squish = (value: string) => value.replace(/\s+/g, " ").trim();
const teamLabel = (t: TerritoryAdminTeam) => `${teamName(t)} · INE ${t.ine}`;

// O que cada confirmação diz e faz (spec 6a §3.5: dizer antes do Confirmar).
function confirmation(p: Exclude<Pending, null>, team: TerritoryAdminTeam | undefined): {
  title: string; description: string; confirmLabel: string; run(): Promise<unknown>; done: string;
} {
  const acsName = (id: string | null | undefined) =>
    (id ? team?.acs_candidates.find((c) => c.professional_id === id)?.name ?? "o ACS escolhido" : "nenhum");
  if (p.kind === "create") return {
    title: `Criar a microárea ${p.input.code}`,
    description: `${p.input.name}, na equipe ${team ? teamName(team) : "selecionada"}. ACS responsável: ${acsName(p.input.acs_professional_id)}. O código não muda depois de criado.`,
    confirmLabel: "Criar microárea", run: () => createMicroArea(p.input), done: `Microárea ${p.input.code} criada.`
  };
  if (p.kind === "rename") return {
    title: `Renomear a microárea ${p.area.code}`,
    description: `De "${p.area.name}" para "${p.name}". Domicílios e cadastros continuam na mesma microárea.`,
    confirmLabel: "Renomear microárea", run: () => updateMicroArea(p.area.id, { name: p.name }), done: `Microárea ${p.area.code} renomeada.`
  };
  if (p.kind === "acs") return {
    title: `Trocar o ACS da microárea ${p.area.code}`,
    description: `De ${p.area.acs?.name ?? "nenhum"} para ${acsName(p.id)}. O ACS responsável é quem grava as fichas da microárea, junto com enfermeiro e médico da equipe.`,
    confirmLabel: "Trocar ACS", run: () => updateMicroArea(p.area.id, { acs_professional_id: p.id }),
    done: `ACS da microárea ${p.area.code} trocado.`
  };
  return p.area.active ? {
    title: `Desativar a microárea ${p.area.code}`,
    description: "Os domicílios ficam guardados; a microárea some das novas fichas.",
    confirmLabel: "Desativar microárea", run: () => updateMicroArea(p.area.id, { active: false }), done: `Microárea ${p.area.code} desativada.`
  } : {
    title: `Reativar a microárea ${p.area.code}`,
    description: "A microárea volta às novas fichas da equipe, com os domicílios que já tinha.",
    confirmLabel: "Reativar microárea", run: () => updateMicroArea(p.area.id, { active: true }), done: `Microárea ${p.area.code} reativada.`
  };
}

function MicroAreasBody({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const teams = useQuery({ queryKey: [ ADMIN_TEAMS_KEY ], queryFn: listTerritoryAdminTeams, ...STATIC_QUERY });
  const [ chosenTeam, setChosenTeam ] = useState<string | null>(null);
  const teamList = teams.data ?? [];
  const team = teamList.find((t) => t.id === chosenTeam) ?? teamList[0];
  const teamId = team?.id ?? null;
  const areas = useQuery({
    queryKey: [ MICRO_AREAS_KEY, teamId ], queryFn: () => listMicroAreas(teamId as string), enabled: teamId !== null, ...STATIC_QUERY
  });
  const [ editor, setEditor ] = useState<Editor>(null);
  const [ formError, setFormError ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const open = (next: Editor) => { setNotice(null); setFormError(null); setPending(null); setEditor(next); };
  const edit = (patch: Partial<Exclude<Editor, null>>) => {
    setFormError(null);
    setEditor((e) => (e ? { ...e, ...patch } as Editor : e));
  };
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: [ MICRO_AREAS_KEY ] }); };

  // Código e nome conferidos antes da confirmação; a escrita fica no SensitiveAction.
  function review() {
    if (!editor || !team) return;
    if (editor.kind === "create") {
      const problem = microAreaCodeProblem(editor.code.trim()) ?? microAreaNameProblem(editor.name);
      if (problem) { setFormError(problem); return; }
      const input: MicroAreaInput = { team_id: team.id, code: editor.code.trim(), name: editor.name.trim() };
      if (editor.acs) input.acs_professional_id = editor.acs;
      setPending({ kind: "create", input });
    } else if (editor.kind === "rename") {
      const problem = microAreaNameProblem(editor.name);
      if (problem) { setFormError(problem); return; }
      // O api compara sem espaços repetidos: o mesmo nome não pede step-up nem diz "renomeada".
      if (squish(editor.name) === squish(editor.area.name)) { setFormError(NOTHING_CHANGED.name); return; }
      setPending({ kind: "rename", area: editor.area, name: editor.name.trim() });
    } else {
      const id = editor.acs || null;
      if (id === (editor.area.acs?.professional_id ?? null)) { setFormError(NOTHING_CHANGED.acs); return; }
      setPending({ kind: "acs", area: editor.area, id });
    }
  }

  const confirm = pending ? confirmation(pending, team) : null;
  const candidates = team?.acs_candidates ?? [];
  const acsSelect = (value: string, emptyLabel: string) => (
    <label style={fieldLabel}>
      ACS responsável
      <select value={value} style={inputStyle} onChange={(e) => edit({ acs: e.target.value })}>
        <option value="">{emptyLabel}</option>
        {candidates.map((c) => (
          <option key={c.professional_id} value={c.professional_id} disabled={!c.has_cns}>
            {c.has_cns ? c.name : `${c.name} (sem CNS)`}
          </option>
        ))}
      </select>
    </label>
  );

  if (teams.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (teams.isError) return <p role="alert" style={alert}>{territoryError(teams.error)}</p>;
  if (!team) return <EmptyState title="nenhuma equipe de saúde da família (70) ou de atenção primária (76) ativa na cidade" />;

  return (
    <div style={stack}>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      <label style={{ ...fieldLabel, maxWidth: 480 }}>
        Equipe
        <select value={team.id} style={inputStyle}
          onChange={(e) => { setChosenTeam(e.target.value); setEditor(null); setPending(null); setNotice(null); }}>
          {teamList.map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)}
        </select>
      </label>
      <Panel title="Microáreas da equipe" sub={`${team.unit.name} · o ACS responsável grava as fichas da microárea`}
        right={<button type="button" style={secondaryButtonStyle} onClick={() => open({ kind: "create", code: "", name: "", acs: "" })}>Nova microárea</button>}>
        <div style={{ ...stack, padding: 16 }}>
          {areas.isPending && <p className="mono" style={muted}>carregando…</p>}
          {areas.isError && <p role="alert" style={alert}>{territoryError(areas.error)}</p>}
          {areas.data && (
            <DataTable<MicroArea>
              cols={[
                { label: "Código", w: "80px", card: "title", render: (a) => a.code },
                { label: "Nome", w: "2fr", render: (a) => a.name },
                { label: "ACS", w: "1.4fr", render: (a) => a.acs?.name ?? "sem ACS" },
                { label: "Situação", w: "100px", render: (a) => <Tag tone={a.active ? "ok" : "neutral"}>{a.active ? "ativa" : "inativa"}</Tag> },
                {
                  label: "Ação", w: "2fr", card: "actions", render: (a) => (
                    <div style={row}>
                      <button type="button" style={secondaryButtonStyle} aria-label={`Renomear ${a.code}`}
                        onClick={() => open({ kind: "rename", area: a, name: a.name })}>Renomear</button>
                      <button type="button" style={secondaryButtonStyle} aria-label={`Trocar ACS ${a.code}`}
                        onClick={() => open({ kind: "acs", area: a, acs: currentAcs(a, candidates) })}>Trocar ACS</button>
                      <button type="button" style={secondaryButtonStyle} aria-label={`${a.active ? "Desativar" : "Reativar"} ${a.code}`}
                        onClick={() => { open(null); setPending({ kind: "toggle", area: a }); }}>{a.active ? "Desativar" : "Reativar"}</button>
                    </div>
                  )
                }
              ]}
              rows={areas.data} rowKey={(a) => a.id} empty="nenhuma microárea nesta equipe ainda"
            />
          )}
        </div>
      </Panel>
      {editor && !pending && (
        <section aria-label={editorTitle(editor)} style={box}>
          <strong>{editorTitle(editor)}</strong>
          <div style={form}>
            {editor.kind === "create" && (
              <>
                {text("Código", editor.code, (v) => edit({ code: v }), "dois dígitos, de 01 a 99; não muda depois de criado")}
                {text("Nome", editor.name, (v) => edit({ name: v }), `até ${MICRO_AREA_NAME_MAX} caracteres`)}
                {acsSelect(editor.acs, "nenhum por enquanto")}
                {candidates.length === 0 && <span style={hintStyle}>a equipe não tem agente comunitário (CBO 515105) ativo</span>}
              </>
            )}
            {editor.kind === "rename" &&
              text("Novo nome", editor.name, (v) => edit({ name: v }), `até ${MICRO_AREA_NAME_MAX} caracteres`)}
            {editor.kind === "acs" && (
              <>
                <p style={muted}>ACS atual: {editor.area.acs?.name ?? "nenhum"}</p>
                {acsSelect(editor.acs, "sem ACS (tira o responsável)")}
              </>
            )}
            {formError && <p role="alert" style={alert}>{formError}</p>}
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={review}>Continuar</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => open(null)}>Cancelar</button>
            </div>
          </div>
        </section>
      )}
      {pending && confirm && (
        <SensitiveAction
          key={confirm.title}
          title={confirm.title}
          description={confirm.description}
          requiresStepUp
          confirmLabel={confirm.confirmLabel}
          run={async () => { await confirm.run(); }}
          onDone={() => { setPending(null); setEditor(null); setNotice(confirm.done); refresh(); }}
          onCancel={() => setPending(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => {
            // A frase manda recarregar ou diz que já existe: a tela relê de fato.
            const code = errorCode(err);
            if (code === "duplicate_code" || code === "not_found") refresh();
            if (code === "not_found" || code === "acs_not_in_team" || code === "acs_without_cns") {
              void queryClient.invalidateQueries({ queryKey: [ ADMIN_TEAMS_KEY ] });
            }
            return territoryError(err);
          }}
        />
      )}
    </div>
  );
}

// O ACS atual só vem pré-escolhido se ainda for candidato válido da equipe.
function currentAcs(area: MicroArea, candidates: TerritoryAdminTeam["acs_candidates"]): string {
  const id = area.acs?.professional_id;
  return id && candidates.some((c) => c.professional_id === id && c.has_cns) ? id : "";
}

function editorTitle(e: Exclude<Editor, null>): string {
  if (e.kind === "create") return "Nova microárea";
  if (e.kind === "rename") return `Renomear a microárea ${e.area.code}`;
  return `Trocar o ACS da microárea ${e.area.code}`;
}

function text(label: string, value: string, onChange: (v: string) => void, hint: string) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label style={fieldLabel}>
        {label}
        <input value={value} style={inputStyle} onChange={(e) => onChange(e.target.value)} />
      </label>
      <span style={hintStyle}>{hint}</span>
    </div>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
const hintStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink3)" };
