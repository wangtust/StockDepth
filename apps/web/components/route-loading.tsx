export function RouteLoading({ title = 'Loading page' }: { title?: string }) {
  return (
    <section aria-busy="true" aria-label={title} className="min-w-0 flex-1 p-4 lg:p-8">
      <div role="status" className="mb-6 flex items-center gap-3">
        <span aria-hidden="true" className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-emerald-600 motion-safe:animate-spin" />
        <h1 className="text-lg font-medium text-slate-700">{title}</h1>
        <span className="sr-only">Loading content…</span>
      </div>
      <div aria-hidden="true" className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map(index => (
          <div key={index} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-4 h-4 w-1/3 rounded bg-slate-100 motion-safe:animate-pulse" />
            <div className="h-16 rounded bg-slate-100 motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </section>
  );
}
