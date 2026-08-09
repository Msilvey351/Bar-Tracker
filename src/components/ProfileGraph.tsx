import type { RirProfileData } from "@/hooks/useVelocityProfile";
import { getProfileTrendline } from "@/lib/vbtMath";

interface Props {
  profile: RirProfileData[];
}

export function ProfileGraph({ profile }: Props) {
  if (profile.length < 2) return null;

  const trendline = getProfileTrendline(profile);
  
  // Graph dimensions
  const width = 300;
  const height = 150;
  const padding = { top: 10, right: 10, bottom: 20, left: 30 };

  // Find max/min ranges for the graph
  const maxRir = Math.max(...profile.map(p => p.rir), 6); // At least go out to 6 RIR
  const maxVelocity = Math.max(...profile.map(p => p.avgVelocity), 0.6);

  // Helper functions to map data values to SVG pixel coordinates
  const getX = (rir: number) => padding.left + (rir / maxRir) * (width - padding.left - padding.right);
  const getY = (vel: number) => height - padding.bottom - (vel / maxVelocity) * (height - padding.top - padding.bottom);

  // Calculate the Trendline start and end coordinates
  const trendStartX = getX(0);
  const trendStartY = trendline ? getY(trendline.intercept) : 0;
  const trendEndX = getX(maxRir);
  const trendEndY = trendline ? getY(trendline.slope * maxRir + trendline.intercept) : 0;

  return (
    <div className="w-full overflow-hidden bg-black/30 rounded-xl border border-white/5 p-4 mt-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible">
        
        {/* Y Axis (Velocity) */}
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="rgba(255,255,255,0.2)" />
        <text x={padding.left - 5} y={padding.top + 5} fontSize="8" fill="rgba(255,255,255,0.4)" textAnchor="end">{maxVelocity.toFixed(2)}</text>
        <text x={padding.left - 5} y={height - padding.bottom} fontSize="8" fill="rgba(255,255,255,0.4)" textAnchor="end">0.0</text>
        
        {/* X Axis (RIR) */}
        <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="rgba(255,255,255,0.2)" />
        <text x={width - padding.right} y={height - padding.bottom + 12} fontSize="8" fill="rgba(255,255,255,0.4)" textAnchor="middle">{maxRir} RIR</text>
        <text x={padding.left} y={height - padding.bottom + 12} fontSize="8" fill="rgba(255,255,255,0.4)" textAnchor="middle">0</text>

        {/* Trendline */}
        {trendline && (
          <line 
            x1={trendStartX} y1={trendStartY} 
            x2={trendEndX} y2={trendEndY} 
            stroke="#f97316" // Orange-500
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        )}

        {/* Data Points */}
        {profile.map((p, i) => (
          <g key={i}>
            <circle 
              cx={getX(p.rir)} 
              cy={getY(p.avgVelocity)} 
              r={p.sampleSize > 2 ? 4 : 2} // Bigger circle if we have high confidence
              fill="#10b981" // Emerald-500
            />
          </g>
        ))}

      </svg>
      <div className="text-center text-[10px] text-white/40 mt-2">
        Velocity (Y) vs. RIR (X) — Past 3 Months
      </div>
    </div>
  );
}