// Moldura de entrada do dashboard (spec city-identity §5): a prefeitura à
// esquerda (faixa no topo abaixo de 1024 px) e a tela de entrada à direita. A
// mensagem é "este é o sistema da sua prefeitura"; sem identidade (carregando
// ou falhou) a metade da cidade mostra só a marca e nada bloqueia o login.
import { useState, type ReactNode } from "react";
import { cityLabel, type CityIdentity } from "../../lib/cityIdentity";
import { BrandMark } from "../../shell/Brand";
import "./entry.css";

export function EntryFrame({ identity, children }: { identity: CityIdentity | null; children: ReactNode }) {
  return (
    <div className="entry-frame">
      <section className="entry-city" aria-label={identity ? `Prefeitura de ${identity.name}` : "Rota Saúde"}>
        {identity ? (
          <>
            {/* key: um brasão novo (outra versão) tenta carregar de novo. */}
            <Crest key={identity.coat_of_arms_url ?? ""} name={identity.name} url={identity.coat_of_arms_url} />
            <div className="entry-city-text">
              <p className="entry-prefix">Prefeitura de</p>
              <p className="entry-city-name">{cityLabel(identity)}</p>
              {identity.health_department_name && <p className="entry-dept">{identity.health_department_name}</p>}
            </div>
          </>
        ) : (
          <>
            <span className="entry-crest"><BrandMark size={40} /></span>
            <p className="entry-city-name">Rota Saúde</p>
          </>
        )}
      </section>
      <main className="entry-form">
        <div className="entry-form-inner">{children}</div>
      </main>
      <p className="entry-operated"><BrandMark size={16} /> operado com Rota Saúde</p>
    </div>
  );
}

// A rota do brasão responde 500 quando o storage (MinIO) está fora: o erro de
// carga troca a imagem pelo ícone da marca, que é decorativo.
function Crest({ name, url }: { name: string; url: string | null }) {
  const [ failed, setFailed ] = useState(false);
  return (
    <span className="entry-crest">
      {url && !failed
        ? <img src={url} alt={`Brasão de ${name}`} onError={() => setFailed(true)} />
        : <BrandMark size={40} />}
    </span>
  );
}
