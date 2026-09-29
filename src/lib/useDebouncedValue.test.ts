import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] }));
  afterEach(() => vi.useRealTimers());

  it("só muda depois de 500 ms parado, e cada mudança reinicia a espera", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 500), { initialProps: { v: "a" } });
    expect(result.current).toBe("a");
    rerender({ v: "b" });
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current).toBe("a");
    rerender({ v: "c" });
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("c");
  });
});
