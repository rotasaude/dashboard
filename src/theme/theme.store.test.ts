import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { THEME_KEY, getTheme, setTheme, toggleHighContrast, useTheme } from "./theme";

// setTheme("govbr") zera também a escolha em memória entre um teste e outro.
beforeEach(() => { setTheme("govbr"); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("tema por pessoa", () => {
  it("sem nada salvo vale govbr", () => {
    expect(getTheme()).toBe("govbr");
  });

  it("valor inválido salvo vale govbr", () => {
    localStorage.setItem(THEME_KEY, "neon");
    expect(getTheme()).toBe("govbr");
  });

  it("setTheme aplica no <html> e salva", () => {
    setTheme("rota");
    expect(document.documentElement.dataset.theme).toBe("rota");
    expect(localStorage.getItem(THEME_KEY)).toBe("rota");
    expect(getTheme()).toBe("rota");
  });

  it("armazenamento quebrado: o tema troca na sessão e nada lança", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getTheme()).toBe("govbr");
    expect(() => setTheme("alto-contraste")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("alto-contraste");
    expect(getTheme()).toBe("alto-contraste");
  });

  it("alto contraste liga e volta ao tema anterior", () => {
    setTheme("rota");
    toggleHighContrast();
    expect(getTheme()).toBe("alto-contraste");
    toggleHighContrast();
    expect(getTheme()).toBe("rota");
  });

  it("useTheme acompanha a troca", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe("govbr");
    act(() => setTheme("rota"));
    expect(result.current).toBe("rota");
  });
});

describe("armazenamento que lê mas não grava (A-06)", () => {
  it("a escolha da sessão vale sobre o valor antigo salvo", () => {
    localStorage.setItem(THEME_KEY, "rota");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    setTheme("alto-contraste");
    expect(getTheme()).toBe("alto-contraste");
  });
});
