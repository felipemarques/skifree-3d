import { Music, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function MuteButton({
  visible,
  muted,
  onToggle,
  className = '',
}: {
  visible: boolean;
  muted: boolean;
  onToggle(): void;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      className={`pointer-events-auto h-10 w-10 bg-slate-950/55 backdrop-blur ${className}`}
      aria-label="Toggle sound"
      onClick={onToggle}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Music className="h-4 w-4" />}
    </Button>
  );
}
