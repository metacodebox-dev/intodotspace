import React from 'react';

interface RadialProgressGaugeProps {
  value?: number;
  label?: string;
  className?: string;
}

export const RadialProgressGauge: React.FC<RadialProgressGaugeProps> = ({
  value = 35,
  label,
  className = '',
}) => {
  // Gauge geometry
  const svgSize = 280;
  const center = svgSize / 2;
  const radius = 110;
  const strokeWidth = 22;
  
  // Arc configuration: 180° total sweep (half circle)
  const totalSweepDeg = 180;
  const gapDeg = 6; // Transparent gap between the two progress arcs
  
  // Positive progress (YES) - value provided
  const positivePercent = Math.max(0, Math.min(100, value));
  // Negative progress (NO) - complement of positive
  const negativePercent = 100 - positivePercent;
  
  // Convert degrees to radians
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  
  // Get point on circle
  const getPoint = (angleDeg: number) => ({
    x: center + radius * Math.cos(toRad(angleDeg)),
    y: center - radius * Math.sin(toRad(angleDeg)), // SVG y is inverted
  });
  
  // Generate arc path
  const createArcPath = (fromAngle: number, toAngle: number) => {
    if (Math.abs(fromAngle - toAngle) < 1) return ''; // Skip tiny arcs
    const start = getPoint(fromAngle);
    const end = getPoint(toAngle);
    
    let sweep = fromAngle - toAngle;
    if (sweep < 0) sweep += 360;
    
    const largeArc = sweep > 180 ? 1 : 0;
    const sweepFlag = 1; // clockwise in SVG
    
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${end.x} ${end.y}`;
  };
  
  // Both arcs split the available space (180° minus gap) proportionally
  // Positive arc: left side, Negative arc: right side, gap in the middle
  
  // Positive progress arc (green): starts at 180° (left), moves clockwise toward center
  const positiveSweep = (positivePercent / 100) * (totalSweepDeg - gapDeg);
  const positiveStartAngle = 180;
  const positiveEndAngle = positiveStartAngle - positiveSweep;
  const positivePath = positivePercent > 0 ? createArcPath(positiveStartAngle, positiveEndAngle) : '';
  
  // Negative progress arc (gray): ends at 0° (right), moves counter-clockwise toward center
  const negativeSweep = (negativePercent / 100) * (totalSweepDeg - gapDeg);
  const negativeEndAngle = 0;
  const negativeStartAngle = negativeEndAngle + negativeSweep;
  const negativePath = negativePercent > 0 ? createArcPath(negativeStartAngle, negativeEndAngle) : '';

  const displayLabel = label ?? `${positivePercent}%`;

  return (
    <div 
      className={`relative flex items-center justify-center ${className}`}
      style={{ 
        width: 380, 
        height: 285,
        background: 'linear-gradient(135deg, #1A1A1A 0%, #0F0F0F 100%)',
      }}
    >
      {/* Subtle vignette overlay */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(0,0,0,0.3) 100%)',
        }}
      />
      
      {/* SVG Gauge */}
      <svg 
        width={svgSize} 
        height={svgSize} 
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        className="relative z-10"
      >
        {/* Negative progress arc (gray) - NO side - both ends rounded */}
        {negativePath && (
          <path
            d={negativePath}
            fill="none"
            stroke="#2a2a2a"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}
        
        {/* Positive progress arc (green) - YES side - both ends rounded */}
        {positivePath && (
          <path
            d={positivePath}
            fill="none"
            stroke="#6CBE45"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}
      </svg>
      
      {/* Center text - positioned slightly below arc center */}
      <div 
        className="absolute inset-0 flex items-center justify-center z-20"
        style={{ paddingTop: 40 }}
      >
        <span 
          className="text-white"
          style={{ 
            fontSize: 80,
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          {displayLabel}
        </span>
      </div>
    </div>
  );
};

// Example usage component
export const RadialProgressGaugeExample: React.FC = () => {
  return (
    <div className="p-8 bg-black min-h-screen flex items-center justify-center">
      <RadialProgressGauge value={35} />
    </div>
  );
};

export default RadialProgressGauge;
