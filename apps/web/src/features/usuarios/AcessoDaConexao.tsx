import { Lock, Unlock } from "lucide-react";

import { Badge } from "../../components/ui";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { useSession } from "../auth/useSession";
import {
  useAcessos,
  useConcederAcesso,
  useRevogarAcesso,
  useUsuarios,
} from "./useUsuarios";

/**
 * Quem alcança esta conexão (migração 005).
 *
 * ## As duas pontas da escrita
 *
 * `writeEnabled` da conexão é "esta conexão **pode** ser escrita"; o interruptor
 * de escrita aqui é "esta pessoa **pode** escrever nela". Nenhum sozinho basta.
 * Numa conexão somente-leitura o interruptor some — oferecer um controle que o
 * servidor vai ignorar seria mentir sobre o efeito dele.
 *
 * ## Aplica na hora
 *
 * Diferente do resto do formulário, conceder e revogar valem no clique, sem
 * esperar o "Salvar". Revogar acesso é ação de segurança: adiar até alguém
 * lembrar de salvar é o caminho para a permissão ficar aberta por engano.
 *
 * ## Admin não aparece na lista
 *
 * Administrador enxerga toda conexão por definição, então uma linha para ele
 * seria um controle sem efeito — e um controle sem efeito ensina a pessoa
 * errado sobre como o sistema funciona.
 */
export function AcessoDaConexao({
  connectionId,
  writeEnabled,
}: {
  readonly connectionId: string;
  /** O `write_enabled` **da conexão**, não o efetivo de ninguém. */
  readonly writeEnabled: boolean;
}) {
  const t = useT();
  const sessao = useSession();
  const souAdmin = sessao.data?.role === "admin";

  const usuarios = useUsuarios(souAdmin);
  const acessos = useAcessos(connectionId, souAdmin);
  const conceder = useConcederAcesso(connectionId);
  const revogar = useRevogarAcesso(connectionId);

  // O painel inteiro é de admin. O controle está no servidor; isto evita
  // desenhar uma seção que só produziria 403.
  if (!souAdmin) return null;

  const membros = (usuarios.data ?? []).filter((u) => u.role === "member");
  const porUsuario = new Map((acessos.data ?? []).map((a) => [a.userId, a]));
  const ocupado = conceder.isPending || revogar.isPending;

  return (
    <section className="rounded-[6px] border border-line bg-raised px-4 py-3.5">
      <h3 className="text-xs font-medium text-ink">{t("acesso.titulo")}</h3>
      <p className="mt-1 text-2xs leading-relaxed text-subtle">{t("acesso.ajuda")}</p>

      {usuarios.isPending || acessos.isPending ? (
        <p className="mt-3 text-2xs text-subtle">{t("acesso.carregando")}</p>
      ) : membros.length === 0 ? (
        <p className="mt-3 text-2xs text-subtle">{t("acesso.semMembros")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {membros.map((u) => {
            const concessao = porUsuario.get(u.id);
            const temAcesso = concessao !== undefined;
            const podeGravar = concessao?.canWrite === true;

            return (
              <li
                key={u.id}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[4px] border px-3 py-2",
                  temAcesso ? "border-line-strong bg-surface" : "border-line",
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-[var(--color-accent)]"
                    checked={temAcesso}
                    disabled={ocupado}
                    onChange={(e) => {
                      if (e.target.checked) {
                        conceder.mutate({ userId: u.id, canWrite: false });
                      } else {
                        revogar.mutate(u.id);
                      }
                    }}
                  />
                  <span className="truncate font-mono text-xs text-ink">{u.username}</span>
                </label>

                {/*
                  O controle de escrita só existe onde a escrita existe. Numa
                  conexão somente-leitura ele seria ignorado pelo servidor, e um
                  interruptor que não faz nada é pior que a ausência dele.
                */}
                {temAcesso && writeEnabled ? (
                  <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="accent-[var(--color-accent)]"
                      checked={podeGravar}
                      disabled={ocupado}
                      onChange={(e) => {
                        conceder.mutate({ userId: u.id, canWrite: e.target.checked });
                      }}
                    />
                    {podeGravar ? (
                      // Âmbar sólido é o vocabulário da escrita (design-system
                      // §1.4) — aqui ele significa exatamente isso.
                      <Badge tone="write">
                        <Unlock aria-hidden className="h-3 w-3" />
                        {t("acesso.podeGravar")}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">
                        <Lock aria-hidden className="h-3 w-3" />
                        {t("acesso.soLeitura")}
                      </Badge>
                    )}
                  </label>
                ) : temAcesso ? (
                  <Badge tone="neutral">
                    <Lock aria-hidden className="h-3 w-3" />
                    {t("acesso.soLeitura")}
                  </Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {conceder.isError || revogar.isError ? (
        <p role="alert" className="mt-2 text-2xs text-danger">
          {t("acesso.erro")}
        </p>
      ) : null}
    </section>
  );
}
