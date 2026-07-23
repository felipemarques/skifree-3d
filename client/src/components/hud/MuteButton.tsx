import { Music, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MuteButton({ visible, muted, onToggle }: { visible: boolean; muted: boolean; onToggle(): void }) {
  if (!visible) return null;
  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      className="pointer-events-auto fixed right-4 top-4 z-[200] h-10 w-10 bg-slate-950/55 backdrop-blur max-sm:right-2.5 max-sm:top-2.5"
      aria-label="Toggle sound"
      onClick={onToggle}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Music className="h-4 w-4" />}
    </Button>
  );
}
