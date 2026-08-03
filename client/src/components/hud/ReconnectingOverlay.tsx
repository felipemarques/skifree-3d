/**
 * Shown while GameController.startReconnecting() is waiting for socket.io's
 * auto-reconnect to land and the server to confirm a resumed seat (see
 * gameController.ts's disconnect handler and DISCONNECT_GRACE_MS on the
 * server) - unlike OrientationGate, there's no "Continue Anyway" escape
 * here, since this is a real technical wait (the local run is genuinely
 * frozen) rather than a UX gate the player can opt out of.
 */
export function ReconnectingOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-3 bg-slate-950/80 px-6 text-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-cyan-300" />
      <div className="text-lg font-black text-white">Reconnecting…</div>
      <div className="text-sm text-[#c7d6ea]">Your run is on hold - it'll pick up right where it left off.</div>
    </div>
  );
}
