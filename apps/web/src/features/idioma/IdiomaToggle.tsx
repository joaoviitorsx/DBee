import { Languages } from "lucide-react";

import { Button } from "../../components/ui";
import { useIdioma } from "../../i18n";

/**
 * Alterna português e inglês.
 *
 * Dois idiomas, um clique. Mostra o código do idioma **atual** (não o destino,
 * como o tema): um seletor de idioma que exibe "EN" enquanto a tela está em
 * português confunde quem procura em que idioma está. O tooltip diz para onde o
 * clique leva.
 */
export function IdiomaToggle({ className }: { readonly className?: string }) {
  const { locale, setLocale, t } = useIdioma();
  const outro = locale === "pt" ? "en" : "pt";

  return (
    <Button
      size="sm"
      variant="ghost"
      className={`h-7 gap-1.5 px-2 text-2xs font-semibold uppercase tracking-wide ${className ?? ""}`}
      title={t("idioma.alternar")}
      aria-label={`${t("idioma.alternar")}: ${t(outro === "en" ? "idioma.en" : "idioma.pt")}`}
      onClick={() => { setLocale(outro); }}
    >
      <Languages aria-hidden className="h-3.5 w-3.5" />
      {locale}
    </Button>
  );
}
