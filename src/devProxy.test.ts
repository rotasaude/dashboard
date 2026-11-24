import { describe, expect, it } from "vitest";
import { MODULE_24B_PROXY_KEYS, MODULE_35A_PROXY_KEYS, MODULE_35B_PROXY_KEYS } from "./devProxy";

// O Vite casa as chaves de regex do proxy contra a URL com a query string.
describe("proxy de dev do módulo 24b", () => {
  const matches = (key: string, url: string) => new RegExp(key).test(url);

  it.each(MODULE_24B_PROXY_KEYS)("%s casa o caminho, sub-rotas e query", (key) => {
    const name = key.replace(/^\^\//, "").replace(/\(.*$/, "");
    for (const url of [`/${name}`, `/${name}?x=1`, `/${name}?team_id=x`, `/${name}/days?x=1`, `/${name}/options`]) {
      expect(matches(key, url), url).toBe(true);
    }
    expect(matches(key, `/${name}X`)).toBe(false);
    expect(matches(key, `/dashboard/${name}`)).toBe(false);
  });

  it("cobre as três rotas do módulo", () => {
    expect(MODULE_24B_PROXY_KEYS).toHaveLength(3);
  });
});

describe("proxy de dev do módulo 35a", () => {
  const matchesAny = (url: string) => MODULE_35A_PROXY_KEYS.some((key) => new RegExp(key).test(url));

  it("casa /vector_control, a query e as sub-rotas (inclusive o PDF do LIRAa)", () => {
    for (const url of [ "/vector_control", "/vector_control?x=1", "/vector_control/reports/liraa.pdf", "/vector_control/due?micro_area_id=ma1" ]) {
      expect(matchesAny(url), url).toBe(true);
    }
  });

  it("não casa outro prefixo nem a rota do próprio dashboard", () => {
    expect(matchesAny("/vector_controlX")).toBe(false);
    expect(matchesAny("/dashboard/vector_control")).toBe(false);
    expect(MODULE_35A_PROXY_KEYS).toEqual([ "^/vector_control(/|\\?|$)" ]);
  });
});

describe("proxy de dev do módulo 35b", () => {
  const matchesAny = (url: string) => MODULE_35B_PROXY_KEYS.some((key) => new RegExp(key).test(url));

  it("casa /zoonoses, a query e as sub-rotas (inclusive o CSV)", () => {
    for (const url of [ "/zoonoses", "/zoonoses?x=1", "/zoonoses/reports/leish.csv", "/zoonoses/collars?due=1" ]) {
      expect(matchesAny(url), url).toBe(true);
    }
  });

  it("não casa outro prefixo nem a rota do próprio dashboard", () => {
    expect(matchesAny("/zoonosesX")).toBe(false);
    expect(matchesAny("/dashboard/zoonoses")).toBe(false);
    expect(MODULE_35B_PROXY_KEYS).toEqual([ "^/zoonoses(/|\\?|$)" ]);
  });
});
