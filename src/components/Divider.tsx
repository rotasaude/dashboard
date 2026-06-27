// Divider — linha divisória.

interface Props {
  vertical?: boolean;
  spacing?: number;
}

export function Divider({ vertical, spacing = 12 }: Props) {
  if (vertical) {
    return (
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 1,
          alignSelf: "stretch",
          background: "var(--rule)",
          margin: `0 ${spacing}px`
        }}
      />
    );
  }
  return (
    <hr
      style={{
        border: 0,
        borderTop: "1px solid var(--rule)",
        margin: `${spacing}px 0`
      }}
    />
  );
}
