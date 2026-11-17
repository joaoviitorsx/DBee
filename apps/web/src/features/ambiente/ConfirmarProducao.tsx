import { ShieldAlert } from "lucide-react";
import { useId, useState } from "react";

import { Field, Input, ModalPainel } from "../../components/ui";
import { useT } from "../../i18n";
import { ConfirmacaoArmada } from "../estados/ConfirmacaoArmada";
import { confirmacaoConfere } from "./ambiente.puro";

/**
 * Confirmação antes de gravar numa conexão de produção (ADR 022): digitar o
 * nome da conexão. É anti-acidente, não autorização — quem tem escrita sabe o
 * nome. O botão só arma quando o nome confere, e ainda passa pelo atraso da
 * `ConfirmacaoArmada` (o Enter "de carona" não confirma).
 */
export function ConfirmarProducao({
  nomeConexao,
  onConfirmar,
  onClose,
}: {
  readonly nomeConexao: string;
  readonly onConfirmar: (confirmName: string) => void;
  readonly onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const [digitado, setDigitado] = useState("");
  const confere = confirmacaoConfere(digitado, nomeConexao);
  return (
    <ModalPainel
      titulo={t("ambiente.confirmarTitulo")}
      descricao={t("ambiente.confirmarDescricao", { nome: nomeConexao })}
      icone={<ShieldAlert aria-hidden className="h-4 w-4 text-danger" />}
      onClose={onClose}
      rodape={
        confere ? (
          <ConfirmacaoArmada onConfirmar={() => { onConfirmar(digitado); }}>
            {t("ensaio.aplicar")}
          </ConfirmacaoArmada>
        ) : (
          <span className="text-2xs text-subtle">{t("ambiente.confirmarDica")}</span>
        )
      }
    >
      <Field label={t("ambiente.confirmarCampo", { nome: nomeConexao })} htmlFor={id}>
        <Input
          id={id}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={digitado}
          onChange={(e) => { setDigitado(e.target.value); }}
          className="font-mono"
        />
      </Field>
    </ModalPainel>
  );
}
