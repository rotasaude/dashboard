import { afterEach, describe, expect, it } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useLeaveGuard } from "./useLeaveGuard";

afterEach(cleanup);

describe("useLeaveGuard (AT-03/AT-04)", () => {
  it("avisa ao sair só enquanto ativo", () => {
    const { rerender, unmount } = renderHook(({ on }) => useLeaveGuard(on), { initialProps: { on: true } });
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    rerender({ on: false });
    const e2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
    unmount();
  });
});
