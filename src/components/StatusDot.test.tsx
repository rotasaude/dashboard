import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StatusDot } from "./StatusDot";

afterEach(cleanup);

const dot = (level?: string) =>
  render(<StatusDot level={level} />).container.firstElementChild as HTMLElement;

describe("StatusDot", () => {
  it("alto/urgente é quadrado", () => {
    expect(dot("down").getAttribute("data-shape")).toBe("square");
    expect(dot("urgent").getAttribute("data-shape")).toBe("square");
  });

  it("moderado é triângulo", () => {
    // Só o atributo: o jsdom descarta clip-path do style inline, então o
    // desenho do triângulo é conferido nas capturas da Task 8.
    expect(dot("warn").getAttribute("data-shape")).toBe("triangle");
  });

  it("ok e demais tons são círculo", () => {
    expect(dot("ok").getAttribute("data-shape")).toBe("circle");
    expect(dot("info").getAttribute("data-shape")).toBe("circle");
    expect(dot(undefined).getAttribute("data-shape")).toBe("circle");
  });

  it("continua decorativo para o leitor de tela", () => {
    expect(dot("down").getAttribute("aria-hidden")).toBe("true");
  });
});
