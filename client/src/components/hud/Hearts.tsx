export function Hearts({ hp, flashKey }: { hp: number; flashKey: number }) {
  return (
    <div className="flex h-6 items-center gap-1.5">
      {[0, 1, 2].map(index => (
        <span
          key={`${index}-${flashKey}`}
          className={`text-xl leading-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.45)] ${index >= hp ? 'text-white/30 opacity-60 grayscale' : 'heart-pop text-white'}`}
        >
          &hearts;
        </span>
      ))}
    </div>
  );
}
