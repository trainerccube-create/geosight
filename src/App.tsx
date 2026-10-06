import React, { useState, useEffect, useRef } from 'react';
import { TheodoliteCanvas, TelemetryState } from './components/TheodoliteCanvas';
import { SensorsPlayground } from './components/SensorsPlayground';
import { SurveyLogManager, SurveyRecord } from './components/SurveyLogManager';
import { FlutterCodeViewer } from './components/FlutterCodeViewer';
import {
  Compass,
  Camera,
  Layers,
  Lock,
  Unlock,
  PlusCircle,
  Eye,
  Sliders,
  Database,
  Code2,
  Maximize2,
  RefreshCw,
  Video,
  VideoOff,
  Navigation,
  Sparkles,
  Info
} from 'lucide-react';

export default function App() {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState<'viewfinder' | 'lab' | 'code' | 'database'>('viewfinder');

  // Filter parameter alpha
  const [alpha, setAlpha] = useState<number>(0.18);
  const [isSimulatingJitter, setIsSimulatingJitter] = useState<boolean>(true);

  // Raw & Filtered Telemetry state
  const [rawAzimuth, setRawAzimuth] = useState<number>(142.4);
  const [filteredAzimuth, setFilteredAzimuth] = useState<number>(142.4);

  const [rawPitch, setRawPitch] = useState<number>(4.2);
  const [filteredPitch, setFilteredPitch] = useState<number>(4.2);

  const [rawRoll, setRawRoll] = useState<number>(-1.1);
  const [filteredRoll, setFilteredRoll] = useState<number>(-1.1);

  // Camera & Geodetic state
  const [zoomFactor, setZoomFactor] = useState<number>(1.0);
  const [isTargetLocked, setIsTargetLocked] = useState<boolean>(false);
  const [useSyntheticCamera, setUseSyntheticCamera] = useState<boolean>(true);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // GNSS Coordinates (default to survey station benchmark)
  const [latitude, setLatitude] = useState<number>(37.774929);
  const [longitude, setLongitude] = useState<number>(-122.419416);
  const [altitude, setAltitude] = useState<number>(48.2);

  // SQLite Survey Entries (Pre-seeded with realistic surveying benchmarks)
  const [surveyEntries, setSurveyEntries] = useState<SurveyRecord[]>([
    {
      id: 1,
      title: 'BM-ALPHA-01',
      azimuth: 45.2,
      pitch: 2.1,
      roll: 0.0,
      latitude: 37.774929,
      longitude: -122.419416,
      altitude: 48.2,
      accuracy: 0.04,
      zoomFactor: 1.0,
      notes: 'Primary benchmark brass disc monument',
      timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    },
    {
      id: 2,
      title: 'STATION_PRISM_EAST',
      azimuth: 89.8,
      pitch: -1.4,
      roll: -0.2,
      latitude: 37.775112,
      longitude: -122.418290,
      altitude: 51.7,
      accuracy: 0.05,
      zoomFactor: 2.5,
      notes: 'Triple prism reflector at perimeter fence line',
      timestamp: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: 3,
      title: 'PIER_COLUMN_B4',
      azimuth: 180.3,
      pitch: 12.8,
      roll: 0.1,
      latitude: 37.774201,
      longitude: -122.419380,
      altitude: 62.4,
      accuracy: 0.03,
      zoomFactor: 4.0,
      notes: 'Structural pier top elevation check',
      timestamp: new Date(Date.now() - 1800000).toISOString(),
    },
  ]);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Circular modulo filter helper
  const filterAngleCircular = (target: number, current: number, a: number) => {
    let delta = ((target - current + 180.0) % 360.0) - 180.0;
    if (delta < -180.0) delta += 360.0;
    let result = (current + a * delta) % 360.0;
    if (result < 0.0) result += 360.0;
    return result;
  };

  const filterScalar = (target: number, current: number, a: number) => {
    return current + a * (target - current);
  };

  // Hardware sensor listener or continuous simulation loop
  useEffect(() => {
    let intervalId: any;
    let noisePhase = 0;

    intervalId = setInterval(() => {
      if (isTargetLocked) return;

      noisePhase += 0.15;
      // High frequency sensor noise simulating hand tremors / IMU sensor thermal noise
      const jitterAz = isSimulatingJitter ? Math.sin(noisePhase * 3.7) * 1.8 + Math.cos(noisePhase * 7.1) * 0.9 : 0;
      const jitterPitch = isSimulatingJitter ? Math.cos(noisePhase * 4.3) * 0.9 + Math.sin(noisePhase * 6.2) * 0.4 : 0;
      const jitterRoll = isSimulatingJitter ? Math.sin(noisePhase * 5.1) * 0.6 : 0;

      // Base orientation drift or user pan
      setRawAzimuth((prev) => {
        const noisy = (prev + jitterAz * 0.2 + 360) % 360;
        setFilteredAzimuth((fPrev) => filterAngleCircular(noisy, fPrev, alpha));
        return noisy;
      });

      setRawPitch((prev) => {
        const noisy = Math.max(-89, Math.min(89, prev + jitterPitch * 0.15));
        setFilteredPitch((fPrev) => filterScalar(noisy, fPrev, alpha));
        return noisy;
      });

      setRawRoll((prev) => {
        const noisy = Math.max(-45, Math.min(45, prev + jitterRoll * 0.15));
        setFilteredRoll((fPrev) => filterScalar(noisy, fPrev, alpha));
        return noisy;
      });
    }, 1000 / 60); // 60 FPS update loop

    return () => clearInterval(intervalId);
  }, [alpha, isSimulatingJitter, isTargetLocked]);

  // Request actual device orientation if available on mobile browser
  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.alpha !== null && !isTargetLocked) {
        const devAzimuth = (360 - e.alpha) % 360;
        const devPitch = e.beta !== null ? e.beta - 90 : rawPitch;
        const devRoll = e.gamma !== null ? e.gamma : rawRoll;

        setRawAzimuth(devAzimuth);
        setRawPitch(devPitch);
        setRawRoll(devRoll);

        setFilteredAzimuth((prev) => filterAngleCircular(devAzimuth, prev, alpha));
        setFilteredPitch((prev) => filterScalar(devPitch, prev, alpha));
        setFilteredRoll((prev) => filterScalar(devRoll, prev, alpha));
      }
    };

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [alpha, isTargetLocked, rawPitch, rawRoll]);

  // Real Camera Stream handling
  const toggleRealCamera = async () => {
    if (!useSyntheticCamera) {
      // Switch back to synthetic
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
      setUseSyntheticCamera(true);
      return;
    }

    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setUseSyntheticCamera(false);
      showToast('Hardware camera preview connected');
    } catch (err: any) {
      setCameraError('Camera access unavailable or declined. Using synthetic survey environment.');
      setUseSyntheticCamera(true);
      showToast('Camera unavailable. Using synthetic environment.');
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Log new survey station to SQLite
  const handleLogStation = () => {
    const newId = surveyEntries.length > 0 ? Math.max(...surveyEntries.map((e) => e.id)) + 1 : 1;
    const newRecord: SurveyRecord = {
      id: newId,
      title: `STATION_${String(newId).padStart(3, '0')}`,
      azimuth: parseFloat(filteredAzimuth.toFixed(2)),
      pitch: parseFloat(filteredPitch.toFixed(2)),
      roll: parseFloat(filteredRoll.toFixed(2)),
      latitude: parseFloat(latitude.toFixed(6)),
      longitude: parseFloat(longitude.toFixed(6)),
      altitude: parseFloat(altitude.toFixed(1)),
      accuracy: 0.04,
      zoomFactor: zoomFactor,
      notes: `Optical log via 60 FPS reticle (Az ${filteredAzimuth.toFixed(1)}°, El ${filteredPitch.toFixed(1)}°)`,
      timestamp: new Date().toISOString(),
    };

    setSurveyEntries([newRecord, ...surveyEntries]);
    showToast(`Survey station ${newRecord.title} logged!`);
  };

  const handleDeleteEntry = (id: number) => {
    setSurveyEntries(surveyEntries.filter((e) => e.id !== id));
    showToast('Record removed from database');
  };

  const handleClearAll = () => {
    if (confirm('Clear all SQLite survey records?')) {
      setSurveyEntries([]);
      showToast('Survey log database cleared');
    }
  };

  // Virtual Joystick / Pan handlers
  const handlePan = (dAz: number, dPitch: number) => {
    if (isTargetLocked) return;
    setRawAzimuth((prev) => (prev + dAz + 360) % 360);
    setRawPitch((prev) => Math.max(-89, Math.min(89, prev + dPitch)));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Hidden camera video element */}
      <video ref={videoRef} playsInline muted className="hidden" />

      {/* Top Bar (Strict 3-Zone Contract: Brand, Nav, Action) */}
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Zone 1: Single text element wordmark */}
          <div className="flex items-center gap-3">
            <span className="font-['Chakra_Petch',sans-serif] text-lg font-bold tracking-wider text-amber-400">
              GEOSIGHT
            </span>
            <span className="text-slate-600 hidden sm:inline">/</span>
            <span className="text-xs font-mono text-slate-400 hidden sm:inline">
              Flutter Theodolite & Geodetic Engine
            </span>
          </div>

          {/* Zone 2: Navigation Links / Segmented Tabs */}
          <nav className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('viewfinder')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'viewfinder'
                  ? 'bg-amber-500/15 text-amber-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Live Reticle</span>
            </button>

            <button
              onClick={() => setActiveTab('lab')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'lab'
                  ? 'bg-amber-500/15 text-amber-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Filter Lab</span>
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'code'
                  ? 'bg-amber-500/15 text-amber-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Flutter Source</span>
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'database'
                  ? 'bg-amber-500/15 text-amber-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Survey Log ({surveyEntries.length})</span>
            </button>
          </nav>

          {/* Zone 3: Primary Action */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTargetLocked(!isTargetLocked)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium border flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                isTargetLocked
                  ? 'bg-red-500/20 border-red-500/60 text-red-400'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Lock crosshairs to read static angle"
            >
              {isTargetLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isTargetLocked ? 'Reticle Locked' : 'Tracking'}</span>
            </button>

            <button
              onClick={handleLogStation}
              className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs font-mono flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all whitespace-nowrap"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Log Station</span>
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 border border-amber-500/40 text-amber-300 px-4 py-2.5 rounded-xl shadow-2xl font-mono text-xs flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-6">
        {/* VIEW 1: LIVE RETICLE VIEWFINDER */}
        {activeTab === 'viewfinder' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Viewfinder Canvas Stage (8 cols) */}
            <div className="lg:col-span-8 space-y-3">
              <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl">
                <TheodoliteCanvas
                  telemetry={{
                    azimuth: filteredAzimuth,
                    pitch: filteredPitch,
                    roll: filteredRoll,
                    rawAzimuth,
                    rawPitch,
                    rawRoll,
                  }}
                  latitude={latitude}
                  longitude={longitude}
                  altitude={altitude}
                  zoomFactor={zoomFactor}
                  isTargetLocked={isTargetLocked}
                  videoRef={videoRef}
                  useSyntheticCamera={useSyntheticCamera}
                />

                {/* Quick overlay controls in corners */}
                <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                  <button
                    onClick={toggleRealCamera}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-slate-200 border border-slate-700/80 text-[11px] font-mono flex items-center gap-1.5 backdrop-blur transition-colors"
                  >
                    {useSyntheticCamera ? (
                      <>
                        <Video className="w-3.5 h-3.5 text-amber-400" />
                        Live WebCam
                      </>
                    ) : (
                      <>
                        <VideoOff className="w-3.5 h-3.5 text-cyan-400" />
                        Synthetic Terrain
                      </>
                    )}
                  </button>

                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/80 text-emerald-400 border border-slate-700/80 text-[11px] font-mono flex items-center gap-1.5 backdrop-blur">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>60 FPS RepaintBoundary</span>
                  </div>
                </div>

                {/* Zoom control bar at top right */}
                <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-700/80 backdrop-blur">
                  {[1.0, 2.0, 4.0, 8.0].map((z) => (
                    <button
                      key={z}
                      onClick={() => setZoomFactor(z)}
                      className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                        zoomFactor === z
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>
              </div>

              {/* Viewfinder Instructions & Camera status */}
              <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 px-1">
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 font-mono font-medium">Controls:</span>
                  <span>Use directional arrows below or touch/drag to aim. Press "Log Station" to persist mark.</span>
                </div>
                <div className="font-mono text-slate-500 text-[11px]">
                  Optics: F/1.8 · Stadia Factor: 100 · Mil Interval: 25mrad
                </div>
              </div>
            </div>

            {/* Viewfinder Lateral Control & Surveying Panel (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              {/* Aiming Gimbal & Orientation Scrubbers */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-xs font-semibold text-slate-200 font-mono uppercase tracking-wide flex items-center gap-2">
                    <Navigation className="w-3.5 h-3.5 text-amber-500" />
                    Manual Theodolite Gimbal
                  </h3>
                  <span className="text-[10px] font-mono text-slate-500">Fine Adjust</span>
                </div>

                {/* Gimbal D-Pad */}
                <div className="flex flex-col items-center justify-center py-2 space-y-2">
                  <button
                    onClick={() => handlePan(0, 2.5)}
                    className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform"
                    title="Pitch Up"
                  >
                    ▲ Elevation +2.5°
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handlePan(-5.0, 0)}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform"
                      title="Azimuth West"
                    >
                      ◄ Pan -5°
                    </button>

                    <button
                      onClick={() => {
                        setRawAzimuth(0);
                        setFilteredAzimuth(0);
                        setRawPitch(0);
                        setFilteredPitch(0);
                        setRawRoll(0);
                        setFilteredRoll(0);
                      }}
                      className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg text-amber-400 text-xs font-mono font-bold"
                      title="Reset to True North & Level"
                    >
                      RESET 0°
                    </button>

                    <button
                      onClick={() => handlePan(5.0, 0)}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform"
                      title="Azimuth East"
                    >
                      Pan +5° ►
                    </button>
                  </div>

                  <button
                    onClick={() => handlePan(0, -2.5)}
                    className="p-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform"
                    title="Pitch Down"
                  >
                    ▼ Elevation -2.5°
                  </button>
                </div>

                {/* Direct Slider Rails */}
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div>
                    <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                      <span>AZIMUTH (0° - 360°)</span>
                      <span className="text-amber-400 font-bold">{filteredAzimuth.toFixed(1)}°</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="359.9"
                      step="0.5"
                      value={filteredAzimuth}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setRawAzimuth(val);
                        setFilteredAzimuth(val);
                      }}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                      <span>PITCH ELEVATION (-90° to +90°)</span>
                      <span className="text-amber-400 font-bold">{filteredPitch >= 0 ? '+' : ''}{filteredPitch.toFixed(1)}°</span>
                    </div>
                    <input
                      type="range"
                      min="-90"
                      max="90"
                      step="0.5"
                      value={filteredPitch}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setRawPitch(val);
                        setFilteredPitch(val);
                      }}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
                      <span>ROLL HORIZON (-45° to +45°)</span>
                      <span className="text-emerald-400 font-bold">{filteredRoll.toFixed(1)}°</span>
                    </div>
                    <input
                      type="range"
                      min="-45"
                      max="45"
                      step="0.5"
                      value={filteredRoll}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setRawRoll(val);
                        setFilteredRoll(val);
                      }}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Station Geodetic Position Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200 font-mono uppercase tracking-wide">
                    GNSS Station Fix
                  </h3>
                  <span className="text-[10px] font-mono text-emerald-400">● 3D RTK FIX</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="p-2 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[9px] text-slate-500 block">LATITUDE</span>
                    <span className="text-slate-200">{latitude.toFixed(6)}°</span>
                  </div>
                  <div className="p-2 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[9px] text-slate-500 block">LONGITUDE</span>
                    <span className="text-slate-200">{longitude.toFixed(6)}°</span>
                  </div>
                  <div className="p-2 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[9px] text-slate-500 block">ALTITUDE MSL</span>
                    <span className="text-cyan-400 font-bold">{altitude.toFixed(1)} m</span>
                  </div>
                  <div className="p-2 bg-slate-950 rounded border border-slate-800">
                    <span className="text-[9px] text-slate-500 block">HORIZ. ACCURACY</span>
                    <span className="text-emerald-400 font-bold">± 0.04 m</span>
                  </div>
                </div>

                <button
                  onClick={handleLogStation}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs font-mono flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all"
                >
                  <PlusCircle className="w-4 h-4" />
                  LOG SURVEY STATION TO SQLITE
                </button>
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: SENSOR FUSION & FILTER LAB */}
        {activeTab === 'lab' && (
          <SensorsPlayground
            alpha={alpha}
            onAlphaChange={setAlpha}
            isSimulatingJitter={isSimulatingJitter}
            onToggleJitter={setIsSimulatingJitter}
            rawAzimuth={rawAzimuth}
            filteredAzimuth={filteredAzimuth}
            rawPitch={rawPitch}
            filteredPitch={filteredPitch}
            rawRoll={rawRoll}
            filteredRoll={filteredRoll}
          />
        )}

        {/* VIEW 3: FLUTTER CODE HUB & ARCHITECTURE */}
        {activeTab === 'code' && <FlutterCodeViewer />}

        {/* VIEW 4: SQLITE SURVEY LOG RECORDS */}
        {activeTab === 'database' && (
          <SurveyLogManager
            entries={surveyEntries}
            onDeleteEntry={handleDeleteEntry}
            onClearAll={handleClearAll}
          />
        )}
      </main>

      {/* Clean Technical Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 px-6 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 font-mono text-[11px]">
          <div>
            GeoSight Production Flutter Architecture · Tested on iOS Metal & Android Vulkan / CanvasKit
          </div>
          <div className="flex items-center gap-4">
            <span>Low-Pass Filter: α = {alpha.toFixed(2)}</span>
            <span>·</span>
            <span>RepaintBoundary: 60 FPS</span>
            <span>·</span>
            <span>SQLite WAL Mode: Active</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
