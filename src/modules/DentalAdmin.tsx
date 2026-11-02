// CEO e lista do TSB/ASB (módulo 28, F-28.1). Toda escrita com step-up (SensitiveAction);
// o dado é de configuração da cidade, sem dado de paciente.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAuxiliaryProcedures, listCeoProfiles, putAuxiliaryProcedures, putCeoProfile,
  type AuxiliaryProcedure, type CeoProfile, type CeoSpecialty, type CeoType
} from "../lib/api";
import { AUX_PROCEDURES_KEY, CEO_PROFILES_KEY, CEO_SPECIALTIES, CEO_TYPES, STATIC_QUERY, dentalApiProblems, dentalError, procedureLabel } from "../lib/dental";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, checkLabel, fieldLabel, muted, okText, row, stack } from "./exams/styles";
import { DentalGate } from "./dental/DentalGate";
import { ProcedureSearch } from "./dental/ProcedureSearch";

type SecurityProp = { onGoToSecurity?(): void };

export function DentalAdmin({ onGoToSecurity }: SecurityProp = {}) {
  return (
    <DentalGate title="CEO e lista do TSB/ASB" sub="tipo e especialidades do CEO; o que TSB e ASB registram" allow={(r) => r.admin}>
      {() => (
        <div style={stack}>
          <CeoPanel onGoToSecurity={onGoToSecurity} />
          <AuxPanel onGoToSecurity={onGoToSecurity} />
        </div>
      )}
    </DentalGate>
  );
}

// Frase da recusa; o `path` do api, quando vem, aparece junto (nome de campo, nunca dado clínico).
function refusal(err: unknown): string {
  const problems = dentalApiProblems(err);
  if (problems.length === 0) return dentalError(err);
  return problems.map((p) => (p.path ? `${p.path}: ${p.text}` : p.text)).join("; ");
}

function CeoPanel({ onGoToSecurity }: SecurityProp) {
  const profiles = useQuery({ queryKey: [ CEO_PROFILES_KEY ], queryFn: listCeoProfiles, ...STATIC_QUERY });
  return (
    <Panel title="Unidades CEO" sub="tipo (I, II ou III) e especialidades ofertadas">
      {profiles.isError ? <p role="alert" style={alert}>{dentalError(profiles.error)}</p>
        : !profiles.data ? <p style={muted}>Carregando…</p>
        : profiles.data.length === 0 ? <EmptyState title="Nenhuma unidade CEO. Cadastre a unidade com o tipo CEO em Atendimento → Unidades." />
        : (
          <div style={stack}>
            {profiles.data.map((p) => <ProfileRow key={p.health_unit.id} profile={p} onGoToSecurity={onGoToSecurity} />)}
          </div>
        )}
    </Panel>
  );
}

function ProfileRow({ profile, onGoToSecurity }: { profile: CeoProfile } & SecurityProp) {
  const queryClient = useQueryClient();
  const name = profile.health_unit.name;
  const [ type, setType ] = useState<CeoType | "">(profile.ceo_type ?? "");
  const [ specialties, setSpecialties ] = useState<CeoSpecialty[]>(profile.specialties);
  const [ confirming, setConfirming ] = useState(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const toggle = (key: CeoSpecialty) => setSpecialties((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [ ...cur, key ]));

  function ask() {
    setNotice(null);
    if (!type) { setProblem("escolha o tipo do CEO"); setConfirming(false); return; }
    setProblem(null); setConfirming(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>{name}</strong>
      <label style={fieldLabel}>
        {`Tipo do CEO — ${name}`}
        <select value={type} style={inputStyle} onChange={(e) => { setType(e.target.value as CeoType | ""); setProblem(null); setConfirming(false); }}>
          <option value="">Escolha…</option>
          {CEO_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        {CEO_SPECIALTIES.map((s) => (
          <label key={s.key} style={checkLabel}>
            <input type="checkbox" checked={specialties.includes(s.key)} aria-label={`${s.label} — ${name}`}
              onChange={() => { toggle(s.key); setConfirming(false); }} />
            {s.label}
          </label>
        ))}
      </div>
      <div style={row}>
        <button type="button" style={buttonStyle} onClick={ask}>{`Salvar perfil — ${name}`}</button>
      </div>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {confirming && type && (
        <SensitiveAction
          title={`Confirmar o perfil de ${name}`}
          description={`Grava o tipo ${type} e ${specialties.length} especialidade(s) para ${name}. Muda as metas do painel do CEO.`}
          requiresStepUp
          run={async () => { await putCeoProfile(profile.health_unit.id, { ceo_type: type, specialties }); }}
          onDone={() => { setConfirming(false); setNotice("Perfil salvo."); void queryClient.invalidateQueries({ queryKey: [ CEO_PROFILES_KEY ] }); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={refusal}
        />
      )}
    </div>
  );
}

function AuxPanel({ onGoToSecurity }: SecurityProp) {
  const list = useQuery({ queryKey: [ AUX_PROCEDURES_KEY ], queryFn: getAuxiliaryProcedures, ...STATIC_QUERY });
  return (
    <Panel title="Procedimentos do TSB e do ASB" sub="lista da cidade">
      {list.isError ? <p role="alert" style={alert}>{dentalError(list.error)}</p>
        : !list.data ? <p style={muted}>Carregando…</p>
        : <AuxEditor initial={list.data} onGoToSecurity={onGoToSecurity} />}
    </Panel>
  );
}

function AuxEditor({ initial, onGoToSecurity }: { initial: AuxiliaryProcedure[] } & SecurityProp) {
  const queryClient = useQueryClient();
  const [ items, setItems ] = useState<AuxiliaryProcedure[]>(initial);
  const [ confirming, setConfirming ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);

  const add = (p: AuxiliaryProcedure) => { setConfirming(false); setNotice(null); setItems((cur) => (cur.some((i) => i.sigtap === p.sigtap) ? cur : [ ...cur, { sigtap: p.sigtap, name: p.name } ])); };
  const remove = (sigtap: string) => { setConfirming(false); setNotice(null); setItems((cur) => cur.filter((i) => i.sigtap !== sigtap)); };

  return (
    <div style={stack}>
      <p style={muted}>TSB e ASB registram só estes procedimentos e só dão baixa no plano com eles.</p>
      {items.length === 0 ? <p style={muted}>Lista vazia: TSB e ASB não registram procedimento.</p> : (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((i) => (
            <li key={i.sigtap} style={row}>
              <span>{procedureLabel(i.sigtap, i.name)}</span>
              <button type="button" style={secondaryButtonStyle} aria-label={`Remover ${i.sigtap}`} onClick={() => remove(i.sigtap)}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      <ProcedureSearch role="dentist" onPick={add} />
      <div style={row}>
        <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setConfirming(true); }}>Salvar lista</button>
      </div>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {confirming && (
        <SensitiveAction
          title="Confirmar a lista do TSB e do ASB"
          description={`Grava ${items.length} procedimento(s). A lista vale para a cidade inteira.`}
          requiresStepUp
          run={async () => { await putAuxiliaryProcedures(items.map((i) => i.sigtap)); }}
          onDone={() => { setConfirming(false); setNotice("Lista salva."); void queryClient.invalidateQueries({ queryKey: [ AUX_PROCEDURES_KEY ] }); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={refusal}
        />
      )}
    </div>
  );
}
