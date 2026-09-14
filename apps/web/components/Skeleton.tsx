/** Loading states are skeletons in the shape of the thing, never spinners. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-chip bg-press ${className}`} />;
}

export function BalanceSkeleton() {
  return (
    <div className="px-1 pb-[34px] pt-[22px]">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3.5 h-[54px] w-64" />
      <Skeleton className="mt-3 h-4 w-24" />
    </div>
  );
}

export function AllowanceCardSkeleton() {
  return (
    <div className="rounded-row border border-line bg-card px-4 pb-[18px] pt-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3.5 h-6 w-32" />
      <Skeleton className="mt-3.5 h-1.5 w-full" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-row border border-line bg-card px-3.5 py-3">
      <Skeleton className="h-10 w-10 flex-none rounded-pill" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-3 w-40" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  );
}
