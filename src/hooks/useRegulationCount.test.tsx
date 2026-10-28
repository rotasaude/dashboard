import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), countRegulationRequests: vi.fn() }));
import * as api from "../lib/api";
import { REGULATION_COUNT_REFRESH_MS, useRegulationCount } from "./useRegulationCount";
import { regCounts } from "../test/regulationFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const wrapper = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

describe("useRegulationCount", () => {
  it("a contagem relê a cada minuto e acende o item com os vencidos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocked(api.countRegulationRequests).mockReset().mockResolvedValue(regCounts());
    const { result } = renderHook(() => useRegulationCount(true, "u-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.overdue).toBe(3));
    expect(mocked(api.countRegulationRequests)).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(REGULATION_COUNT_REFRESH_MS); });
    expect(mocked(api.countRegulationRequests)).toHaveBeenCalledTimes(2);
  });
  it("desligado não lê", () => {
    mocked(api.countRegulationRequests).mockReset();
    renderHook(() => useRegulationCount(false, "u-1"), { wrapper });
    expect(mocked(api.countRegulationRequests)).not.toHaveBeenCalled();
  });
});
