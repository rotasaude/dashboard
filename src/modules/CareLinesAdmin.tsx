// src/modules/CareLinesAdmin.tsx
// Linhas da cidade (contrato §3): o municipal_admin adota as linhas do
// catálogo-base (C2–C7), adota a versão nova de uma linha já adotada,
// ativa/desativa e cria ou edita linha própria (Task 5). Toda escrita com
// step-up. Versão nova do catálogo não muda as inscrições até a cidade adotá-la
// (spec §4): adotar a versão é o que muda a avaliação. Nada aqui inscreve ninguém.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adoptCareLine, errorCode, listCareTemplates, listCityCareLines, updateCareLine, type CareLine, type CareLineTemplate } from "../lib/api";
import { LINES_KEY, STATIC_QUERY, TEMPLATES_KEY, careLineError, conditionLabel, knownCareLineError, newerVersion, originText } from "../lib/careLines";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, row, stack } from "./exams/styles";
import { CareLinesGate } from "./careLines/CareLinesGate";

type Pending =
  | { kind: "adopt"; template: CareLineTemplate }
  | { kind: "upgrade"; line: CareLine; version: number }
  | { kind: "toggle"; line: CareLine }
  | null;

export function CareLinesAdmin({ onGoToSecurity }: { onGoToSecurity?(): void } = {}) {
  return (
    <CareLinesGate title="Linhas da cidade" sub="catálogo-base (C2–C7) e linhas próprias · administração municipal" allow={(r) => r.admin}>
      {() => <AdminBody onGoToSecurity={onGoToSecurity} />}
    </CareLinesGate>
  );
}

// O que cada confirmação diz e faz (spec 6a §3.5: dizer antes do Confirmar).
function confirmation(p: Exclude<Pending, null>): { title: string; description: string; confirmLabel: string; run(): Promise<unknown>; done: string } {
  if (p.kind === "adopt") return {
    title: `Adotar a linha ${p.template.name}`,
    description: "A linha entra no painel das equipes e nas sugestões a partir de agora. Nenhuma pessoa é inscrita sem um profissional confirmar.",
    confirmLabel: "Adotar linha", run: () => adoptCareLine(p.template.key, p.template.version), done: `Linha ${p.template.name} adotada.`
  };
  if (p.kind === "upgrade") return {
    title: `Adotar a versão ${p.version} de ${p.line.name}`,
    description: "As inscrições desta linha passam a ser avaliadas pelas boas práticas da versão nova. Ninguém é inscrito nem encerrado por isso.",
    confirmLabel: "Adotar versão", run: () => updateCareLine(p.line.id, { template_version: p.version }),
    done: `${p.line.name} agora usa a versão ${p.version}.`
  };
  return p.line.active ? {
    title: `Desativar ${p.line.name}`,
    description: "A linha sai do painel e das sugestões novas; as inscrições ficam guardadas e voltam se a linha for reativada.",
    confirmLabel: "Desativar linha", run: () => updateCareLine(p.line.id, { active: false }), done: `${p.line.name} desativada.`
  } : {
    title: `Ativar ${p.line.name}`, description: "A linha volta ao painel das equipes e às sugestões.",
    confirmLabel: "Ativar linha", run: () => updateCareLine(p.line.id, { active: true }), done: `${p.line.name} ativada.`
  };
}

function AdminBody({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: [ TEMPLATES_KEY ], queryFn: listCareTemplates, ...STATIC_QUERY });
  const lines = useQuery({ queryKey: [ LINES_KEY ], queryFn: listCityCareLines, ...STATIC_QUERY });
  const [ pending, setPending ] = useState<Pending>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const cityLines = lines.data ?? [];
  const adopted = new Map(cityLines.filter((l) => l.template_key).map((l) => [ l.template_key as string, l ]));
  const start = (next: Pending) => { setNotice(null); setPending(next); };
  const confirm = pending ? confirmation(pending) : null;

  return (
    <div style={stack}>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      <Panel title="Catálogo-base" sub="as seis linhas das notas metodológicas do componente de qualidade da APS">
        <div style={{ ...stack, padding: 16 }}>
          {templates.isPending && <p className="mono" style={muted}>carregando…</p>}
          {templates.isError && <p role="alert" style={alert}>{careLineError(templates.error)}</p>}
          {templates.data && (
            <DataTable<CareLineTemplate>
              cols={[
                { label: "Indicador", w: "90px", render: (t) => t.indicator },
                { label: "Linha", w: "2fr", card: "title", render: (t) => t.name },
                { label: "Versão", w: "80px", render: (t) => `v${t.version}` },
                { label: "Na cidade", w: "1.2fr", render: (t) => { if (!lines.data) return "—"; const l = adopted.get(t.key); return l ? `adotada · v${l.template_version ?? "—"}` : "não adotada"; } },
                {
                  label: "Ação", w: "1.2fr", card: "actions", render: (t) => {
                    // Sem a lista da cidade o catálogo não sabe o que já foi adotado: nada a oferecer.
                    if (!lines.data) return null;
                    const l = adopted.get(t.key);
                    if (!l) return <button type="button" style={buttonStyle} onClick={() => start({ kind: "adopt", template: t })}>Adotar</button>;
                    const newer = newerVersion(l, templates.data ?? []);
                    return newer === null ? null
                      : <button type="button" style={secondaryButtonStyle} onClick={() => start({ kind: "upgrade", line: l, version: newer })}>Adotar versão {newer}</button>;
                  }
                }
              ]}
              rows={templates.data} rowKey={(t) => t.key} empty="o catálogo-base está vazio"
            />
          )}
        </div>
      </Panel>
      <Panel title="Linhas da cidade" sub="as que o painel das equipes e as sugestões usam">
        <div style={{ ...stack, padding: 16 }}>
          {lines.isPending && <p className="mono" style={muted}>carregando…</p>}
          {lines.isError && <p role="alert" style={alert}>{careLineError(lines.error)}</p>}
          {lines.data && (cityLines.length === 0 ? <EmptyState title="nenhuma linha adotada ainda" /> : (
            <DataTable<CareLine>
              cols={[
                { label: "Linha", w: "2fr", card: "title", render: (l) => l.name },
                { label: "Origem", w: "1.4fr", render: (l) => originText(l) },
                { label: "Condição declarada", w: "1.1fr", render: (l) => (l.declared_condition ? conditionLabel(l.declared_condition) : "—") },
                { label: "Situação", w: "100px", render: (l) => <Tag tone={l.active ? "ok" : "neutral"}>{l.active ? "ativa" : "inativa"}</Tag> },
                {
                  label: "Ação", w: "1.4fr", card: "actions", render: (l) => (
                    <div style={row}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => start({ kind: "toggle", line: l })}>
                        {l.active ? "Desativar" : "Ativar"}
                      </button>
                    </div>
                  )
                }
              ]}
              rows={cityLines} rowKey={(l) => l.id}
            />
          ))}
        </div>
      </Panel>
      {pending && confirm && (
        <SensitiveAction
          key={confirm.title}
          title={confirm.title}
          description={confirm.description}
          requiresStepUp
          confirmLabel={confirm.confirmLabel}
          run={async () => { await confirm.run(); }}
          onDone={() => {
            setPending(null); setNotice(confirm.done);
            void queryClient.invalidateQueries({ queryKey: [ LINES_KEY ] });
          }}
          onCancel={() => setPending(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => {
            // A frase diz "já adotada"/"atualize a tela": a tela relê de fato.
            const code = errorCode(err);
            if (code === "duplicate_template" || code === "template_not_found") {
              void queryClient.invalidateQueries({ queryKey: [ LINES_KEY ] });
              void queryClient.invalidateQueries({ queryKey: [ TEMPLATES_KEY ] });
            }
            return knownCareLineError(err);
          }}
        />
      )}
    </div>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
