/**
 * Workspace loading skeleton — matches the glass aesthetic so the
 * transition feels like the page is assembling rather than blank.
 * The AppShell + canvas remain rendered around this.
 */
export default function WorkspaceLoading() {
  return (
    <div className="space-y-10">
      {/* Top progress bar */}
      <div
        aria-hidden
        className="fixed left-0 right-0 top-14 z-50 h-[2px] overflow-hidden"
      >
        <span className="loading-bar block h-full w-1/3 bg-foreground/80" />
      </div>

      {/* Hero skeleton */}
      <div className="border-b border-border pb-8 space-y-6">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="skeleton-line h-3 w-40" />
            <div className="skeleton-line h-14 w-2/3" />
            <div className="skeleton-line h-4 w-1/2" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 border-t border-border pt-6 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <div className="skeleton-line h-3 w-24" />
              <div className="skeleton-line h-9 w-20" />
            </div>
          ))}
        </div>
      </div>

      {/* Card grid skeleton */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="notif-card p-3 flex gap-4">
            <div className="skeleton-line size-20 rounded-2xl shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton-line h-5 w-3/4" />
              <div className="skeleton-line h-3 w-1/2" />
              <div className="skeleton-line h-[3px] w-full mt-4" />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes loadingBar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(350%); }
        }
        .loading-bar { animation: loadingBar 1.1s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
      `}</style>
    </div>
  );
}
