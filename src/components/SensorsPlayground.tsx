import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Activity, ShieldCheck, Zap, Info, Compass, ShieldAlert } from 'lucide-react';

interface SensorsPlaygroundProps {
  alpha: number;
  onAlphaChange: (alpha: number) => void;
  isSimulatingJitter: boolean;
  onToggleJitter: (val: boolean) => void;
  rawAzimuth: number;
  filteredAzimuth: number;
  rawPitch: number;
  filteredPitch: number;
  rawRoll: number;
  filteredRoll: number;
}

export const SensorsPlayground: React.FC<SensorsPlaygroundProps> = ({
  alpha,
  onAlphaChange,
  isSimulatingJitter,
  onToggleJitter,
  rawAzimuth,
  filteredAzimuth,
  rawPitch,
  filteredPitch,
  rawRoll,
  filteredRoll,
}) => {
  const oscCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<{ raw: number[]; filtered: number[] }>({
    raw: [],
    filtered: [],
  });

  // Track historical waveform data for the real-time oscilloscope
  useEffect(() => {
    const history = historyRef.current;
    history.raw.push(rawAzimuth);
    history.filtered.push(filteredAzimuth);

    if (history.raw.length > 120) {
      history.raw.shift();
      history.filtered.shift();
    }
  }, [rawAzimuth, filteredAzimuth]);

  // Responsive canvas resizing with DPR support
  useEffect(() => {
    const canvas = oscCanvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Render oscilloscope at 30/60 fps
  useEffect(() => {
    const canvas = oscCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const renderOsc = () => {
      const w = canvas.width;
      const h = canvas.height;
      const { raw, filtered } = historyRef.current;

      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let y = 20; y < h; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      if (raw.length < 2) {
        animId = requestAnimationFrame(renderOsc);
        return;
      }

      // Min/Max in window
      let minVal = Math.min(...raw, ...filtered);
      let maxVal = Math.max(...raw, ...filtered);
      if (maxVal - minVal < 2) {
        minVal -= 1;
        maxVal += 1;
      }

      const mapY = (val: number) => {
        const norm = (val - minVal) / (maxVal - minVal);
        return h - (norm * (h - 24) + 12);
      };

      // Draw Raw Signal (Red jittery line)
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < raw.length; i++) {
        const x = (i / 120) * w;
        const y = mapY(raw[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Draw Filtered Signal (Smooth Emerald line)
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      for (let i = 0; i < filtered.length; i++) {
        const x = (i / 120) * w;
        const y = mapY(filtered[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      animId = requestAnimationFrame(renderOsc);
    };

    renderOsc();
    return () => cancelAnimationFrame(animId);
  }, []);

  const currentJitterDelta = Math.abs(rawAzimuth - filteredAzimuth);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-500" />
            Sensor Fusion & Low-Pass Filter Lab
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time Exponential Moving Average (EMA) and 360° Circular Angle Unwrapping.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleJitter(!isSimulatingJitter)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors flex items-center gap-1.5 ${
              isSimulatingJitter
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-400'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            {isSimulatingJitter ? (
              <>
                <Zap className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                Handheld Jitter: Active
              </>
            ) : (
              <>
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                Simulate Handshake
              </>
            )}
          </button>
        </div>
      </div>

      {/* Real-time Oscilloscope */}
      <div>
        <div className="flex items-center justify-between text-xs mb-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2.5 h-1 bg-red-500 rounded-sm inline-block" />
              Raw IMU Signal (High Jitter)
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2.5 h-1 bg-emerald-500 rounded-sm inline-block" />
              Filtered Azimuth (Smooth)
            </span>
          </div>
          <span className="font-mono text-slate-400 text-[11px]">
            Δ Jitter Variance: <span className="text-amber-400 font-semibold">{currentJitterDelta.toFixed(2)}°</span>
          </span>
        </div>

        <div className="rounded-lg overflow-hidden border border-slate-800 relative h-36">
          <canvas
            ref={oscCanvasRef}
            width={480}
            height={144}
            className="w-full h-full block"
          />
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-slate-950/80 rounded border border-slate-800 text-[10px] font-mono text-slate-400">
            Sampling: 60Hz IMU
          </div>
        </div>
      </div>

      {/* Alpha Slider & Presets */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
            Filter Smoothing Factor (&alpha;)
            <span className="text-slate-500 font-mono text-[11px]">(EMA Weight)</span>
          </label>
          <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            &alpha; = {alpha.toFixed(2)}
          </span>
        </div>

        <div className="py-2">
          <input
            type="range"
            min="0.02"
            max="0.80"
            step="0.01"
            value={alpha}
            onChange={(e) => onAlphaChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 touch-pan-x"
          />
        </div>

        {/* Presets */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <button
            onClick={() => onAlphaChange(0.06)}
            className={`p-3 rounded-lg border text-left transition-colors min-h-[44px] ${
              Math.abs(alpha - 0.06) < 0.02
                ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="text-xs font-semibold">Heavy Damping</div>
            <div className="text-[11px] text-slate-500 font-mono">&alpha; = 0.06 (Zero shake)</div>
          </button>

          <button
            onClick={() => onAlphaChange(0.18)}
            className={`p-3 rounded-lg border text-left transition-colors min-h-[44px] ${
              Math.abs(alpha - 0.18) < 0.02
                ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="text-xs font-semibold text-emerald-400">Field Recommended</div>
            <div className="text-[11px] text-slate-500 font-mono">&alpha; = 0.18 (Survey standard)</div>
          </button>

          <button
            onClick={() => onAlphaChange(0.45)}
            className={`p-3 rounded-lg border text-left transition-colors min-h-[44px] ${
              Math.abs(alpha - 0.45) < 0.02
                ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="text-xs font-semibold">Tripod / High Speed</div>
            <div className="text-[11px] text-slate-500 font-mono">&alpha; = 0.45 (Fast pan)</div>
          </button>
        </div>
      </div>

      {/* Numerical Telemetry Comparison Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-800 pt-4">
        <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400">AZIMUTH (BEARING)</div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="font-mono text-xs text-red-400">{rawAzimuth.toFixed(1)}°</span>
            <span className="font-mono text-sm font-bold text-emerald-400">{filteredAzimuth.toFixed(1)}°</span>
          </div>
          <div className="text-[9px] text-slate-500 mt-1">Raw vs Filtered</div>
        </div>

        <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400">ELEVATION (PITCH)</div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="font-mono text-xs text-red-400">{rawPitch >= 0 ? '+' : ''}{rawPitch.toFixed(1)}°</span>
            <span className="font-mono text-sm font-bold text-emerald-400">{filteredPitch >= 0 ? '+' : ''}{filteredPitch.toFixed(1)}°</span>
          </div>
          <div className="text-[9px] text-slate-500 mt-1">Raw vs Filtered</div>
        </div>

        <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400">HORIZON (ROLL)</div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="font-mono text-xs text-red-400">{rawRoll.toFixed(1)}°</span>
            <span className="font-mono text-sm font-bold text-emerald-400">{filteredRoll.toFixed(1)}°</span>
          </div>
          <div className="text-[9px] text-slate-500 mt-1">Raw vs Filtered</div>
        </div>
      </div>

      {/* Mathematical Principle Note */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-slate-200">Why Linear Low-Pass Fails on Compass Bearings:</div>
          <p className="text-[11px] leading-relaxed">
            Standard linear interpolation fails at the North boundary ($359^\circ \to 0^\circ$). If you average $359^\circ$ and $1^\circ$ linearly with $\alpha = 0.5$, you get $180^\circ$ (South!), causing the reticle to whip $180^\circ$ backwards. GeoSight's circular modulo filter computes the shortest angular path $\Delta = ((x - y + 180) \pmod{360}) - 180$, keeping the crosshair locked and stable across $0^\circ$.
          </p>
        </div>
      </div>
    </div>
  );
};
