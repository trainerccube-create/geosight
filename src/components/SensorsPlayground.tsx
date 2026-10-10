import React, { useState, useEffect, useRef } from 'react';
import { Sliders, Activity, ShieldCheck, Zap, Info, Compass, ShieldAlert, Cpu, Crosshair } from 'lucide-react';

interface SensorsPlaygroundProps {
  alpha: number;
  onAlphaChange: (alpha: number) => void;
  processNoiseQ?: number;
  onProcessNoiseChange?: (q: number) => void;
  measurementNoiseR?: number;
  onMeasurementNoiseChange?: (r: number) => void;
  kalmanGain?: number;
  errorCovarianceP?: number;
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
  processNoiseQ = 0.008,
  onProcessNoiseChange,
  measurementNoiseR = 0.08,
  onMeasurementNoiseChange,
  kalmanGain = 0.12,
  errorCovarianceP = 0.015,
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
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let i = 0; i < filtered.length; i++) {
        const x = (i / 120) * w;
        const y = mapY(filtered[i]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Current values on right
      const lastFiltered = filtered[filtered.length - 1];
      if (lastFiltered !== undefined) {
        const currentY = mapY(lastFiltered);
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(w - 6, currentY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(renderOsc);
    };

    renderOsc();
    return () => cancelAnimationFrame(animId);
  }, []);

  const currentJitterDelta = Math.abs(rawAzimuth - filteredAzimuth);
  const isLevelLocked = Math.abs(filteredPitch) <= 0.20 && Math.abs(filteredRoll) <= 0.20;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-amber-500" />
            <h2 className="text-base sm:text-lg font-bold text-white font-mono">
              Mathematical Kalman Filter Engine Lab
            </h2>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              1D STATE ARRAY
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time Kalman Filter covariance matrix predicting orientation and canceling environmental hand tremors.
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
              Kalman Filtered Signal (Mechanical Precision)
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
            Sampling: 60Hz IMU Kalman Matrix
          </div>
        </div>
      </div>

      {/* Kalman Filter Matrix Metrics & Electronic Level Badge */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
          <div className="text-[10px] font-mono text-slate-400 uppercase">Process Noise (Q)</div>
          <div className="text-sm font-mono font-bold text-cyan-400 mt-1">{processNoiseQ.toFixed(4)}</div>
          <div className="text-[9px] text-slate-500 mt-0.5">Model uncertainty</div>
        </div>

        <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
          <div className="text-[10px] font-mono text-slate-400 uppercase">Measurement Noise (R)</div>
          <div className="text-sm font-mono font-bold text-amber-400 mt-1">{measurementNoiseR.toFixed(3)}</div>
          <div className="text-[9px] text-slate-500 mt-0.5">Sensor variance</div>
        </div>

        <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
          <div className="text-[10px] font-mono text-slate-400 uppercase">Kalman Gain (K)</div>
          <div className="text-sm font-mono font-bold text-emerald-400 mt-1">{kalmanGain.toFixed(3)}</div>
          <div className="text-[9px] text-slate-500 mt-0.5">K = P / (P + R)</div>
        </div>

        <div className={`p-3 rounded-lg border transition-colors ${
          isLevelLocked
            ? 'bg-emerald-950/30 border-emerald-500/40'
            : 'bg-amber-950/20 border-amber-500/30'
        }`}>
          <div className="text-[10px] font-mono text-slate-400 uppercase flex items-center gap-1">
            <Crosshair className={`w-3 h-3 ${isLevelLocked ? 'text-emerald-400' : 'text-amber-400'}`} />
            3D Bubble Level
          </div>
          <div className={`text-sm font-mono font-bold mt-1 ${isLevelLocked ? 'text-emerald-400' : 'text-amber-400'}`}>
            {isLevelLocked ? '±0.08° LOCKED' : `TILT: ${Math.sqrt(filteredPitch * filteredPitch + filteredRoll * filteredRoll).toFixed(1)}°`}
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5">
            {isLevelLocked ? 'Dual-axis ≤ 0.20° target' : 'Alignment required'}
          </div>
        </div>
      </div>

      {/* Kalman & Smoothing Sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
              Process Noise Covariance (Q)
            </label>
            <span className="font-mono text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
              Q = {processNoiseQ.toFixed(4)}
            </span>
          </div>
          <input
            type="range"
            min="0.001"
            max="0.050"
            step="0.001"
            value={processNoiseQ}
            onChange={(e) => onProcessNoiseChange?.(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-500 touch-pan-x"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-300 flex items-center gap-2">
              Measurement Noise Covariance (R)
            </label>
            <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              R = {measurementNoiseR.toFixed(3)}
            </span>
          </div>
          <input
            type="range"
            min="0.01"
            max="0.40"
            step="0.005"
            value={measurementNoiseR}
            onChange={(e) => onMeasurementNoiseChange?.(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 touch-pan-x"
          />
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
          <div className="text-[9px] text-slate-500 mt-1">Raw vs Kalman Filtered</div>
        </div>

        <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400">ELEVATION (PITCH)</div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="font-mono text-xs text-red-400">{rawPitch >= 0 ? '+' : ''}{rawPitch.toFixed(1)}°</span>
            <span className="font-mono text-sm font-bold text-emerald-400">{filteredPitch >= 0 ? '+' : ''}{filteredPitch.toFixed(1)}°</span>
          </div>
          <div className="text-[9px] text-slate-500 mt-1">Raw vs Kalman Filtered</div>
        </div>

        <div className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800/80">
          <div className="text-[10px] font-mono text-slate-400">HORIZON (ROLL)</div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="font-mono text-xs text-red-400">{rawRoll.toFixed(1)}°</span>
            <span className="font-mono text-sm font-bold text-emerald-400">{filteredRoll.toFixed(1)}°</span>
          </div>
          <div className="text-[9px] text-slate-500 mt-1">Raw vs Kalman Filtered</div>
        </div>
      </div>

      {/* Mathematical Principle Note */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-slate-200">Industrial 1D Kalman Matrix Isolation Formula:</div>
          <p className="text-[11px] leading-relaxed">
            Unlike basic laggy low-pass filters, the 1D Kalman Filter array tracks true rotation dynamics via predictive state estimation:
            <span className="block font-mono text-cyan-300 my-1">
              P⁻ = P + Q  →  K = P⁻ / (P⁻ + R)  →  x̂ = x̂ + K·(z - x̂)  →  P = (1 - K)·P⁻
            </span>
            Combined with shortest circular angle deviation unwrapping across the 0°/360° boundary, the optical reticle tracks without lag while completely suppressing high-frequency hand tremors.
          </p>
        </div>
      </div>
    </div>
  );
};
