export default function AuthLoading() {
  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-50 h-[2px] overflow-hidden"
    >
      <span className="auth-loading-bar block h-full w-1/3 bg-foreground/80" />
      <style>{`
        @keyframes authLoadingBar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(350%); }
        }
        .auth-loading-bar { animation: authLoadingBar 1.1s cubic-bezier(0.22, 1, 0.36, 1) infinite; }
      `}</style>
    </div>
  );
}
