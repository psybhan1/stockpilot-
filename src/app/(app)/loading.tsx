export default function WorkspaceLoading() {
  // Intentionally minimal — the AppShell + canvas keep rendering around
  // this. Showing a big skeleton while navigating between tabs was
  // jarring; this lets the new page's fade-in animation do the work.
  return (
    <div
      aria-hidden
      className="fixed left-0 right-0 top-14 z-50 h-[2px] overflow-hidden"
    >
      <span className="loading-bar block h-full w-1/3 bg-foreground/80" />
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
