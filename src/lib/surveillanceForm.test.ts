import { describe, expect, it } from "vitest";
import { UFS } from "./professionals";
import { FORM_EDITABLE, SINAN_FORM_FIELDS, formBody, formProblem, formValues, type FormFieldSpec } from "./surveillanceForm";

// A tabela do §14 (apps/api config/surveillance/sinan-form.yml): chaves, ordem, tipos e limites.
const KEYS = [ "pregnancy", "race_color", "schooling", "residence_uf", "residence_district", "residence_neighborhood", "residence_street",
  "residence_number", "residence_complement", "residence_geo1", "residence_geo2", "residence_reference", "residence_zip", "phone",
  "residence_zone", "residence_country", "occupation_cbo" ];
const field = (key: string): FormFieldSpec => SINAN_FORM_FIELDS.find((f) => f.key === key)!;
const empty = (): Record<string, string> => Object.fromEntries(KEYS.map((k) => [ k, "" ]));
const problem = (over: Record<string, string>) => formProblem({ ...empty(), ...over }, SINAN_FORM_FIELDS);

describe("tabela do §14", () => {
  it("as 17 chaves, na ordem, únicas e com rótulo", () => {
    expect(SINAN_FORM_FIELDS.map((f) => f.key)).toEqual(KEYS);
    expect(new Set(KEYS).size).toBe(17);
    for (const f of SINAN_FORM_FIELDS) expect(f.label.length).toBeGreaterThan(0);
  });

  it("tipos e limites do api", () => {
    expect(SINAN_FORM_FIELDS.map((f) => f.kind)).toEqual([ "code", "code", "code", "uf", "text", "text", "text", "text", "text", "digits", "digits",
      "text", "digits", "digits", "code", "text", "cbo" ]);
    expect(SINAN_FORM_FIELDS.filter((f) => f.kind === "text").map((f) => [ f.key, f.max ])).toEqual([
      [ "residence_district", 60 ], [ "residence_neighborhood", 60 ], [ "residence_street", 60 ], [ "residence_number", 6 ],
      [ "residence_complement", 30 ], [ "residence_reference", 70 ], [ "residence_country", 40 ] ]);
    expect([ field("residence_geo1"), field("residence_geo2") ].map((f) => [ f.min, f.max ])).toEqual([ [ 1, 8 ], [ 1, 8 ] ]);
    expect(field("residence_zip").length).toBe(8);
    expect([ field("phone").min, field("phone").max ]).toEqual([ 10, 11 ]);
  });

  it("domínios dos campos de código, idênticos ao §14", () => {
    expect(field("pregnancy").options?.map((o) => o.code)).toEqual([ "1", "2", "3", "4", "5", "6", "9" ]);
    expect(field("pregnancy").options?.find((o) => o.code === "5")?.label).toBe("Não");
    expect(field("race_color").options).toEqual([ { code: "1", label: "Branca" }, { code: "2", label: "Preta" }, { code: "3", label: "Amarela" },
      { code: "4", label: "Parda" }, { code: "5", label: "Indígena" }, { code: "9", label: "Ignorado" } ]);
    expect(field("schooling").options?.map((o) => o.code)).toEqual([ "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10" ]);
    expect(field("schooling").options?.[1].label).toBe("1ª a 4ª série incompleta do EF (antigo primário ou 1º grau)");
    expect(field("residence_zone").options).toEqual([ { code: "1", label: "Urbana" }, { code: "2", label: "Rural" },
      { code: "3", label: "Periurbana" }, { code: "9", label: "Ignorado" } ]);
    for (const f of SINAN_FORM_FIELDS) if (f.kind === "code") expect((f.options ?? []).length).toBeGreaterThan(0);
  });

  it("só estes quatro estados deixam editar a ficha", () => {
    expect([ ...FORM_EDITABLE ].sort()).toEqual([ "closed", "investigating", "notified", "possible" ]);
  });
});

describe("valores e corpo", () => {
  it("valores: só strings; ausente, null ou outro tipo vira vazio; zeros à esquerda ficam", () => {
    const v = formValues({ residence_zip: "01310100", phone: null, race_color: "4", residence_number: "12" }, SINAN_FORM_FIELDS);
    expect(Object.keys(v)).toEqual(KEYS);
    expect(v.residence_zip).toBe("01310100");
    expect(v.phone).toBe("");
    expect(v.pregnancy).toBe("");
    expect(formValues(undefined, SINAN_FORM_FIELDS).race_color).toBe("");
    expect(formValues({ residence_number: 12 as unknown as string }, SINAN_FORM_FIELDS).residence_number).toBe("");
  });

  it("corpo: a ficha inteira em strings; vazio ou só espaço vira null; o digitado vai como está", () => {
    const body = formBody({ ...empty(), race_color: "4", residence_zip: "01310-100", residence_street: "Rua  das Flores ", phone: "   " }, SINAN_FORM_FIELDS);
    expect(Object.keys(body)).toEqual(KEYS);
    expect(body.race_color).toBe("4");
    expect(body.residence_zip).toBe("01310-100");
    expect(body.residence_street).toBe("Rua  das Flores ");
    expect(body.phone).toBeNull();
    expect(body.pregnancy).toBeNull();
    for (const v of Object.values(body)) expect(v === null || typeof v === "string").toBe(true);
  });
});

describe("conferência antes de enviar", () => {
  it("tudo vazio vale; nada é obrigatório", () => {
    expect(problem({})).toBeNull();
  });

  it("código fora do domínio, com o path do api", () => {
    expect(problem({ race_color: "7" })).toEqual({ path: "form.race_color", message: "Raça/Cor: escolha um valor da lista" });
    expect(problem({ race_color: "4", residence_zone: "0" })).toEqual({ path: "form.residence_zone", message: "Zona: escolha um valor da lista" });
    expect(problem({ schooling: "10", race_color: "9" })).toBeNull();
  });

  it("UF só da lista (maiúsculas)", () => {
    expect(problem({ residence_uf: "XX" })).toEqual({ path: "form.residence_uf", message: "UF: escolha um valor da lista" });
    for (const uf of UFS) expect(problem({ residence_uf: uf })).toBeNull();
  });

  it("texto passa do limite: recusa, nunca corta (o espaço colapsado conta como o api conta)", () => {
    expect(problem({ residence_number: "1234567" })).toEqual({ path: "form.residence_number", message: "Número: no máximo 6 caracteres" });
    expect(problem({ residence_number: "123456" })).toBeNull();
    expect(problem({ residence_number: "  12 3  " })).toBeNull();
    expect(problem({ residence_reference: "x".repeat(71) })).toEqual({ path: "form.residence_reference", message: "Ponto de referência: no máximo 70 caracteres" });
    expect(problem({ residence_street: "Rua\u0007" })).toEqual({ path: "form.residence_street", message: "Logradouro: caractere não aceito" });
  });

  it("dígitos: o api tira ( ) . - e espaço; o resto recusa; tamanho de min a max ou exato", () => {
    expect(problem({ phone: "(41) 99999-9999" })).toBeNull();
    expect(problem({ phone: "4133334444" })).toBeNull();
    expect(problem({ phone: "413333444" })).toEqual({ path: "form.phone", message: "(DDD) Telefone: de 10 a 11 dígitos" });
    expect(problem({ phone: "41 3333 444A" })).toEqual({ path: "form.phone", message: "(DDD) Telefone: só dígitos" });
    expect(problem({ residence_zip: "01310-100" })).toBeNull();
    expect(problem({ residence_zip: "1310100" })).toEqual({ path: "form.residence_zip", message: "CEP: 8 dígitos" });
    expect(problem({ residence_geo1: "123456789" })).toEqual({ path: "form.residence_geo1", message: "Geo campo 1: de 1 a 8 dígitos" });
    expect(problem({ residence_geo2: "12345678" })).toBeNull();
  });

  it("CBO: 6 dígitos", () => {
    expect(problem({ occupation_cbo: "225125" })).toBeNull();
    expect(problem({ occupation_cbo: "2251-25" })).toEqual({ path: "form.occupation_cbo", message: "Ocupação (CBO): 6 dígitos" });
  });

  it("devolve o primeiro problema, na ordem da ficha", () => {
    expect(problem({ occupation_cbo: "1", pregnancy: "8" })?.path).toBe("form.pregnancy");
  });

  it("a mensagem nunca repete o valor digitado", () => {
    expect(JSON.stringify(problem({ phone: "41 3333 444A" }))).not.toContain("444A");
  });
});
