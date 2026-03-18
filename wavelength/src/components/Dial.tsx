"use client";

const VB = 400;
const VB_H = 472;
const CX = VB / 2;
const CY = VB / 2;
const TOTAL_R = VB / 2 - 10;
const BORDER_W = 20;
const R = TOTAL_R - BORDER_W;

const DARK = "#11163A";
const CREAM = "#E3DDD8";
const ZONE4 = "#81C0C0";
const ZONE3 = "#DA5336";
const ZONE2 = "#E9A823";

const BAND4 = 0.025;
const BAND3 = 0.07;
const BAND2 = 0.125;

const CARD_COLORS = [
  "#9ED8D8", // sky teal
  "#F4A89A", // soft coral
  "#F7D080", // warm yellow
  "#A8CCA8", // sage green
  "#E8A0B4", // dusty pink
  "#A8B8E8", // periwinkle
  "#F7B88A", // peach
  "#C4B0E8", // lavender
  "#90D4BC", // mint
  "#B0C8DA", // steel blue
  "#E8C0A0", // tan/sand
  "#C8D890", // yellow-green
];

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickCardColors(left: string, right: string): [string, string] {
  const n = CARD_COLORS.length;
  const h = simpleHash(left + "|" + right);
  const i1 = h % n;
  const i2 = (i1 + 1 + (h >> 4) % (n - 1)) % n;
  return [CARD_COLORS[i1]!, CARD_COLORS[i2]!];
}

function clamp01(t: number) {
  return Math.max(0, Math.min(1, t));
}

function sectorPath(from: number, to: number) {
  const a1 = Math.PI * (1 - from);
  const a2 = Math.PI * (1 - to);
  return [
    `M ${CX} ${CY}`,
    `L ${CX + R * Math.cos(a1)} ${CY - R * Math.sin(a1)}`,
    `A ${R} ${R} 0 0 1 ${CX + R * Math.cos(a2)} ${CY - R * Math.sin(a2)}`,
    "Z",
  ].join(" ");
}

const STAND_TOP_HALF = 80;
const STAND_BOT_HALF = 110;
const STAND_H = 60;
const STAND_Y = CY + TOTAL_R - 30;
const STAND_CR = 14;

function buildStandPath() {
  const tlx = CX - STAND_TOP_HALF, tly = STAND_Y;
  const blx = CX - STAND_BOT_HALF, bly = STAND_Y + STAND_H;
  const brx = CX + STAND_BOT_HALF, bry = STAND_Y + STAND_H;
  const trx = CX + STAND_TOP_HALF, _try = STAND_Y;

  // Left slant unit vector (top-left → bottom-left)
  const ldx = blx - tlx, ldy = bly - tly;
  const llen = Math.sqrt(ldx * ldx + ldy * ldy);
  const lux = ldx / llen, luy = ldy / llen;

  // Right slant unit vector (bottom-right → top-right)
  const rdx = trx - brx, rdy = _try - bry;
  const rlen = Math.sqrt(rdx * rdx + rdy * rdy);
  const rux = rdx / rlen, ruy = rdy / rlen;

  // Approach / depart points for bottom-left corner
  const blIn  = { x: blx - lux * STAND_CR, y: bly - luy * STAND_CR };
  const blOut = { x: blx + STAND_CR,        y: bly };

  // Approach / depart points for bottom-right corner
  const brIn  = { x: brx - STAND_CR,        y: bry };
  const brOut = { x: brx + rux * STAND_CR,  y: bry + ruy * STAND_CR };

  return [
    `M ${tlx} ${tly}`,
    `L ${blIn.x} ${blIn.y}`,
    `Q ${blx} ${bly} ${blOut.x} ${blOut.y}`,
    `L ${brIn.x} ${brIn.y}`,
    `Q ${brx} ${bry} ${brOut.x} ${brOut.y}`,
    `L ${trx} ${_try}`,
    "Z",
  ].join(" ");
}

const STAND_PATH = buildStandPath();

const STARS: { x: number; y: number; r: number }[] = [];
(() => {
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 150; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = rand() * (TOTAL_R - 2);
    const x = CX + dist * Math.cos(angle);
    const y = CY + dist * Math.sin(angle);
    const r = 0.4 + rand() * 1.4;
    STARS.push({ x, y, r });
  }
  for (let i = 0; i < 30; i++) {
    const yPos = STAND_Y + rand() * STAND_H;
    const progress = (yPos - STAND_Y) / STAND_H;
    const halfW = STAND_TOP_HALF + progress * (STAND_BOT_HALF - STAND_TOP_HALF);
    const x = CX + (rand() * 2 - 1) * halfW * 0.9;
    const r = 0.4 + rand() * 1.2;
    STARS.push({ x, y: yPos, r });
  }
})();

type DialProps = {
  value: number;
  onChange?: (v: number) => void;
  disabled?: boolean;
  showTarget?: number;
  teamNeedle?: number;
  leftLabel?: string;
  rightLabel?: string;
  mode?: "guess" | "psychic" | "reveal";
};

export function Dial({
  value,
  onChange,
  disabled,
  showTarget,
  teamNeedle,
  leftLabel = "Left",
  rightLabel = "Right",
  mode = "guess",
}: DialProps) {
  const angle = Math.PI * (1 - value);
  const nx = CX + R * Math.cos(angle);
  const ny = CY - R * Math.sin(angle);

  const target = showTarget;
  const teamAng =
    teamNeedle !== undefined ? Math.PI * (1 - clamp01(teamNeedle)) : null;

  const handlePointer = (
    clientX: number,
    clientY: number,
    el: SVGSVGElement,
  ) => {
    if (mode !== "guess" || disabled || !onChange) return;
    const rect = el.getBoundingClientRect();
    const scaleX = VB / rect.width;
    const scaleY = VB_H / rect.height;
    const x = (clientX - rect.left) * scaleX - CX;
    const y = CY - (clientY - rect.top) * scaleY;
    let a = Math.atan2(y, x);
    if (a < 0) a += 2 * Math.PI;
    let t = 1 - a / Math.PI;
    t = clamp01(t);
    onChange(t);
  };

  const showZones = mode === "psychic" || mode === "reveal";
  const showSolidNeedle = mode === "guess" || mode === "reveal";
  const showFadedNeedle = mode === "psychic" && teamAng !== null;

  const cr = 9;
  const rArcEndX = CX + Math.sqrt(R * R - cr * cr);
  const rArcEndY = CY - cr;
  const lArcStartX = CX - Math.sqrt(R * R - cr * cr);
  const lArcStartY = CY - cr;
  const roundedSemiD = [
    `M ${lArcStartX} ${lArcStartY}`,
    `A ${R} ${R} 0 0 1 ${rArcEndX} ${rArcEndY}`,
    `Q ${CX + R} ${CY} ${CX + R - cr} ${CY}`,
    `L ${CX - R + cr} ${CY}`,
    `Q ${CX - R} ${CY} ${lArcStartX} ${lArcStartY}`,
    "Z",
  ].join(" ");

  const cardW = R * 1.5;
  const cardH = R * 0.38;
  const cardY = CY + R * 0.18;
  const cardX = CX - cardW / 2;
  const cardRx = 10;
  const halfW = cardW / 2;

  return (
    <div className="flex w-full flex-col items-center">
      <svg
        viewBox={`0 0 ${VB} ${VB_H}`}
        className="w-full max-w-[520px] touch-none select-none"
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
          <clipPath id="playableAreaClip">
            <path d={roundedSemiD} />
          </clipPath>
          <filter id="shadowBlur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" />
          </filter>
        </defs>

        {/* Table shadow — blurred ellipse behind the whole game */}
        <ellipse
          cx={CX}
          cy={STAND_Y + STAND_H + 6}
          rx={STAND_BOT_HALF + 40}
          ry={14}
          fill="#000"
          opacity={0.18}
          filter="url(#shadowBlur)"
        />

        {/* Trapezoid stand */}
        <path d={STAND_PATH} fill={DARK} />

        {/* Full dark circle */}
        <circle cx={CX} cy={CY} r={TOTAL_R} fill={DARK} />

        {/* Stars scattered across dark areas */}
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="white"
            opacity={0.25 + (s.r / 1.8) * 0.45}
          />
        ))}

        {/* Everything inside the playable area — clipped to the rounded semi-circle */}
        <g clipPath="url(#playableAreaClip)">
          {/* Cream background */}
          <path d={roundedSemiD} fill={CREAM} />

          {/* Target scoring zones */}
          {showZones && target !== undefined && (
            <>
              {(() => {
                const f = clamp01(target - BAND2);
                const t = clamp01(target + BAND2);
                return t > f ? <path d={sectorPath(f, t)} fill={ZONE2} /> : null;
              })()}
              {(() => {
                const f = clamp01(target - BAND3);
                const t = clamp01(target + BAND3);
                return t > f ? <path d={sectorPath(f, t)} fill={ZONE3} /> : null;
              })()}
              {(() => {
                const f = clamp01(target - BAND4);
                const t = clamp01(target + BAND4);
                return t > f ? <path d={sectorPath(f, t)} fill={ZONE4} /> : null;
              })()}
            </>
          )}

        </g>

        {/* Faded team needle (psychic watching guessers) — on top of frame */}
        {showFadedNeedle && teamAng !== null && (
          <>
            <line
              x1={CX}
              y1={CY}
              x2={CX + R * Math.cos(teamAng)}
              y2={CY - R * Math.sin(teamAng)}
              stroke="#DC2626"
              strokeWidth={5}
              strokeLinecap="round"
              opacity={0.35}
            />
            <circle cx={CX} cy={CY} r={14} fill="#DC2626" opacity={0.35} />
          </>
        )}

        {/* Solid red needle (guesser / reveal) — on top of frame */}
        {showSolidNeedle && (
          <>
            <line
              x1={CX}
              y1={CY}
              x2={nx}
              y2={ny}
              stroke="#DC2626"
              strokeWidth={7}
              strokeLinecap="round"
            />
            <circle cx={CX} cy={CY} r={16} fill="#DC2626" />
          </>
        )}

        {/* Theme card — single rounded rect split into two halves */}
        {(() => {
          const [leftColor, rightColor] = pickCardColors(leftLabel, rightLabel);
          const textColor = "#2a2318";
          const arrowColor = "#2a2318";
          const clipId = "cardClip";
          const labelSize = 13;
          const arrowStroke = 1.5;
          const ah = 4; // arrowhead half-height
          const arrowY = cardY + 12; // near the top

          const arrowHalfLen = halfW * 0.22; // each arrow spans ~44% of its half
          const leftCX = CX - halfW / 2;  // center x of left half
          const rightCX = CX + halfW / 2; // center x of right half

          // Left arrow centered in left half, pointing left
          const laX1 = leftCX + arrowHalfLen;
          const laX2 = leftCX - arrowHalfLen;
          // Right arrow centered in right half, pointing right
          const raX1 = rightCX - arrowHalfLen;
          const raX2 = rightCX + arrowHalfLen;

          return (
            <>
              <defs>
                <clipPath id={clipId}>
                  <rect x={cardX} y={cardY} width={cardW} height={cardH} rx={cardRx} />
                </clipPath>
              </defs>
              {/* Left half */}
              <rect x={cardX} y={cardY} width={halfW} height={cardH} fill={leftColor} clipPath={`url(#${clipId})`} />
              {/* Right half */}
              <rect x={CX} y={cardY} width={halfW} height={cardH} fill={rightColor} clipPath={`url(#${clipId})`} />
              {/* Outer rounded border */}
              <rect x={cardX} y={cardY} width={cardW} height={cardH} rx={cardRx} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={1} />

              {/* Left arrow line + head */}
              <line x1={laX1} y1={arrowY} x2={laX2 + 4} y2={arrowY} stroke={arrowColor} strokeWidth={arrowStroke} />
              <polygon points={`${laX2 + 8},${arrowY - ah} ${laX2 - 2},${arrowY} ${laX2 + 8},${arrowY + ah}`} fill={arrowColor} />

              {/* Left label — foreignObject for text wrapping */}
              <foreignObject x={cardX} y={cardY} width={halfW} height={cardH}>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingTop: "18px",
                    paddingLeft: "8px",
                    paddingRight: "6px",
                    boxSizing: "border-box",
                    fontSize: `${labelSize}px`,
                    fontWeight: 600,
                    color: textColor,
                    textAlign: "center",
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                    lineHeight: 1.3,
                    fontFamily: "inherit",
                  }}
                >
                  {leftLabel}
                </div>
              </foreignObject>

              {/* Right arrow line + head */}
              <line x1={raX1} y1={arrowY} x2={raX2 - 4} y2={arrowY} stroke={arrowColor} strokeWidth={arrowStroke} />
              <polygon points={`${raX2 - 8},${arrowY - ah} ${raX2 + 2},${arrowY} ${raX2 - 8},${arrowY + ah}`} fill={arrowColor} />

              {/* Right label — foreignObject for text wrapping */}
              <foreignObject x={CX} y={cardY} width={halfW} height={cardH}>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingTop: "18px",
                    paddingLeft: "6px",
                    paddingRight: "8px",
                    boxSizing: "border-box",
                    fontSize: `${labelSize}px`,
                    fontWeight: 600,
                    color: textColor,
                    textAlign: "center",
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                    lineHeight: 1.3,
                    fontFamily: "inherit",
                  }}
                >
                  {rightLabel}
                </div>
              </foreignObject>
            </>
          );
        })()}
      </svg>
    </div>
  );
}
