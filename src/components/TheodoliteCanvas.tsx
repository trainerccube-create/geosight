import React, { useEffect, useRef, useCallback } from 'react';

export interface TelemetryState {
  azimuth: number;    // 0 to 360 degrees
  pitch: number;      // -90 to +90 degrees
  roll: number;       // -180 to +180 degrees
  rawAzimuth?: number;
  rawPitch?: number;
  rawRoll?: number;
}

interface TheodoliteCanvasProps {
  telemetry: TelemetryState;
  baselineDistance?: number;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  zoomFactor: number;
  isTargetLocked: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  useSyntheticCamera: boolean;
  onPan?: (deltaAz: number, deltaPitch: number) => void;
  onZoomChange?: (newZoom: number) => void;
}

export const TheodoliteCanvas: React.FC<TheodoliteCanvasProps> = ({
  telemetry,
  baselineDistance = 25.0,
  latitude,
  longitude,
  altitude,
  zoomFactor,
  isTargetLocked,
  videoRef,
  useSyntheticCamera,
  onPan,
  onZoomChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; dist?: number } | null>(null);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const center = { x: width / 2, y: height / 2 };

      // Clear & Background / Camera Preview
      if (!useSyntheticCamera && videoRef?.current && videoRef.current.readyState >= 2) {
        ctx.save();
        const v = videoRef.current;
        let sWidth = v.videoWidth / zoomFactor;
        let sHeight = v.videoHeight / zoomFactor;
        let sx = (v.videoWidth - sWidth) / 2;
        let sy = (v.videoHeight - sHeight) / 2;

        ctx.drawImage(v, sx, sy, sWidth, sHeight, 0, 0, width, height);
        ctx.fillStyle = 'rgba(10, 15, 29, 0.35)';
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      } else {
        renderSyntheticSurveyEnvironment(ctx, width, height, telemetry, zoomFactor);
      }

      // Dynamic scaling factor based on viewport width (mobile vs desktop)
      const scale = Math.min(1.0, Math.max(0.72, width / 640));

      const reticleColor = isTargetLocked ? '#ef4444' : '#f59e0b';
      const accentCyan = '#06b6d4';
      const horizonColor = 'rgba(16, 185, 129, 0.9)';

      // 1. Viewfinder Brackets
      drawOpticalFrame(ctx, width, height, reticleColor, scale);

      // 2. Horizon Level
      drawArtificialHorizon(ctx, center, telemetry.roll, horizonColor, scale);

      // 3. Central Reticle & Stadia
      drawPrecisionCrosshair(ctx, center, reticleColor, accentCyan, scale);

      // 4. Azimuth Tape at Top
      drawAzimuthTape(ctx, width, telemetry.azimuth, reticleColor, scale);

      // 5. Pitch Ladder on Right
      drawPitchLadder(ctx, width, height, telemetry.pitch, reticleColor, scale);

      // 6. Total Station Trigonometry Real-Time Calculations
      const pitchRad = (telemetry.pitch * Math.PI) / 180.0;
      const verticalDist = baselineDistance * Math.tan(pitchRad);
      const horizontalDist = baselineDistance;
      const cosPitch = Math.abs(Math.cos(pitchRad));
      const slopeDist = cosPitch > 0.001 ? baselineDistance / cosPitch : baselineDistance;

      drawTotalStationTrigHUD(
        ctx,
        width,
        height,
        baselineDistance,
        verticalDist,
        horizontalDist,
        slopeDist,
        scale
      );

      // 7. Responsive Telemetry HUD
      drawTelemetryHUD(ctx, width, height, telemetry, latitude, longitude, altitude, zoomFactor, isTargetLocked, scale);

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [telemetry, baselineDistance, latitude, longitude, altitude, zoomFactor, isTargetLocked, useSyntheticCamera, videoRef]);

  // Touch and pointer dragging to pan orientation directly on canvas
  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        dist: Math.hypot(dx, dy),
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!touchStartRef.current || isTargetLocked) return;

    if (e.touches.length === 1 && touchStartRef.current) {
      const deltaX = e.touches[0].clientX - touchStartRef.current.x;
      const deltaY = e.touches[0].clientY - touchStartRef.current.y;

      // Sensitivity: ~0.35 degrees per screen pixel
      const sens = 0.28;
      onPan?.(deltaX * sens, -deltaY * sens);

      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    } else if (e.touches.length === 2 && touchStartRef.current?.dist && onZoomChange) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      const zoomDelta = (currentDist - touchStartRef.current.dist) * 0.01;

      if (Math.abs(zoomDelta) > 0.02) {
        const nextZoom = Math.max(1.0, Math.min(8.0, zoomFactor + zoomDelta));
        onZoomChange(nextZoom);
        touchStartRef.current.dist = currentDist;
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  // High-DPI canvas resizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      className="w-full h-full block cursor-crosshair select-none touch-none"
      style={{ imageRendering: 'auto' }}
    />
  );
};

// Synthetic Survey Landscape Generator (Simulates physical field terrain & benchmark stations)
function renderSyntheticSurveyEnvironment(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  telemetry: TelemetryState,
  zoomFactor: number
) {
  // Sky Gradient (Changes with pitch)
  const skyPitchShift = telemetry.pitch * 3;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
  skyGrad.addColorStop(0, '#0a192f');
  skyGrad.addColorStop(0.5, '#1e293b');
  skyGrad.addColorStop(1, '#0f172a');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Survey Coordinate Grid Matrix
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 1;
  const gridStep = 40 * zoomFactor;
  const xOffset = (-telemetry.azimuth * 6) % gridStep;
  const yOffset = (telemetry.pitch * 6) % gridStep;

  for (let x = xOffset; x < width; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = yOffset; y < height; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  // Distant mountain ridgelines shifted by Azimuth & Pitch
  ctx.save();
  const horizonY = height / 2 + telemetry.pitch * 5;

  // Mountain layer 1 (Distant)
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 20) {
    const worldAngle = telemetry.azimuth + (x - width / 2) / (10 * zoomFactor);
    const mHeight = Math.sin(worldAngle * 0.05) * 60 + Math.cos(worldAngle * 0.12) * 35;
    ctx.lineTo(x, horizonY - 40 - mHeight * zoomFactor);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Mountain layer 2 (Mid-range)
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 15) {
    const worldAngle = telemetry.azimuth + (x - width / 2) / (10 * zoomFactor);
    const mHeight = Math.sin((worldAngle + 45) * 0.08) * 45 + Math.cos(worldAngle * 0.2) * 20;
    ctx.lineTo(x, horizonY + 20 - mHeight * zoomFactor);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  // Survey ground floor
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, horizonY + 30, width, height - (horizonY + 30));

  // Survey Target Benchmark Rod in the field at Azimuth 180°
  const targetAzimuthDelta = ((180 - telemetry.azimuth + 540) % 360) - 180;
  const targetScreenX = width / 2 + targetAzimuthDelta * 12 * zoomFactor;
  const targetScreenY = horizonY + 40;

  if (targetScreenX > -50 && targetScreenX < width + 50) {
    // Draw survey rod
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(targetScreenX, targetScreenY);
    ctx.lineTo(targetScreenX, targetScreenY - 80 * zoomFactor);
    ctx.stroke();

    // Survey prism reflector prism
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(targetScreenX, targetScreenY - 80 * zoomFactor, 6 * zoomFactor, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.stroke();

    // Benchmark station label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(`BM-180 [0.8km]`, targetScreenX + 10, targetScreenY - 75 * zoomFactor);
  }

  ctx.restore();
}

function drawOpticalFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  scale: number
) {
  const pad = width < 500 ? 14 : 24;
  const len = 24 * scale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;

  // Top-Left
  ctx.beginPath();
  ctx.moveTo(pad, pad + len);
  ctx.lineTo(pad, pad);
  ctx.lineTo(pad + len, pad);
  ctx.stroke();

  // Top-Right
  ctx.beginPath();
  ctx.moveTo(width - pad - len, pad);
  ctx.lineTo(width - pad, pad);
  ctx.lineTo(width - pad, pad + len);
  ctx.stroke();

  // Bottom-Left
  ctx.beginPath();
  ctx.moveTo(pad, height - pad - len);
  ctx.lineTo(pad, height - pad);
  ctx.lineTo(pad + len, height - pad);
  ctx.stroke();

  // Bottom-Right
  ctx.beginPath();
  ctx.moveTo(width - pad - len, height - pad);
  ctx.lineTo(width - pad, height - pad);
  ctx.lineTo(width - pad, height - pad - len);
  ctx.stroke();

  ctx.restore();
}

function drawArtificialHorizon(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  roll: number,
  color: string,
  scale: number
) {
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate((-roll * Math.PI) / 180);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;

  const barHalfWidth = 120 * scale;
  const gap = 38 * scale;

  // Left horizon bar
  ctx.beginPath();
  ctx.moveTo(-barHalfWidth, 0);
  ctx.lineTo(-gap, 0);
  ctx.stroke();

  // Right horizon bar
  ctx.beginPath();
  ctx.moveTo(gap, 0);
  ctx.lineTo(barHalfWidth, 0);
  ctx.stroke();

  // Horizon roll center level pip
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 2.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPrecisionCrosshair(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  color: string,
  accent: string,
  scale: number
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;

  // Outer reticle ring
  ctx.beginPath();
  ctx.arc(center.x, center.y, 38 * scale, 0, Math.PI * 2);
  ctx.stroke();

  // Inner precision circle
  ctx.beginPath();
  ctx.arc(center.x, center.y, 16 * scale, 0, Math.PI * 2);
  ctx.stroke();

  // Center optical dot
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 4 Main Crosshair Lines
  const arm = 80 * scale;
  const gap = 8 * scale;

  // North
  ctx.beginPath();
  ctx.moveTo(center.x, center.y - arm);
  ctx.lineTo(center.x, center.y - gap);
  ctx.stroke();

  // South
  ctx.beginPath();
  ctx.moveTo(center.x, center.y + gap);
  ctx.lineTo(center.x, center.y + arm);
  ctx.stroke();

  // West
  ctx.beginPath();
  ctx.moveTo(center.x - arm, center.y);
  ctx.lineTo(center.x - gap, center.y);
  ctx.stroke();

  // East
  ctx.beginPath();
  ctx.moveTo(center.x + gap, center.y);
  ctx.lineTo(center.x + arm, center.y);
  ctx.stroke();

  // Stadia Mil-Dot Hash Marks
  const milDistances = [28 * scale, 50 * scale, 72 * scale];
  ctx.lineWidth = 1.0;
  milDistances.forEach((d) => {
    // Horizontal stadia lines
    ctx.beginPath();
    ctx.moveTo(center.x - d, center.y - 3);
    ctx.lineTo(center.x - d, center.y + 3);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center.x + d, center.y - 3);
    ctx.lineTo(center.x + d, center.y + 3);
    ctx.stroke();

    // Vertical stadia lines
    ctx.beginPath();
    ctx.moveTo(center.x - 3, center.y - d);
    ctx.lineTo(center.x + 3, center.y - d);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center.x - 3, center.y + d);
    ctx.lineTo(center.x + 3, center.y + d);
    ctx.stroke();
  });

  ctx.restore();
}

function drawAzimuthTape(
  ctx: CanvasRenderingContext2D,
  width: number,
  azimuth: number,
  accentColor: string,
  scale: number
) {
  const isMobile = width < 540;
  const tapeY = isMobile ? 42 : 52;
  const centerX = width / 2;
  const pixelsPerDegree = isMobile ? 6.5 : 8;
  const visibleHalfWidth = Math.min(isMobile ? 130 : 200, width * 0.38);

  ctx.save();

  // Tape background scrim
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(centerX - visibleHalfWidth - 8, tapeY - 18, (visibleHalfWidth + 8) * 2, 36, 6);
  ctx.fill();
  ctx.stroke();

  const startDeg = Math.floor(azimuth - visibleHalfWidth / pixelsPerDegree) - 1;
  const endDeg = Math.ceil(azimuth + visibleHalfWidth / pixelsPerDegree) + 1;

  for (let deg = startDeg; deg <= endDeg; deg++) {
    const norm = (deg % 360 + 360) % 360;
    const x = centerX + (deg - azimuth) * pixelsPerDegree;

    if (x < centerX - visibleHalfWidth || x > centerX + visibleHalfWidth) continue;

    const isCardinal = norm % 90 === 0;
    const isMajor = norm % 10 === 0;
    const tickLen = isCardinal ? 12 : isMajor ? 8 : 4;

    ctx.strokeStyle = isCardinal ? accentColor : isMajor ? '#ffffff' : 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = isCardinal ? 1.6 : isMajor ? 1.2 : 0.9;

    ctx.beginPath();
    ctx.moveTo(x, tapeY - tickLen / 2);
    ctx.lineTo(x, tapeY + tickLen / 2);
    ctx.stroke();

    if (isMajor) {
      let label = `${Math.round(norm)}°`;
      if (norm === 0) label = 'N';
      if (norm === 90) label = 'E';
      if (norm === 180) label = 'S';
      if (norm === 270) label = 'W';

      ctx.fillStyle = isCardinal ? accentColor : '#ffffff';
      ctx.font = isCardinal
        ? 'bold 10px "JetBrains Mono", monospace'
        : '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, tapeY + 14);
    }
  }

  // Pointer indicator needle
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.moveTo(centerX, tapeY - 16);
  ctx.lineTo(centerX - 5, tapeY - 22);
  ctx.lineTo(centerX + 5, tapeY - 22);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawPitchLadder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pitch: number,
  accentColor: string,
  scale: number
) {
  const isMobile = width < 540;
  const ladderX = width - (isMobile ? 32 : 44);
  const centerY = height / 2;
  const pixelsPerDegree = isMobile ? 5 : 6;
  const visibleHalfHeight = Math.min(isMobile ? 95 : 130, height * 0.32);

  ctx.save();

  const startDeg = Math.floor(pitch - visibleHalfHeight / pixelsPerDegree) - 1;
  const endDeg = Math.ceil(pitch + visibleHalfHeight / pixelsPerDegree) + 1;

  for (let deg = startDeg; deg <= endDeg; deg++) {
    if (deg < -90 || deg > 90) continue;
    const y = centerY - (deg - pitch) * pixelsPerDegree;

    if (y < centerY - visibleHalfHeight || y > centerY + visibleHalfHeight) continue;

    const isMajor = deg % 5 === 0;
    const tickLen = isMajor ? (isMobile ? 12 : 16) : 6;

    ctx.strokeStyle = isMajor ? '#ffffff' : 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = isMajor ? 1.4 : 0.9;

    ctx.beginPath();
    ctx.moveTo(ladderX - tickLen, y);
    ctx.lineTo(ladderX, y);
    ctx.stroke();

    if (isMajor && deg !== 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, ladderX - 16, y + 3);
    }
  }

  // Center pitch marker pip
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(ladderX - (isMobile ? 16 : 22), centerY);
  ctx.lineTo(ladderX, centerY);
  ctx.stroke();

  ctx.restore();
}

function drawTotalStationTrigHUD(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  baseline: number,
  vd: number,
  hd: number,
  sd: number,
  scale: number
) {
  const isMobile = width < 540;
  ctx.save();

  if (isMobile) {
    // Compact banner right above the bottom telemetry HUD
    const hudHeight = 64;
    const trigH = 26;
    const trigY = height - hudHeight - 10 - trigH - 6;
    const trigPad = 10;
    const trigW = width - trigPad * 2;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.90)';
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(trigPad, trigY, trigW, trigH, 6);
    ctx.fill();
    ctx.stroke();

    const vdSign = vd >= 0 ? '+' : '';
    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`BASE: ${baseline.toFixed(1)}m`, trigPad + 8, trigY + 17);

    ctx.fillStyle = '#10b981';
    ctx.fillText(`VD: ${vdSign}${vd.toFixed(2)}m`, trigPad + trigW * 0.38, trigY + 17);

    ctx.fillStyle = '#f59e0b';
    ctx.fillText(`HD: ${hd.toFixed(1)}m`, trigPad + trigW * 0.72, trigY + 17);
  } else {
    // Desktop / Tablet Total Station Box (Top-Left)
    const top = 56;
    const left = 18;
    const boxW = 210;
    const boxH = 68;

    ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(left, top, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL STATION ANALYSIS', left + 10, top + 14);

    // Baseline & HD
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '7px "JetBrains Mono", monospace';
    ctx.fillText('BASE DIST', left + 10, top + 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(`${baseline.toFixed(2)} m`, left + 10, top + 39);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '7px "JetBrains Mono", monospace';
    ctx.fillText('HORIZ (HD)', left + 10, top + 50);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(`${hd.toFixed(2)} m`, left + 10, top + 61);

    // VD (Height) & SD (Slope)
    const vdSign = vd >= 0 ? '+' : '';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '7px "JetBrains Mono", monospace';
    ctx.fillText('HEIGHT (VD)', left + 110, top + 26);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(`${vdSign}${vd.toFixed(2)} m`, left + 110, top + 39);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.font = '7px "JetBrains Mono", monospace';
    ctx.fillText('SLOPE (SD)', left + 110, top + 50);
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(`${sd.toFixed(2)} m`, left + 110, top + 61);
  }

  ctx.restore();
}

function drawTelemetryHUD(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  telemetry: TelemetryState,
  latitude: number | null,
  longitude: number | null,
  altitude: number | null,
  zoomFactor: number,
  isTargetLocked: boolean,
  scale: number
) {
  const isMobile = width < 540;
  const pad = isMobile ? 10 : 20;
  const hudHeight = isMobile ? 64 : 76;
  const hudY = height - hudHeight - (isMobile ? 10 : pad);
  const hudWidth = width - pad * 2;

  ctx.save();

  // Background Scrim
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.strokeStyle = isTargetLocked ? 'rgba(239, 68, 68, 0.7)' : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(pad, hudY, hudWidth, hudHeight, 8);
  ctx.fill();
  ctx.stroke();

  if (isMobile) {
    // Mobile-optimized compact layout
    const col1 = pad + 10;
    const col2 = pad + hudWidth * 0.33;
    const col3 = pad + hudWidth * 0.66;
    const row1Y = hudY + 14;
    const row2Y = hudY + 40;

    // Row 1: Orientation
    drawHUDCellMobile(ctx, 'AZ', `${telemetry.azimuth.toFixed(1)}°`, col1, row1Y, '#f59e0b');
    drawHUDCellMobile(ctx, 'EL', `${telemetry.pitch >= 0 ? '+' : ''}${telemetry.pitch.toFixed(1)}°`, col2, row1Y, '#f59e0b');
    drawHUDCellMobile(ctx, 'ROLL', `${telemetry.roll.toFixed(1)}°`, col3, row1Y, '#10b981');

    // Target lock indicator
    ctx.fillStyle = isTargetLocked ? '#ef4444' : '#10b981';
    ctx.beginPath();
    ctx.arc(pad + hudWidth - 14, row1Y + 3, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Row 2: Positioning
    const latShort = latitude !== null ? `${latitude.toFixed(4)}°N` : '37.77°N';
    const lonShort = longitude !== null ? `${Math.abs(longitude).toFixed(4)}°W` : '122.42°W';
    const altShort = altitude !== null ? `${altitude.toFixed(0)}m` : '48m';

    drawHUDCellMobile(ctx, 'POS', `${latShort}, ${lonShort}`, col1, row2Y, '#38bdf8');
    drawHUDCellMobile(ctx, 'ALT', altShort, col2, row2Y, '#38bdf8');
    drawHUDCellMobile(ctx, 'ZOOM', `${zoomFactor.toFixed(1)}x`, col3, row2Y, '#f59e0b');
  } else {
    // Desktop layout
    const row1Y = hudY + 18;
    const row2Y = hudY + 48;
    const col1 = pad + 18;
    const col2 = pad + Math.min(140, hudWidth * 0.28);
    const col3 = pad + Math.min(270, hudWidth * 0.54);

    drawHUDCell(ctx, 'BEARING (AZIMUTH)', `${telemetry.azimuth.toFixed(1)}°`, col1, row1Y, '#f59e0b');
    drawHUDCell(ctx, 'ELEVATION (PITCH)', `${telemetry.pitch >= 0 ? '+' : ''}${telemetry.pitch.toFixed(1)}°`, col2, row1Y, '#f59e0b');
    drawHUDCell(ctx, 'HORIZON (ROLL)', `${telemetry.roll.toFixed(1)}°`, col3, row1Y, '#10b981');

    // Status pip
    ctx.fillStyle = isTargetLocked ? '#ef4444' : '#10b981';
    ctx.beginPath();
    ctx.arc(pad + hudWidth - 24, row1Y + 4, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(isTargetLocked ? 'LOCKED' : 'TRACKING', pad + hudWidth - 34, row1Y + 7);

    // Line 2: Geodetic Positioning
    const latStr = latitude !== null ? `${latitude.toFixed(6)}°` : '37.774929° N';
    const lonStr = longitude !== null ? `${longitude.toFixed(6)}°` : '-122.419416° W';
    const altStr = altitude !== null ? `${altitude.toFixed(1)} m MSL` : '42.8 m MSL';

    drawHUDCell(ctx, 'LATITUDE', latStr, col1, row2Y, '#38bdf8');
    drawHUDCell(ctx, 'LONGITUDE', lonStr, col2, row2Y, '#38bdf8');
    drawHUDCell(ctx, 'ALTITUDE', altStr, col3, row2Y, '#38bdf8');
    drawHUDCell(ctx, 'OPTICS', `${zoomFactor.toFixed(1)}x`, pad + hudWidth - 50, row2Y, '#f59e0b');
  }

  ctx.restore();
}

function drawHUDCell(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  valueColor: string
) {
  ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.font = '8px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y);

  ctx.fillStyle = valueColor;
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.fillText(value, x, y + 14);
}

function drawHUDCellMobile(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  valueColor: string
) {
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  ctx.font = '7px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y);

  ctx.fillStyle = valueColor;
  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  ctx.fillText(value, x, y + 12);
}
