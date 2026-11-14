import { describe, expect, it } from "vitest";
import { MODULE_24B_PROXY_KEYS } from "./devProxy";

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
