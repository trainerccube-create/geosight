import React, { useRef, useEffect, useState } from 'react';
import { SurveyRecord } from './SurveyLogManager';
import { ZoomIn, ZoomOut, RotateCcw, MapPin, Eye, Compass, Layers } from 'lucide-react';

interface RadarPlotterCanvasProps {
  entries: SurveyRecord[];
  currentAzimuth: number;
  currentBaselineDistance: number;
  currentNorthing: number;
  currentEasting: number;
  currentZenith: number;
  currentFeatureCode: 'BM' | 'BND' | 'TOPO' | 'UTIL';
  onSelectStation?: (station: SurveyRecord) => void;
}

export const RadarPlotterCanvas: React.FC<RadarPlotterCanvasProps> = ({
  entries,
  currentAzimuth,
  currentBaselineDistance,
  currentNorthing,
  currentEasting,
  currentZenith,
  currentFeatureCode,
  onSelectStation,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedPoint, setSelectedPoint] = useState<SurveyRecord | null>(null);
  const isDraggingRef = useRef(false);
  const lastMousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset view to origin
  const handleResetView = () => {
    setZoomScale(1.0);
    setPanOffset({ x: 0, y: 0 });
    setSelectedPoint(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const displayW = rect.width;
      const displayH = rect.height;

      if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background: Dark radar grid
      ctx.fillStyle = '#050b14';
      ctx.fillRect(0, 0, displayW, displayH);

      const centerX = displayW / 2 + panOffset.x;
      const centerY = displayH / 2 + panOffset.y;

      // Determine appropriate meter-to-pixel scale factor
      // Calculate max distance among entries and current target
      let maxDist = Math.max(currentBaselineDistance, 30);
      entries.forEach((e) => {
        const d = Math.hypot(e.northing ?? 0, e.easting ?? 0);
        if (d > maxDist) maxDist = d;
      });

      // Fit max distance in 40% of the canvas dimension
      const basePixelsPerMeter = (Math.min(displayW, displayH) * 0.4) / (maxDist || 30);
      const ppm = basePixelsPerMeter * zoomScale; // Pixels per meter

      // Determine ring intervals: 5m, 10m, 20m, 50m, 100m
      let ringInterval = 10;
      if (maxDist / zoomScale > 150) ringInterval = 50;
      else if (maxDist / zoomScale > 80) ringInterval = 25;
      else if (maxDist / zoomScale < 25) ringInterval = 5;

      // Draw faint rectangular coordinate grid (10m cells)
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.45)';
      ctx.lineWidth = 0.8;
      const gridCell = ringInterval * ppm;
      const startX = (centerX % gridCell) - gridCell;
      for (let x = startX; x < displayW; x += gridCell) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, displayH);
        ctx.stroke();
      }
      const startY = (centerY % gridCell) - gridCell;
      for (let y = startY; y < displayH; y += gridCell) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(displayW, y);
        ctx.stroke();
      }

      // Draw Concentric Radar Distance Rings
      const maxRings = 8;
      for (let i = 1; i <= maxRings; i++) {
        const rMeters = i * ringInterval;
        const rPixels = rMeters * ppm;
        if (rPixels > Math.max(displayW, displayH) * 1.5) break;

        ctx.strokeStyle = i % 2 === 0 ? 'rgba(6, 182, 212, 0.28)' : 'rgba(51, 65, 85, 0.4)';
        ctx.lineWidth = i % 2 === 0 ? 1.2 : 0.8;
        ctx.beginPath();
        ctx.arc(centerX, centerY, rPixels, 0, Math.PI * 2);
        ctx.stroke();

        // Distance Label along North Axis
        ctx.fillStyle = 'rgba(6, 182, 212, 0.65)';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${rMeters}m`, centerX + 4, centerY - rPixels + 10);
      }

      // Draw Major Cross Axes (Northing: Y up / Screen Y down; Easting: X right)
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.lineWidth = 1.0;
      // East-West axis
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(displayW, centerY);
      ctx.stroke();

      // North-South axis
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, displayH);
      ctx.stroke();

      // Cardinal direction letters
      ctx.fillStyle = '#06b6d4';
      ctx.font = 'bold 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N (+Northing)', centerX, 20);
      ctx.fillText('S (-Northing)', centerX, displayH - 12);
      ctx.textAlign = 'right';
      ctx.fillText('W (-Easting)', 85, centerY - 6);
      ctx.textAlign = 'left';
      ctx.fillText('E (+Easting)', displayW - 90, centerY - 6);

      // Station Origin Monument Marker (0,0, Z_base)
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('STATION STN-0 (0,0)', centerX + 10, centerY + 14);

      // Live Aiming Line of Sight (LOS) Vector
      const azRad = (currentAzimuth * Math.PI) / 180.0;
      // In survey coordinates: North = +Y (screen -Y), East = +X (screen +X)
      // Azimuth 0 = North, 90 = East, 180 = South, 270 = West
      const targetScreenX = centerX + currentEasting * ppm;
      const targetScreenY = centerY - currentNorthing * ppm;

      // Draw dynamic sweep beam / line of sight
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(targetScreenX, targetScreenY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Live Target Reticle Point on Radar
      ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
      ctx.beginPath();
      ctx.arc(targetScreenX, targetScreenY, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(targetScreenX, targetScreenY, 7, 0, Math.PI * 2);
      ctx.stroke();

      // Crosshairs inside live target
      ctx.beginPath();
      ctx.moveTo(targetScreenX - 10, targetScreenY);
      ctx.lineTo(targetScreenX + 10, targetScreenY);
      ctx.moveTo(targetScreenX, targetScreenY - 10);
      ctx.lineTo(targetScreenX, targetScreenY + 10);
      ctx.stroke();

      // Live Target Tag Box
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
      ctx.lineWidth = 1;
      const tagW = 120;
      const tagH = 34;
      const tagX = Math.min(displayW - tagW - 10, Math.max(10, targetScreenX + 12));
      const tagY = Math.min(displayH - tagH - 10, Math.max(10, targetScreenY - 36));

      ctx.beginPath();
      ctx.roundRect(tagX, tagY, tagW, tagH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`AIM [${currentFeatureCode}] @ ${currentAzimuth.toFixed(1)}°`, tagX + 6, tagY + 12);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(
        `N:${currentNorthing >= 0 ? '+' : ''}${currentNorthing.toFixed(1)}m E:${
          currentEasting >= 0 ? '+' : ''
        }${currentEasting.toFixed(1)}m`,
        tagX + 6,
        tagY + 24
      );

      // Plot all Logged Survey Station Coordinates
      entries.forEach((entry, idx) => {
        const ptN = entry.northing ?? 0;
        const ptE = entry.easting ?? 0;
        const ptX = centerX + ptE * ppm;
        const ptY = centerY - ptN * ppm;

        const isSelected = selectedPoint?.id === entry.id;

        // Distinct Feature Code Palette & Marker Style
        let codeColor = '#06b6d4'; // default TOPO
        let markerShape: 'square' | 'circle' | 'diamond' | 'triangle' = 'circle';

        const code = entry.featureCode || 'TOPO';
        if (code === 'BM') {
          codeColor = '#f59e0b'; // Amber
          markerShape = 'diamond';
        } else if (code === 'BND') {
          codeColor = '#10b981'; // Emerald
          markerShape = 'square';
        } else if (code === 'UTIL') {
          codeColor = '#a855f7'; // Purple
          markerShape = 'triangle';
        } else {
          codeColor = '#06b6d4'; // Cyan TOPO
          markerShape = 'circle';
        }

        // Draw connecting vector line from station (faint)
        ctx.strokeStyle = `${codeColor}33`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(ptX, ptY);
        ctx.stroke();

        // Draw marker
        ctx.fillStyle = codeColor;
        ctx.strokeStyle = isSelected ? '#ffffff' : '#050b14';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;

        const mSize = isSelected ? 8 : 6;

        ctx.beginPath();
        if (markerShape === 'diamond') {
          ctx.moveTo(ptX, ptY - mSize);
          ctx.lineTo(ptX + mSize, ptY);
          ctx.lineTo(ptX, ptY + mSize);
          ctx.lineTo(ptX - mSize, ptY);
          ctx.closePath();
        } else if (markerShape === 'square') {
          ctx.rect(ptX - mSize * 0.8, ptY - mSize * 0.8, mSize * 1.6, mSize * 1.6);
        } else if (markerShape === 'triangle') {
          ctx.moveTo(ptX, ptY - mSize);
          ctx.lineTo(ptX + mSize, ptY + mSize);
          ctx.lineTo(ptX - mSize, ptY + mSize);
          ctx.closePath();
        } else {
          ctx.arc(ptX, ptY, mSize, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();

        if (isSelected) {
          ctx.strokeStyle = codeColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(ptX, ptY, 14, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Point Label pill (ID + Code)
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.strokeStyle = `${codeColor}66`;
        ctx.lineWidth = 1;
        const pillText = `#${entry.id} ${code}`;
        const pillW = pillText.length * 5.8 + 10;
        const pillH = 14;
        const pillX = ptX + 8;
        const pillY = ptY - 8;

        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isSelected ? '#ffffff' : codeColor;
        ctx.font = 'bold 8px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(pillText, pillX + 5, pillY + 10);
      });

      // Bottom Radar Telemetry Status Bar
      const hudY = displayH - 34;
      ctx.fillStyle = 'rgba(2, 6, 23, 0.92)';
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(10, hudY, displayW - 20, 26, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`SCALE: 1m = ${ppm.toFixed(1)}px`, 18, hudY + 16);
      ctx.fillText(`STATIONS: ${entries.length}`, 130, hudY + 16);

      ctx.fillStyle = '#06b6d4';
      ctx.fillText(`GRID DATUM: LOCAL NEZ`, 210, hudY + 16);

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [
    entries,
    currentAzimuth,
    currentBaselineDistance,
    currentNorthing,
    currentEasting,
    currentZenith,
    currentFeatureCode,
    zoomScale,
    panOffset,
    selectedPoint,
  ]);

  // Mouse / Touch handlers for panning and point selection
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDraggingRef.current = true;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };

    // Check if clicked near any logged survey point
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const centerX = rect.width / 2 + panOffset.x;
    const centerY = rect.height / 2 + panOffset.y;

    let maxDist = Math.max(currentBaselineDistance, 30);
    entries.forEach((entry) => {
      const d = Math.hypot(entry.northing ?? 0, entry.easting ?? 0);
      if (d > maxDist) maxDist = d;
    });
    const ppm = ((Math.min(rect.width, rect.height) * 0.4) / (maxDist || 30)) * zoomScale;

    let hit: SurveyRecord | null = null;
    entries.forEach((entry) => {
      const ptX = centerX + (entry.easting ?? 0) * ppm;
      const ptY = centerY - (entry.northing ?? 0) * ppm;
      const dist = Math.hypot(clickX - ptX, clickY - ptY);
      if (dist < 18) {
        hit = entry;
      }
    });

    if (hit) {
      setSelectedPoint(hit);
      onSelectStation?.(hit);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMousePosRef.current.x;
    const dy = e.clientY - lastMousePosRef.current.y;
    lastMousePosRef.current = { x: e.clientX, y: e.clientY };
    setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  return (
    <div className="relative w-full h-full select-none overflow-hidden bg-slate-950 flex flex-col items-center justify-center">
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full cursor-crosshair touch-none"
      />

      {/* Floating Radar Controls (Top Right) */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5 z-10">
        <button
          onClick={() => setZoomScale((z) => Math.min(3.5, z * 1.25))}
          title="Zoom In Grid"
          className="w-8 h-8 rounded bg-slate-900/90 border border-slate-700 hover:border-cyan-500 text-cyan-400 flex items-center justify-center text-sm shadow-md active:scale-95 transition-transform"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoomScale((z) => Math.max(0.35, z / 1.25))}
          title="Zoom Out Grid"
          className="w-8 h-8 rounded bg-slate-900/90 border border-slate-700 hover:border-cyan-500 text-cyan-400 flex items-center justify-center text-sm shadow-md active:scale-95 transition-transform"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetView}
          title="Reset Center Datum"
          className="w-8 h-8 rounded bg-slate-900/90 border border-slate-700 hover:border-amber-500 text-amber-400 flex items-center justify-center text-sm shadow-md active:scale-95 transition-transform"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Feature Code Legend (Top Left) */}
      <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-md border border-slate-800 rounded-lg p-2 z-10 flex flex-col gap-1 shadow-lg text-[10px] font-mono">
        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Feature Codes</div>
        <div className="flex items-center gap-1.5 text-amber-400">
          <span className="w-2.5 h-2.5 bg-amber-500 transform rotate-45 inline-block"></span>
          <span className="font-semibold">BM</span>
          <span className="text-slate-400 text-[9px]">(Benchmark)</span>
        </div>
        <div className="flex items-center gap-1.5 text-emerald-400">
          <span className="w-2.5 h-2.5 bg-emerald-500 inline-block"></span>
          <span className="font-semibold">BND</span>
          <span className="text-slate-400 text-[9px]">(Boundary)</span>
        </div>
        <div className="flex items-center gap-1.5 text-cyan-400">
          <span className="w-2.5 h-2.5 bg-cyan-500 rounded-full inline-block"></span>
          <span className="font-semibold">TOPO</span>
          <span className="text-slate-400 text-[9px]">(Topography)</span>
        </div>
        <div className="flex items-center gap-1.5 text-purple-400">
          <span className="w-2.5 h-2.5 border-b-[5px] border-b-purple-500 border-x-[3px] border-x-transparent border-t-0 inline-block"></span>
          <span className="font-semibold">UTIL</span>
          <span className="text-slate-400 text-[9px]">(Utility)</span>
        </div>
      </div>

      {/* Selected Point Inspector Modal / Card */}
      {selectedPoint && (
        <div className="absolute bottom-12 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 bg-slate-900/95 border border-cyan-500/60 rounded-lg p-3 z-20 shadow-2xl backdrop-blur-md font-mono text-xs">
          <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-slate-800">
            <div className="flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">
                {selectedPoint.featureCode || 'TOPO'}
              </span>
              <span className="font-bold text-white text-sm">Station #{selectedPoint.id}</span>
            </div>
            <button
              onClick={() => setSelectedPoint(null)}
              className="text-slate-400 hover:text-white p-0.5"
            >
              ✕
            </button>
          </div>
          <div className="text-slate-300 font-semibold mb-1 text-[11px] truncate">{selectedPoint.title}</div>
          <div className="grid grid-cols-3 gap-1.5 bg-slate-950/80 p-1.5 rounded border border-slate-800 text-[10px] mb-2">
            <div>
              <span className="text-slate-500 block text-[8px]">NORTHING (N)</span>
              <span className="text-emerald-400 font-bold">
                {(selectedPoint.northing ?? 0) >= 0 ? '+' : ''}
                {(selectedPoint.northing ?? 0).toFixed(2)}m
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[8px]">EASTING (E)</span>
              <span className="text-sky-400 font-bold">
                {(selectedPoint.easting ?? 0) >= 0 ? '+' : ''}
                {(selectedPoint.easting ?? 0).toFixed(2)}m
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[8px]">ELEVATION (Z)</span>
              <span className="text-amber-400 font-bold">{(selectedPoint.trueElevation ?? selectedPoint.altitude).toFixed(2)}m</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>Az: {selectedPoint.azimuth.toFixed(1)}° | Pitch: {selectedPoint.pitch.toFixed(1)}°</span>
            <span>Dist: {(selectedPoint.baselineDistance ?? 0).toFixed(1)}m</span>
          </div>
        </div>
      )}
    </div>
  );
};
