import React, { useEffect, useRef } from 'react';

interface StakeoutCanvasProps {
  target: {
    pointId: string;
    northing: number;
    easting: number;
    elevation: number;
  };
  currentNorthing: number;
  currentEasting: number;
  currentElevation: number;
  currentAzimuth: number;
  isAudioPingEnabled: boolean;
  onToggleAudioPing?: () => void;
  onEditTarget?: () => void;
}

export const StakeoutCanvas: React.FC<StakeoutCanvasProps> = ({
  target,
  currentNorthing,
  currentEasting,
  currentElevation,
  currentAzimuth,
  isAudioPingEnabled,
  onToggleAudioPing,
  onEditTarget,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Compute navigation vectors
  const dN = target.northing - currentNorthing;
  const dE = target.easting - currentEasting;
  const dist2D = Math.hypot(dN, dE);

  // Target bearing from current position (0° to 360°)
  const targetAz = ((Math.atan2(dE, dN) * 180.0) / Math.PI + 360.0) % 360.0;

  // Relative bearing delta (-180° to +180°)
  let bearingDelta = ((targetAz - currentAzimuth + 180.0) % 360.0) - 180.0;
  if (bearingDelta < -180.0) bearingDelta += 360.0;

  // Local vehicle / forward & lateral offsets
  const deltaRad = (bearingDelta * Math.PI) / 180.0;
  const moveForward = dist2D * Math.cos(deltaRad);
  const moveRight = dist2D * Math.sin(deltaRad);
  const cutFill = target.elevation - currentElevation;
  const isOnTarget = dist2D <= 0.05;

  // Audio Ping rate
  let pingIntervalMs = 1600;
  if (isOnTarget) pingIntervalMs = 80;
  else if (dist2D < 0.4) pingIntervalMs = 140;
  else if (dist2D < 1.2) pingIntervalMs = 280;
  else if (dist2D < 3.0) pingIntervalMs = 500;
  else if (dist2D < 8.0) pingIntervalMs = 950;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Deep Industrial Background
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, width, height);

      const center = { x: width / 2, y: height / 2 + 10 };

      // Concentric Range Target Rings
      const ringColor = 'rgba(6, 182, 212, 0.22)';
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1.0;
      for (const r of [45, 90, 135]) {
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Crosshairs through bullseye
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(center.x - 145, center.y);
      ctx.lineTo(center.x + 145, center.y);
      ctx.moveTo(center.x, center.y - 145);
      ctx.lineTo(center.x, center.y + 145);
      ctx.stroke();

      // Center Bullseye Target Ring
      const bullseyeColor = isOnTarget ? '#10b981' : '#f59e0b';
      ctx.strokeStyle = bullseyeColor;
      ctx.lineWidth = isOnTarget ? 3.0 : 1.5;
      ctx.beginPath();
      ctx.arc(center.x, center.y, 18, 0, Math.PI * 2);
      ctx.stroke();

      if (isOnTarget) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.beginPath();
        ctx.arc(center.x, center.y, 18, 0, Math.PI * 2);
        ctx.fill();
      }

      // Directional Navigation Vector Arrow pointing toward target
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate((bearingDelta * Math.PI) / 180.0);

      const arrowLen = Math.min(100, Math.max(45, dist2D * 12));
      const arrowColor = isOnTarget ? '#10b981' : '#ef4444';

      ctx.strokeStyle = arrowColor;
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -arrowLen);
      ctx.stroke();

      // Arrowhead
      ctx.fillStyle = arrowColor;
      ctx.beginPath();
      ctx.moveTo(-10, -arrowLen + 16);
      ctx.lineTo(0, -arrowLen);
      ctx.lineTo(10, -arrowLen + 16);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // Instruction Card Banner at Top
      const cardY = 16;
      const cardPad = 12;
      const cardW = width - cardPad * 2;
      const cardH = 92;

      ctx.fillStyle = 'rgba(3, 7, 18, 0.94)';
      ctx.strokeStyle = isOnTarget ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.roundRect(cardPad, cardY, cardW, cardH, 10);
      ctx.fill();
      ctx.stroke();

      // Header status
      ctx.fillStyle = isOnTarget ? '#10b981' : '#f59e0b';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      const statusTitle = isOnTarget
        ? '★ ON TARGET [BULLSEYE PRECISION LOCK] ★'
        : `NAVIGATING TO TARGET: ${target.pointId}`;
      ctx.fillText(statusTitle, width / 2, cardY + 22);

      // Distance callout
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 17px "JetBrains Mono", monospace';
      ctx.fillText(`DIST: ${dist2D.toFixed(2)} m`, width / 2, cardY + 44);

      // Explicit field directions: Forward/Back & Left/Right
      const fwdStr =
        moveForward >= 0
          ? `▲ FWD ${moveForward.toFixed(2)}m`
          : `▼ BACK ${(-moveForward).toFixed(2)}m`;
      const latStr =
        moveRight >= 0
          ? `► RIGHT ${moveRight.toFixed(2)}m`
          : `◄ LEFT ${(-moveRight).toFixed(2)}m`;
      const cfStr =
        cutFill >= 0
          ? `FILL +${cutFill.toFixed(2)}m`
          : `CUT ${cutFill.toFixed(2)}m`;

      ctx.fillStyle = '#06b6d4';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText(`${fwdStr}  |  ${latStr}  |  ${cfStr}`, width / 2, cardY + 65);

      // Audio Ping Rate and Target coordinates
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillText(
        `Sonar Pulse: ${pingIntervalMs}ms  |  Target: N=${target.northing.toFixed(2)}m, E=${target.easting.toFixed(2)}m`,
        width / 2,
        cardY + 81
      );

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [
    target,
    currentNorthing,
    currentEasting,
    currentElevation,
    currentAzimuth,
    dist2D,
    bearingDelta,
    moveForward,
    moveRight,
    cutFill,
    isOnTarget,
    pingIntervalMs,
  ]);

  return (
    <div className="relative w-full h-full select-none">
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Floating Bottom Quick Controls for Stakeout */}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-auto">
        <button
          onClick={onToggleAudioPing}
          className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold flex items-center gap-1.5 transition-colors backdrop-blur bg-slate-900/90 ${
            isAudioPingEnabled
              ? 'border-emerald-500/50 text-emerald-400'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isAudioPingEnabled ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
            }`}
          />
          {isAudioPingEnabled ? 'Sonar: Active' : 'Sonar: Muted'}
        </button>

        <button
          onClick={onEditTarget}
          className="px-3 py-1.5 rounded-lg border border-amber-500/50 bg-slate-900/90 text-amber-400 hover:text-amber-300 text-xs font-mono font-bold backdrop-blur"
        >
          Target: {target.pointId} (Edit)
        </button>
      </div>
    </div>
  );
};
