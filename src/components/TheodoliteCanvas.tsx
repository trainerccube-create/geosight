import React, { useEffect, useRef } from 'react';

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
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  zoomFactor: number;
  isTargetLocked: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  useSyntheticCamera: boolean;
}

export const TheodoliteCanvas: React.FC<TheodoliteCanvasProps> = ({
  telemetry,
  latitude,
  longitude,
  altitude,
  zoomFactor,
  isTargetLocked,
  videoRef,
  useSyntheticCamera,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const center = { x: width / 2, y: height / 2 };

      // 1. Clear & Background / Camera Preview
      if (!useSyntheticCamera && videoRef?.current && videoRef.current.readyState >= 2) {
        ctx.save();
        // Zoom crop
        const v = videoRef.current;
        const vAspect = v.videoWidth / v.videoHeight;
        const cAspect = width / height;
        let sWidth = v.videoWidth / zoomFactor;
        let sHeight = v.videoHeight / zoomFactor;
        let sx = (v.videoWidth - sWidth) / 2;
        let sy = (v.videoHeight - sHeight) / 2;

        ctx.drawImage(v, sx, sy, sWidth, sHeight, 0, 0, width, height);
        // Dark contrast scrim for HUD readability
        ctx.fillStyle = 'rgba(10, 15, 29, 0.35)';
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      } else {
        // High-fidelity Survey Terrain Simulator
        renderSyntheticSurveyEnvironment(ctx, width, height, telemetry, zoomFactor);
      }

      // Main reticle colors
      const reticleColor = isTargetLocked ? '#ef4444' : '#f59e0b';
      const accentCyan = '#06b6d4';
      const horizonColor = 'rgba(16, 185, 129, 0.9)';

      // 2. Corner Optical Viewfinder Brackets
      drawOpticalFrame(ctx, width, height, reticleColor);

      // 3. Artificial Horizon (Roll angle rotation)
      drawArtificialHorizon(ctx, center, telemetry.roll, horizonColor);

      // 4. Central Optical Crosshairs & Stadia Mil Ticks
      drawPrecisionCrosshair(ctx, center, reticleColor, accentCyan);

      // 5. Azimuth / Compass Tape at Top
      drawAzimuthTape(ctx, width, telemetry.azimuth, reticleColor);

      // 6. Pitch / Elevation Ladder at Right
      drawPitchLadder(ctx, width, height, telemetry.pitch, reticleColor);

      // 7. Telemetry Data Panel at Bottom
      drawTelemetryHUD(ctx, width, height, telemetry, latitude, longitude, altitude, zoomFactor, isTargetLocked);

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [telemetry, latitude, longitude, altitude, zoomFactor, isTargetLocked, useSyntheticCamera, videoRef]);

  // Handle ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
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
  color: string
) {
  const pad = 24;
  const len = 28;
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
  color: string
) {
  ctx.save();
  ctx.translate(center.x, center.y);
  // Negative roll in radians
  ctx.rotate((-roll * Math.PI) / 180);

  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;

  const barHalfWidth = 140;
  const gap = 46;

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
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPrecisionCrosshair(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  color: string,
  accent: string
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;

  // Outer reticle ring
  ctx.beginPath();
  ctx.arc(center.x, center.y, 42, 0, Math.PI * 2);
  ctx.stroke();

  // Inner precision circle
  ctx.beginPath();
  ctx.arc(center.x, center.y, 18, 0, Math.PI * 2);
  ctx.stroke();

  // Center optical dot
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(center.x, center.y, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 4 Main Crosshair Lines
  const arm = 95;
  const gap = 10;

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
  const milDistances = [30, 55, 80];
  ctx.lineWidth = 1.0;
  milDistances.forEach((d) => {
    // Horizontal stadia lines
    ctx.beginPath();
    ctx.moveTo(center.x - d, center.y - 3.5);
    ctx.lineTo(center.x - d, center.y + 3.5);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center.x + d, center.y - 3.5);
    ctx.lineTo(center.x + d, center.y + 3.5);
    ctx.stroke();

    // Vertical stadia lines
    ctx.beginPath();
    ctx.moveTo(center.x - 3.5, center.y - d);
    ctx.lineTo(center.x + 3.5, center.y - d);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(center.x - 3.5, center.y + d);
    ctx.lineTo(center.x + 3.5, center.y + d);
    ctx.stroke();
  });

  ctx.restore();
}

function drawAzimuthTape(
  ctx: CanvasRenderingContext2D,
  width: number,
  azimuth: number,
  accentColor: string
) {
  const tapeY = 56;
  const centerX = width / 2;
  const pixelsPerDegree = 8;
  const visibleHalfWidth = Math.min(220, width * 0.42);

  ctx.save();

  // Tape background scrim
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(centerX - visibleHalfWidth - 10, tapeY - 20, (visibleHalfWidth + 10) * 2, 42, 6);
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
    const tickLen = isCardinal ? 14 : isMajor ? 10 : 5;

    ctx.strokeStyle = isCardinal ? accentColor : isMajor ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = isCardinal ? 1.8 : isMajor ? 1.4 : 1.0;

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
        ? 'bold 11px "JetBrains Mono", monospace'
        : '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, tapeY + 16);
    }
  }

  // Pointer indicator needle (amber chevron)
  ctx.fillStyle = accentColor;
  ctx.beginPath();
  ctx.moveTo(centerX, tapeY - 18);
  ctx.lineTo(centerX - 6, tapeY - 26);
  ctx.lineTo(centerX + 6, tapeY - 26);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawPitchLadder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pitch: number,
  accentColor: string
) {
  const ladderX = width - 42;
  const centerY = height / 2;
  const pixelsPerDegree = 6;
  const visibleHalfHeight = Math.min(140, height * 0.35);

  ctx.save();

  const startDeg = Math.floor(pitch - visibleHalfHeight / pixelsPerDegree) - 1;
  const endDeg = Math.ceil(pitch + visibleHalfHeight / pixelsPerDegree) + 1;

  for (let deg = startDeg; deg <= endDeg; deg++) {
    if (deg < -90 || deg > 90) continue;
    const y = centerY - (deg - pitch) * pixelsPerDegree;

    if (y < centerY - visibleHalfHeight || y > centerY + visibleHalfHeight) continue;

    const isMajor = deg % 5 === 0;
    const tickLen = isMajor ? 16 : 8;

    ctx.strokeStyle = isMajor ? '#ffffff' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = isMajor ? 1.5 : 1.0;

    ctx.beginPath();
    ctx.moveTo(ladderX - tickLen, y);
    ctx.lineTo(ladderX, y);
    ctx.stroke();

    if (isMajor && deg !== 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${deg > 0 ? '+' : ''}${deg}°`, ladderX - 20, y + 3);
    }
  }

  // Center pitch marker pip
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(ladderX - 22, centerY);
  ctx.lineTo(ladderX, centerY);
  ctx.stroke();

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
  isTargetLocked: boolean
) {
  const pad = 20;
  const hudHeight = 76;
  const hudY = height - hudHeight - pad;
  const hudWidth = width - pad * 2;

  ctx.save();

  // Background Scrim
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  ctx.strokeStyle = isTargetLocked ? 'rgba(239, 68, 68, 0.6)' : 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(pad, hudY, hudWidth, hudHeight, 8);
  ctx.fill();
  ctx.stroke();

  const row1Y = hudY + 18;
  const row2Y = hudY + 48;

  // Line 1: Orientation Telemetry (Azimuth, Pitch, Roll)
  const col1 = pad + 18;
  const col2 = pad + Math.min(130, hudWidth * 0.25);
  const col3 = pad + Math.min(240, hudWidth * 0.5);

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

  // Line 2: Geodetic Positioning (Lat, Long, Alt, Optics)
  const latStr = latitude !== null ? `${latitude.toFixed(6)}°` : '37.774929° N';
  const lonStr = longitude !== null ? `${longitude.toFixed(6)}°` : '-122.419416° W';
  const altStr = altitude !== null ? `${altitude.toFixed(1)} m MSL` : '42.8 m MSL';

  drawHUDCell(ctx, 'LATITUDE', latStr, col1, row2Y, '#38bdf8');
  drawHUDCell(ctx, 'LONGITUDE', lonStr, col2, row2Y, '#38bdf8');
  drawHUDCell(ctx, 'ALTITUDE', altStr, col3, row2Y, '#38bdf8');
  drawHUDCell(ctx, 'OPTICS', `${zoomFactor.toFixed(1)}x`, pad + hudWidth - 50, row2Y, '#f59e0b');

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
