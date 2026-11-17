import { FileDown, FileUp } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";

import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { LIMITE_ARQUIVO_SQL, nomeArquivoSql } from "./arquivoSql.puro";

/**
 * Abrir e baixar `.sql` (ideia I4). Tudo no navegador: o arquivo nunca passa
 * pelo servidor, e abrir só põe o texto no editor — nada executa.
 */
export function ArquivoSql({
  sql,
  titulo,
  onAbrir,
}: {
  readonly sql: string;
  readonly titulo: string;
  readonly onAbrir: (texto: string) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);

  const abrir = async (f: File): Promise<void> => {
    if (f.size > LIMITE_ARQUIVO_SQL) {
      toast.error(t("arquivo.grandeDemais", { mb: String(LIMITE_ARQUIVO_SQL / 1024 / 1024) }));
      return;
    }
    const texto = await f.text();
    // Byte nulo é sinal de binário: não é SQL, e no editor seria lixo.
    if (texto.includes("\0")) {
      toast.error(t("arquivo.naoTexto"));
      return;
    }
    onAbrir(texto);
  };

  const baixar = (): void => {
    const url = URL.createObjectURL(new Blob([sql], { type: "application/sql;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeArquivoSql(titulo);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); }, 0);
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".sql,text/plain,application/sql"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f !== undefined) void abrir(f);
        }}
      />
      <Button variant="ghost" size="sm" title={t("arquivo.abrirDica")} onClick={() => { input.current?.click(); }}>
        <FileUp aria-hidden className="h-3.5 w-3.5" />
        {t("arquivo.abrir")}
      </Button>
      <Button variant="ghost" size="sm" disabled={sql.trim() === ""} onClick={baixar}>
        <FileDown aria-hidden className="h-3.5 w-3.5" />
        {t("arquivo.baixar")}
      </Button>
    </>
  );
}
