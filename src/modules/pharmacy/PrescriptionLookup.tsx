// Busca da receita na dispensação (módulo 27a; F-27.5; contrato §7, H3): "Pelo código" (o código impresso) ou "Pelo paciente"
// (o PersonStart do 24a com as rotas da farmácia; o par validado vira paciente, como no 24a). Cada busca é uma mutação no clique
// (a leitura nominal grava trilha: nada de polling nem de reler sozinho), com `gcTime: 0` para a resposta não ficar no cache.
// CPF, CNS, nome e código vão só no CORPO do POST; nada em URL, log ou storage, e a lista vive só no estado da tela. A janela
// da busca por paciente (365 dias, até 20 receitas) é do api: a tela só mostra.
import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  findPharmacyDuplicates, lookupPharmacyPerson, lookupPrescriptions, type PharmacyLocation, type PrescriptionLookupInput, type PrescriptionView
} from "../../lib/api";
import { NO_PATIENT_RECORD, normalizeShortCode, pharmacyError } from "../../lib/pharmacy";
import { NO_NAME } from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { PersonStart, type PersonChoice, type PersonSource } from "../territory/PersonStart";

export const SHORT_CODE_TEXT = "o código da receita tem 10 letras e números (ex.: ABCDE-23456)";

// A farmácia busca a pessoa pelas rotas dela (sem cadastro territorial); as frases são as dela.
export const PHARMACY_PERSON_SOURCE: PersonSource = {
  lookup: (cpf) => lookupPharmacyPerson(cpf),
  duplicates: (q) => findPharmacyDuplicates(q),
  describe: pharmacyError,
  pickLabel: (name) => `Usar ${name}`
};

type Mode = "code" | "patient";
interface Chosen { patientId: string; name: string }

// `onFound` leva a lista, o paciente (busca por paciente) e o pedido feito (para a tela refazer a MESMA busca depois de dispensar).
export function PrescriptionLookup({ location, today, onFound, onClear }: {
  location: PharmacyLocation; today?: string;
  onFound(list: PrescriptionView[], patientId: string | null, input: PrescriptionLookupInput): void; onClear?(): void;
}) {
  const [ mode, setMode ] = useState<Mode>("code");
  const [ code, setCode ] = useState("");
  const [ chosen, setChosen ] = useState<Chosen | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  // Só a última busca vale: resposta de uma busca já trocada ou descartada é ignorada.
  const seq = useRef(0);
  const search = useMutation({ mutationFn: (input: PrescriptionLookupInput) => lookupPrescriptions(input), gcTime: 0 });

  const reset = () => { seq.current += 1; setProblem(null); onClear?.(); };
  function run(input: PrescriptionLookupInput) {
    reset();
    const mine = seq.current;
    search.mutate(input, {
      onSuccess: (list) => { if (mine === seq.current) onFound(list, "patient_id" in input ? input.patient_id : null, input); },
      onError: (err) => { if (mine === seq.current) setProblem(pharmacyError(err)); }
    });
  }

  function changeMode(next: Mode) {
    if (next === mode) return;
    reset();
    setChosen(null);
    setMode(next);
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    if (search.isPending) return;
    const short = normalizeShortCode(code);
    if (!short) { reset(); setProblem(SHORT_CODE_TEXT); return; }
    run({ location_id: location.id, short_code: short });
  }

  function choose(choice: PersonChoice) {
    if (choice.kind === "patient") {
      setChosen({ patientId: choice.patientId, name: choice.displayName ?? NO_NAME });
      run({ location_id: location.id, patient_id: choice.patientId });
      return;
    }
    // Pessoa nova ou par validado sem paciente: não há receita no Rota Saúde.
    reset();
    setProblem(NO_PATIENT_RECORD);
  }

  return (
    <div style={form}>
      <fieldset style={fieldset}>
        <legend style={legend}>Buscar a receita</legend>
        <div style={row}>
          <label style={checkLabel}><input type="radio" name="prescription-lookup-mode" checked={mode === "code"} onChange={() => changeMode("code")} />Pelo código</label>
          <label style={checkLabel}><input type="radio" name="prescription-lookup-mode" checked={mode === "patient"} onChange={() => changeMode("patient")} />Pelo paciente</label>
        </div>
      </fieldset>
      {mode === "code" ? (
        <form style={form} onSubmit={submitCode} noValidate aria-label="Buscar pelo código">
          <div style={{ ...row, alignItems: "flex-end" }}>
            <label style={fieldLabel}>
              Código da receita
              <input value={code} style={inputStyle} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                onChange={(e) => { setCode(e.target.value); setProblem(null); }} />
            </label>
            <button type="submit" style={search.isPending ? disabledButtonStyle : buttonStyle} disabled={search.isPending}>Buscar receita</button>
          </div>
        </form>
      ) : chosen ? (
        <div style={row}>
          <span>{`Paciente: ${chosen.name}`}</span>
          <button type="button" style={secondaryButtonStyle} onClick={() => { reset(); setChosen(null); }}>Trocar paciente</button>
        </div>
      ) : (
        <PersonStart today={today} source={PHARMACY_PERSON_SOURCE} onChoose={choose} onCancel={() => changeMode("code")} />
      )}
      {search.isPending && <p className="mono" style={muted}>buscando…</p>}
      {problem && <p role="alert" style={alert}>{problem}</p>}
    </div>
  );
}
