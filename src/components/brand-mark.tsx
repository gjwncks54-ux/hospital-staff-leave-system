interface BrandMarkProps {
  compact?: boolean;
  showWordmark?: boolean;
}

export function BrandMark({ compact = false, showWordmark = true }: BrandMarkProps) {
  const iconSize = compact ? "h-12 w-12" : "h-16 w-16";

  return (
    <div className="flex items-center gap-3">
      <div className={`relative ${iconSize}`}>
        <div className="absolute inset-0 rounded-full border-[8px] border-brand-slate/95" />
        <div className="absolute bottom-0 right-0 h-[78%] w-[78%] rounded-full border-[8px] border-accent" />
      </div>
      {showWordmark ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-slate/55">Sojung Hospital</p>
          <h1 className={`${compact ? "text-lg" : "text-[1.95rem]"} font-semibold tracking-tight text-brand-slate`}>
            소중한병원 휴가관리
          </h1>
        </div>
      ) : null}
    </div>
  );
}
