// Quem manifesta, no registro pela equipe (módulo 33; Q6, Q22, Q58, Q60; D6). Dois lados que nunca vão juntos (o api recusa a
// mistura): o cidadão achado pelo CPF (`citizen_id`) ou os campos informados (`manifestant_*`: nome, contato e o CPF digitado).
// - A busca é `POST /ombudsman/person_lookup` (CPF só no corpo, nunca na URL) e só acha par verificado; sem ele vem `null` e a
//   frase manda registrar nome e contato. Achado: nome e CPF mascarado, e os campos informados são apagados. "Trocar" volta à
//   busca vazia.
// - Os campos informados ficam à vista sempre que não há cidadão: quem liga sem dar CPF também é registrado pelo nome (Q22).
// - Resposta de uma busca cujo CPF já mudou na tela é descartada. Sem duplo envio (`busy` + ref). Nada em storage.
import { useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { lookupOmbudsmanPerson, type OmbudsmanPerson } from "../../lib/api";
import { isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { OMBUDSMAN_ERRORS, ombudsmanError } from "../../lib/ombudsman";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";
import type { FieldAria } from "./actions/ExtractField";

export const PERSON_NOT_FOUND = "ninguém com este CPF confirmado — registre nome e contato na manifestação";

export type PersonValue = { cpf: string; person: OmbudsmanPerson | null; name: string; contact: string; missed: boolean };
export const EMPTY_PERSON: PersonValue = { cpf: "", person: null, name: "", contact: "", missed: false };

// O que o formulário empresta (o `useFormProblems` dele): marcas e frases por path.
export type PersonFormBits = { aria(path: string): FieldAria; errNode(path: string): ReactNode; clear(...paths: string[]): void };

const join = (...ids: (string | null | undefined)[]): string | undefined => ids.filter(Boolean).join(" ") || undefined;
const merge = (...as: FieldAria[]): FieldAria => {
  const invalid = as.some((a) => a["aria-invalid"]);
  return { ...(invalid ? { "aria-invalid": true as const } : {}), "aria-describedby": join(...as.map((a) => a["aria-describedby"])) };
};

export function PersonPick({ value, setValue, f, disabled = false }: {
  value: PersonValue; setValue: Dispatch<SetStateAction<PersonValue>>; f: PersonFormBits; disabled?: boolean;
}) {
  const uid = useId();
  const [ lookupError, setLookupError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function search() {
    if (sending.current) return;
    if (!isValidCpf(value.cpf)) { setLookupError(OMBUDSMAN_ERRORS.invalid_cpf); return; }
    const digits = onlyDigits(value.cpf);
    sending.current = true;
    setBusy(true);
    setLookupError(null);
    try {
      const found = await lookupOmbudsmanPerson(digits);
      if (!alive.current) return;
      // O CPF mudou enquanto a busca corria: a resposta é de outra pessoa.
      setValue((v) => {
        if (onlyDigits(v.cpf) !== digits) return v;
        return found ? { ...v, person: found, name: "", contact: "", missed: false } : { ...v, person: null, missed: true };
      });
      if (found) f.clear("person", "citizen_id", "manifestant_name", "manifestant_contact", "manifestant_cpf");
    } catch (err) {
      if (alive.current) setLookupError(ombudsmanError(err, { fields: { cpf: OMBUDSMAN_ERRORS.invalid_cpf } }));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const cpfId = `${uid}-cpf`;
  const lookupErrorId = lookupError ? `${uid}-lookup-err` : null;
  const missedId = value.missed ? `${uid}-missed` : null;
  const person = value.person;
  const locked = disabled || busy;

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Quem manifesta</legend>
      {person ? (
        <div style={row}>
          <strong>{person.name}</strong>
          <span className="mono" style={muted}>{`CPF ${person.cpf_masked}`}</span>
          <button type="button" style={locked ? disabledButtonStyle : secondaryButtonStyle} disabled={locked}
            onClick={() => { setLookupError(null); setValue(EMPTY_PERSON); }}>
            Trocar
          </button>
        </div>
      ) : (
        <>
          <label style={fieldLabel} htmlFor={cpfId}>CPF de quem manifesta</label>
          <div style={row}>
            <input id={cpfId} inputMode="numeric" autoComplete="off" value={value.cpf} style={inputStyle} disabled={disabled}
              {...merge(f.aria("manifestant_cpf"), { "aria-describedby": join(lookupErrorId, missedId) })}
              {...(lookupError ? { "aria-invalid": true as const } : {})}
              onChange={(ev) => {
                const cpf = maskCpf(ev.target.value);
                setLookupError(null);
                f.clear("manifestant_cpf");
                setValue((v) => ({ ...v, cpf, missed: false }));
              }}
              onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); void search(); } }} />
            <button type="button" style={locked ? disabledButtonStyle : buttonStyle} disabled={locked} onClick={() => { void search(); }}>
              Buscar pelo CPF
            </button>
          </div>
          {lookupError && <p id={lookupErrorId ?? undefined} role="alert" style={alert}>{lookupError}</p>}
          {f.errNode("manifestant_cpf")}
          {value.missed && <p id={missedId ?? undefined} role="status" style={muted}>{PERSON_NOT_FOUND}</p>}
        </>
      )}
      {f.errNode("citizen_id")}
      {!person && (
        <>
          <label style={fieldLabel}>
            Nome informado
            <input value={value.name} style={inputStyle} autoComplete="off" disabled={disabled}
              {...merge(f.aria("person"), f.aria("manifestant_name"))}
              onChange={(ev) => {
                const name = ev.target.value;
                f.clear("person", "manifestant_name", "citizen_id");
                setValue((v) => ({ ...v, name }));
              }} />
          </label>
          {f.errNode("person")}
          {f.errNode("manifestant_name")}
          <label style={fieldLabel}>
            Contato informado
            <input value={value.contact} style={inputStyle} autoComplete="off" disabled={disabled} {...f.aria("manifestant_contact")}
              onChange={(ev) => {
                const contact = ev.target.value;
                f.clear("manifestant_contact");
                setValue((v) => ({ ...v, contact }));
              }} />
          </label>
          {f.errNode("manifestant_contact")}
        </>
      )}
    </fieldset>
  );
}
