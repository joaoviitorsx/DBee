import { DatabaseZap, Plus } from "lucide-react";

import { Button } from "../../components/ui";

/** Vazio é convite para agir, não aviso de ausência. */
export function ConnectionsEmpty({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="mx-auto mt-24 max-w-sm text-center">
      <DatabaseZap aria-hidden className="mx-auto h-8 w-8 text-line-strong" />
      <h2 className="mt-4 text-base text-ink">Nenhuma conexão ainda</h2>
      <p className="mt-1.5 text-sm text-muted">
        Cadastre o primeiro banco para começar a consultar. A senha é cifrada antes de ir para o
        disco, e a conexão nasce em modo leitura.
      </p>
      <Button variant="primary" className="mt-5" onClick={onCreate}>
        <Plus aria-hidden className="h-4 w-4" />
        Cadastrar conexão
      </Button>
    </div>
  );
}
