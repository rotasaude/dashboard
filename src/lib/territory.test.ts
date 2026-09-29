import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError, createUnit, listNeighborhoods, replaceCoverage, setNeighborhoodActive, type Neighborhood
} from "./api";
import { matchNeighborhood, normalizeName, sortByName, territoryError, validateNeighborhoodName } from "./territory";

afterEach(() => vi.unstubAllGlobals());

const n = (id: string, name: string, active = true): Neighborhood => ({ id, name, active, source: "seed", units: [] });

describe("normalizeName", () => {
  it("ignora acento, maiúscula e espaço sobrando", () => {
    expect(normalizeName("São Brás")).toBe("sao bras");
    expect(normalizeName("  ÁGUA   Verde ")).toBe("agua verde");
  });
});

describe("sortByName", () => {
  it("ordena em pt-BR sem mexer na lista original", () => {
    const list = [ n("1", "Centro"), n("2", "Água Verde"), n("3", "Batel") ];
    expect(sortByName(list).map((x) => x.name)).toEqual([ "Água Verde", "Batel", "Centro" ]);
    expect(list[0].name).toBe("Centro");
  });
});

describe("matchNeighborhood", () => {
  const list = [ n("1", "São Francisco"), n("2", "Batel", false) ];
  it("casa sem diferenciar maiúsculas e acentos", () => {
    expect(matchNeighborhood("SAO FRANCISCO", list)?.id).toBe("1");
  });
  it("nunca sugere bairro inativo", () => {
    expect(matchNeighborhood("Batel", list)).toBeNull();
  });
  it("vazio ou sem par: null", () => {
    expect(matchNeighborhood("", list)).toBeNull();
    expect(matchNeighborhood(undefined, list)).toBeNull();
    expect(matchNeighborhood("Rebouças", list)).toBeNull();
  });
});

describe("validateNeighborhoodName", () => {
  it("recusa vazio e nome com mais de 120 caracteres", () => {
    expect(validateNeighborhoodName("   ")).toBe("informe o nome do bairro");
    expect(validateNeighborhoodName("a".repeat(121))).toBe("nome com mais de 120 caracteres");
    expect(validateNeighborhoodName(" Batel ")).toBeNull();
  });
});

describe("territoryError", () => {
  const err = (status: number, error: string) => new ApiError(status, { error }, "x");
  it("traduz as recusas nomeadas", () => {
    expect(territoryError(err(422, "name_taken"))).toBe("já existe um bairro com este nome");
    expect(territoryError(err(422, "blank_name"))).toBe("informe o nome do bairro");
    expect(territoryError(err(422, "inactive_unit"))).toBe("há unidade desativada ou inexistente na cobertura — recarregue e tente de novo");
    expect(territoryError(err(422, "inactive_neighborhood"))).toBe("bairro desativado não recebe cobertura — reative antes");
    expect(territoryError(err(404, "not_found"))).toBe("bairro não encontrado — recarregue a lista");
    expect(territoryError(err(403, "missing_role"))).toBe("seu papel não permite esta ação");
  });
  it("401 e desconhecido", () => {
    expect(territoryError(new ApiError(401, {}, "x"))).toBe("sessão expirada — entre de novo");
    expect(territoryError(new Error("rede"))).toBe("não foi possível concluir — tente de novo");
  });
});

describe("cliente /territory e endereço da unidade", () => {
  function stub(body: unknown) {
    const fn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const call = (fn: ReturnType<typeof stub>, i = 0) => fn.mock.calls[i] as [ string, RequestInit ];

  it("lista os bairros de /territory/neighborhoods", async () => {
    const fn = stub({ neighborhoods: [ n("1", "Centro") ] });
    expect((await listNeighborhoods()).map((x) => x.name)).toEqual([ "Centro" ]);
    expect(call(fn)[0]).toBe("/territory/neighborhoods");
  });

  it("desativa e reativa por rotas próprias", async () => {
    const fn = stub({});
    await setNeighborhoodActive("n1", false);
    await setNeighborhoodActive("n1", true);
    expect(call(fn, 0)[0]).toBe("/territory/neighborhoods/n1/deactivate");
    expect(call(fn, 1)[0]).toBe("/territory/neighborhoods/n1/activate");
    expect(call(fn, 0)[1].method).toBe("POST");
  });

  it("substitui a cobertura com health_unit_ids", async () => {
    const fn = stub({});
    await replaceCoverage("n1", [ "u1", "u2" ]);
    expect(call(fn)[0]).toBe("/territory/neighborhoods/n1/coverage");
    expect(JSON.parse(String(call(fn)[1].body))).toEqual({ health_unit_ids: [ "u1", "u2" ] });
  });

  it("createUnit manda o endereço achatado, com null onde não há valor", async () => {
    const fn = stub({ unit: { id: "u1", name: "UBS", kind: "ubs", active: true } });
    await createUnit("UBS", "ubs", { address_street: "Rua A", address_number: "1", address_complement: null,
      address_zip: "80010000", neighborhood_id: "n1" });
    expect(JSON.parse(String(call(fn)[1].body))).toEqual({ name: "UBS", kind: "ubs", address_street: "Rua A",
      address_number: "1", address_complement: null, address_zip: "80010000", neighborhood_id: "n1" });
  });
});
