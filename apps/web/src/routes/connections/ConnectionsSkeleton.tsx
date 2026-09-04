import { Skeleton } from "../../components/ui";

/**
 * Espelha a altura e o ritmo da lista real, então a página não salta quando os
 * dados chegam. As divisórias são as mesmas — os cortes da marca.
 */
export function ConnectionsSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <ul aria-hidden className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-4 py-3 pl-5 pr-3">
          <span className="absolute left-0 h-8 w-[3px] rounded-full bg-raised" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-8 w-20" />
        </li>
      ))}
    </ul>
  );
}
