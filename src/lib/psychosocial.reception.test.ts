// Regras do acolhimento (F-31.2; contrato §4, P7, P40): procedimento, data, desfecho e o bloco de matrícula numa chamada só.
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  PSY_ERRORS, RECEPTION_BEFORE_START, emptyReceptionDraft, psyRefusals, receptionInput, receptionProblems, receptionProcedures,
  type ReceptionDraft
} from "./psychosocial";
import { NOW31, OPTIONS, TODAY31 } from "../test/psychosocialFixtures";

const filled = (o: Partial<ReceptionDraft> = {}): ReceptionDraft => {
  const d = emptyReceptionDraft(NOW31, TODAY31, "u-1", receptionProcedures(OPTIONS));
  return { ...d, outcome: "enrolled", enrollment: { ...d.enrollment, origin: "02", cidMain: { code: "F32.2", label: "Episódio depressivo grave" },
    substances: [ "99" ], esfCovered: true, esfCnes: "2384299" }, ...o };
};

describe("acolhimento (módulo 31)", () => {
  it("procedimento do acolhimento: nome com ACOLHIMENTO e instrumento 09 ou 02; o primeiro é o padrão", () => {
    const extra = { ...OPTIONS.procedures[0], code: "0301080999", name: "ACOLHIMENTO SO BPA-C", instrument_codes: [ "01" ] };
    expect(receptionProcedures({ ...OPTIONS, procedures: [ ...OPTIONS.procedures, extra ] }).map((p) => p.code)).toEqual([ "0301080232" ]);
    const d = emptyReceptionDraft(NOW31, TODAY31, "u-1", receptionProcedures(OPTIONS));
    expect(d.sigtapCode).toBe("0301080232");
    expect(d.at).toBe("2026-11-04T10:00");
    expect(d.outcome).toBe("");
    expect(d.enrollment.startedOn).toBe(TODAY31);
    expect(emptyReceptionDraft(NOW31, TODAY31, "u-1", []).sigtapCode).toBe("");
  });

  it("confere tudo de uma vez; o bloco de matrícula só com `enrolled`, com o prefixo enrollment.", () => {
    const empty = emptyReceptionDraft(NOW31, TODAY31, "u-1", []);
    expect(receptionProblems(empty, TODAY31, NOW31).map((p) => p.path)).toEqual([ "sigtap_code", "outcome" ]);
    expect(receptionProblems({ ...empty, sigtapCode: "0301080232", outcome: "enrolled" }, TODAY31, NOW31).map((p) => p.path))
      .toEqual([ "enrollment.origin", "enrollment.cid_main", "enrollment.substances" ]);
    expect(receptionProblems(filled(), TODAY31, NOW31)).toEqual([]);
    expect(receptionProblems(filled({ at: "2026-11-04T11:00" }), TODAY31, NOW31)).toEqual([ { path: "at", text: "a data não pode ser futura" } ]);
    expect(receptionProblems(filled({ at: "" }), TODAY31, NOW31).map((p) => p.path)).toEqual([ "at" ]);
    expect(receptionProblems(filled({ notes: "x".repeat(4001) }), TODAY31, NOW31).map((p) => p.path)).toEqual([ "notes" ]);
  });

  it("acolhimento antes do início da matrícula: a mesma frase do api (enrollment_required em at)", () => {
    const d = filled({ at: "2026-11-03T09:00" });
    expect(receptionProblems(d, TODAY31, NOW31)).toEqual([ { path: "at", text: RECEPTION_BEFORE_START } ]);
    const api = psyRefusals(new ApiError(422, { error: "action_rejected", problems: [ { error: "enrollment_required", path: "at" } ] }, "x"));
    expect(api[0].text).toBe(RECEPTION_BEFORE_START);
    // Sem matrícula, a data não depende do início.
    expect(receptionProblems({ ...d, outcome: "referred_elsewhere" }, TODAY31, NOW31)).toEqual([]);
  });

  it("corpo: matrícula sem health_unit_id/patient_id; notas e encaminhamento vazios não vão; sem matrícula, sem o bloco", () => {
    expect(receptionInput(filled(), "caps2", "pt1", "rf1")).toEqual({
      health_unit_id: "caps2", patient_id: "pt1", referral_id: "rf1", at: "2026-11-04T10:00:00-03:00", sigtap_code: "0301080232",
      outcome: "enrolled",
      enrollment: { started_on: TODAY31, origin: "02", cid_main: "F32.2", substances: [ "99" ], esf_covered: true, esf_cnes: "2384299",
        reference_user_id: "u-1" }
    });
    const other = receptionInput(filled({ outcome: "no_follow_up", notes: "  Veio com a irmã.  " }), "caps2", "pt5", null);
    expect(other).toEqual({ health_unit_id: "caps2", patient_id: "pt5", at: "2026-11-04T10:00:00-03:00", sigtap_code: "0301080232",
      outcome: "no_follow_up", notes: "Veio com a irmã." });
    expect("enrollment" in other).toBe(false);
    expect("referral_id" in other).toBe(false);
  });

  it("month_closed no início da matrícula e esf_cnes_required têm frase própria", () => {
    const err = new ApiError(422, { error: "month_closed", path: "enrollment.started_on" }, "x");
    expect(psyRefusals(err)[0].text).toContain("o início da matrícula cai num mês já fechado");
    expect(psyRefusals(new ApiError(422, { error: "esf_cnes_required", path: "enrollment.esf_cnes" }, "x"))[0].text).toBe(PSY_ERRORS.esf_cnes_required);
  });
});
