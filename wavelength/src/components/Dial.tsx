"use client";

type DialProps = {
  value: number;
  onChange?: (v: number) => void;
  disabled?: boolean;
  showTarget?: number;
  leftLabel?: string;
  rightLabel?: string;
  size?: number;
};

export function Dial({
  value,
  onChange,
  disabled,
  showTarget,
  leftLabel = "Left",
  rightLabel = "Right",
  size = 280,
}: DialProps) {
  const r = size / 2 - 24;
  const cx = size / 2;
  const cy = size / 2 + 10;
  const angle = Math.PI * (1 - value);
  const nx = cx + r * Math.cos(angle);
  const ny = cy - r * Math.sin(angle);

  const handlePointer = (clientX: number, clientY: number, el: SVGSVGElement) => {
    if (disabled || !onChange) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left - cx;
    const y = cy - (clientY - rect.top);
    let a = Math.atan2(y, x);
    if (a < 0) a += 2 * Math.PI;
    let t = 1 - a / Math.PI;
    t = Math.max(0, Math.min(1, t));
    onChange(t);
  };

  const targetAngle = showTarget !== undefined ? Math.PI * (1 - showTarget) : null;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width={size}
        height={size * 0.65}
        className="touch-none select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handlePointer(e.clientX, e.clientY, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1 && e.pointerType === "mouse") return;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          handlePointer(e.clientX, e.clientY, e.currentTarget);
        }}
      >
        <defs>
          <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="50%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="url(#arcGrad)"
          strokeWidth={14}
          strokeLinecap="round"
        />
        {showTarget !== undefined && targetAngle !== null && (
          <path
            d={`M ${cx} ${cy} L ${cx + (r - 8) * Math.cos(targetAngle)} ${cy - (r - 8) * Math.sin(targetAngle)}`}
            stroke="#22d3ee"
            strokeWidth={4}
            strokeLinecap="round"
            opacity={0.9}
          />
        )}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="#fafafa"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={8} fill="#fafafa" />
      </svg>
      <div className="flex w-full max-w-xs justify-between px-2 text-xs font-medium text-violet-200/90">
        <span className="max-w-[40%] text-left">{leftLabel}</span>
        <span className="max-w-[40%] text-right">{rightLabel}</span>
      </div>
    </div>
  );
}
