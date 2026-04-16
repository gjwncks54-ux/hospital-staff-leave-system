interface BrandMarkProps {
  compact?: boolean;
  className?: string;
  showWordmark?: boolean;
}

export function BrandMark({ compact = false, className = "" }: BrandMarkProps) {
  const sizeClass = compact ? "h-10 sm:h-11" : "h-16 sm:h-20";

  return (
    <img
      src="/brand-wordmark.png"
      alt="우리베스트내과의원 내과·검진센터"
      className={`${sizeClass} w-auto max-w-full object-contain ${className}`.trim()}
    />
  );
}
