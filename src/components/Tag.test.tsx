import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Tag } from "./Tag";

afterEach(cleanup);

describe("Tag", () => {
  it.each([
    ["down", "square"], ["urgent", "square"], ["warn", "triangle"], ["ok", "circle"]
  ])("tom %s marca a forma %s além da cor", (tone, shape) => {
    const { container } = render(<Tag tone={tone}>alto</Tag>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.getAttribute("data-glyph")).toBe(shape);
  });

  it.each(["info", "accent", "neutral", undefined])("tom %s não carrega nível", (tone) => {
    const { container } = render(<Tag tone={tone}>publicado</Tag>);
    expect((container.firstElementChild as HTMLElement).hasAttribute("data-glyph")).toBe(false);
  });

  it("a forma não entra no texto: textContent é só o rótulo", () => {
    const { container } = render(<Tag tone="down">alto</Tag>);
    expect(container.textContent).toBe("alto");
  });
});
