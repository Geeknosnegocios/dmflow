import { KpiSkeleton, CardSkeleton, Skeleton, TableRowSkeleton } from "@/components/skeleton";
import { Card, CardHeader } from "@/components/viz";

export default function Loading() {
  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
        <KpiSkeleton />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <CardSkeleton height={180} />
        </div>
        <div className="lg:col-span-3">
          <CardSkeleton height={180} />
        </div>
      </section>

      <Card>
        <CardHeader title="Carregando" subtitle="Puxando dados do Supabase" />
        {Array.from({ length: 5 }).map((_, i) => (
          <TableRowSkeleton key={i} />
        ))}
      </Card>
    </div>
  );
}
