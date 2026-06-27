// Placeholder honesto para os módulos ainda não ligados nesta fatia.
export function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>{title}</h1>
      <p style={{ color: "var(--ink3, #888)", fontSize: 13 }}>
        Painel ainda não ligado nesta fatia. Em breve.
      </p>
    </div>
  );
}
