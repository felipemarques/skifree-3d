export function Hearts({ hp, flashKey }: { hp: number; flashKey: number }) {
  return (
    <div className="flex h-6 items-center gap-1.5" role="img" aria-label={`Health: ${hp} of 3`}>
      {[0, 1, 2].map(index => (
        <span
          key={`${index}-${flashKey}`}
          aria-hidden="true"
          className={`text-xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)] ${index >= hp ? 'text-white/30 opacity-60 grayscale' : 'heart-pop text-white'}`}
        >
          &hearts;
        </span>
      ))}
      {/* Visually hidden - its text content changing on every hp update is
          what makes a screen reader announce damage/heal, not the icons
          above (aria-hidden, purely decorative). */}
      <span className="sr-only" aria-live="polite">{`Health: ${hp} of 3`}</span>
    </div>
  );
}
