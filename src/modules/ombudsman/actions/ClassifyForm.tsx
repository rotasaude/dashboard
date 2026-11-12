// Classificar / reclassificar (`received`, `in_analysis`; `classify.rb`): assunto de primeiro nível e, se ele tem
// subassuntos ativos, o subassunto (senão `subject_not_leaf`); tipo (a anônima continua denúncia: o campo não aparece);
// unidade referida; profissional (de `options.professionals`, filtrado pela unidade — não há rota de profissionais, D8);
// urgente. O corpo leva `subject_id` sempre e só os outros campos que mudaram (o api grava o antes e o depois); `null` limpa
// unidade e profissional. Tela velha: depois da releitura, o campo que a pessoa não tocou volta a mostrar o detalhe novo (e por
// isso não vai no corpo); o que ela mudou fica como ela deixou. Senão o reenvio desfaria o que o colega acabou de gravar.
import { useEffect, useRef, useState } from "react";
import type { OmbudsmanKind, OmbudsmanOptions } from "../../../lib/api";
import { OMBUDSMAN_ERRORS, kindLabel } from "../../../lib/ombudsman";
import type { Problem } from "../../../lib/pharmacy";
import { inputStyle } from "../../../components/formStyles";
import { checkLabel, fieldLabel, form, row } from "../../exams/styles";
import { useActionForm, type ActionFormProps } from "../useManifestationAction";
import { FormButtons, formTitle } from "./TextActionForm";

const KINDS: OmbudsmanKind[] = [ "complaint", "report", "praise", "suggestion", "request" ];
const OWN = [ "subject_id", "kind", "health_unit_id", "professional_id", "urgent" ];
const FIELDS = { health_unit_id: "escolha uma unidade ativa", subject_id: "escolha um assunto ativo" };
type Field = "subject" | "kind" | "unit" | "professional" | "urgent";

export function ClassifyForm({ m, options, run, onDone, onClose }: ActionFormProps & { options: OmbudsmanOptions }) {
  const f = useActionForm(FIELDS);
  const { aria, errNode, busy } = f;
  const anonymous = m.identification_mode === "anonymous";
  const [ parent, setParent ] = useState(m.subject ? m.subject.parent?.id ?? m.subject.id : "");
  const [ child, setChild ] = useState(m.subject?.parent ? m.subject.id : "");
  const [ kind, setKind ] = useState<OmbudsmanKind>(m.kind);
  const [ unit, setUnit ] = useState(m.health_unit?.id ?? "");
  const [ professional, setProfessional ] = useState(m.referred_professional?.id ?? "");
  const [ urgent, setUrgent ] = useState(m.urgent);
  // Os campos que a pessoa mexeu; os outros seguem o `m` quando ele muda (releitura depois de 409/`invalid_transition`).
  const touched = useRef(new Set<Field>());
  const touch = (...fields: Field[]) => { for (const x of fields) touched.current.add(x); };
  useEffect(() => {
    const t = touched.current;
    if (!t.has("subject")) { setParent(m.subject ? m.subject.parent?.id ?? m.subject.id : ""); setChild(m.subject?.parent ? m.subject.id : ""); }
    if (!t.has("kind")) setKind(m.kind);
    if (!t.has("unit")) setUnit(m.health_unit?.id ?? "");
    if (!t.has("professional")) setProfessional(m.referred_professional?.id ?? "");
    if (!t.has("urgent")) setUrgent(m.urgent);
  }, [ m ]);

  const chosen = options.subjects.find((s) => s.id === parent);
  const children = chosen?.children ?? [];
  const inUnit = (unitId: string) => options.professionals.filter((p) => unitId === "" || p.health_unit_ids.includes(unitId));
  const professionals = inUnit(unit);
  // O profissional já gravado, se saiu das opções (vínculo encerrado), continua escolhível — o api só confere o que muda.
  const current = m.referred_professional;
  const shownProfessionals = current && professional === current.id && !professionals.some((p) => p.id === current.id)
    ? [ ...professionals, current ] : professionals;

  const check = (): Problem[] => {
    if (!chosen) return [ { path: "subject_id", text: "escolha o assunto" } ];
    if (children.length > 0 && !children.some((c) => c.id === child)) return [ { path: "subject_id", text: OMBUDSMAN_ERRORS.subject_not_leaf } ];
    return [];
  };
  const body = (): Record<string, unknown> => {
    const out: Record<string, unknown> = { subject_id: children.length > 0 ? child : parent };
    if (!anonymous && kind !== m.kind) out.kind = kind;
    const unitId = unit || null;
    if (unitId !== (m.health_unit?.id ?? null)) out.health_unit_id = unitId;
    const professionalId = professional || null;
    if (professionalId !== (current?.id ?? null)) out.professional_id = professionalId;
    if (urgent !== m.urgent) out.urgent = urgent;
    return out;
  };

  return (
    <form ref={f.formRef} aria-label="Classificar" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, { check, call: () => run("classify", body()), ok: onDone, stale: () => {} });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>Classificar</p>
      {f.top((path) => OWN.includes(path))}
      <div style={row}>
        <label style={fieldLabel}>
          Assunto
          <select value={parent} style={inputStyle} {...(children.length > 0 ? {} : aria("subject_id"))}
            onChange={(ev) => { touch("subject"); f.clear("subject_id"); setParent(ev.target.value); setChild(""); }}>
            <option value="">Escolha o assunto</option>
            {options.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {children.length > 0 && (
          <label style={fieldLabel}>
            Subassunto
            <select value={child} style={inputStyle} {...aria("subject_id")}
              onChange={(ev) => { touch("subject"); f.clear("subject_id"); setChild(ev.target.value); }}>
              <option value="">Escolha o subassunto</option>
              {children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {errNode("subject_id")}
      {!anonymous && (
        <>
          <label style={fieldLabel}>
            Tipo
            <select value={kind} style={inputStyle} {...aria("kind")}
              onChange={(ev) => { touch("kind"); f.clear("kind"); setKind(ev.target.value as OmbudsmanKind); }}>
              {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
            </select>
          </label>
          {errNode("kind")}
        </>
      )}
      <div style={row}>
        <label style={fieldLabel}>
          Unidade
          <select value={unit} style={inputStyle} {...aria("health_unit_id")}
            onChange={(ev) => {
              const next = ev.target.value;
              touch("unit");
              f.clear("health_unit_id", "professional_id");
              setUnit(next);
              if (professional && !inUnit(next).some((p) => p.id === professional)) { touch("professional"); setProfessional(""); }
            }}>
            <option value="">sem unidade</option>
            {options.health_units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Profissional
          <select value={professional} style={inputStyle} {...aria("professional_id")}
            onChange={(ev) => { touch("professional"); f.clear("professional_id"); setProfessional(ev.target.value); }}>
            <option value="">sem profissional</option>
            {shownProfessionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      {errNode("health_unit_id")}{errNode("professional_id")}
      <label style={checkLabel}>
        <input type="checkbox" checked={urgent} {...aria("urgent")} onChange={(ev) => { touch("urgent"); f.clear("urgent"); setUrgent(ev.target.checked); }} />
        Urgente
      </label>
      {errNode("urgent")}
      <FormButtons busy={busy} submit="Salvar classificação" onClose={onClose} />
    </form>
  );
}
