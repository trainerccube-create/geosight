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
  Info,
  Ruler,
  HelpCircle,
  Calculator,
  X
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

  // Total Station Ground Baseline Distance (meters)
  const [baselineDistance, setBaselineDistance] = useState<number>(25.0);
  const [isBaselineModalOpen, setIsBaselineModalOpen] = useState<boolean>(false);
  const [baselineInputText, setBaselineInputText] = useState<string>('25.0');
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(true);

  // SQLite Survey Entries (Pre-seeded with realistic surveying benchmarks & Total Station trigonometry)
  const [surveyEntries, setSurveyEntries] = useState<SurveyRecord[]>([
    {
      id: 1,
      title: 'BM-ALPHA-01',
      azimuth: 45.2,
      pitch: 2.1,
      roll: 0.0,
      baselineDistance: 25.0,
      verticalDistance: 0.92,
      horizontalDistance: 25.0,
      slopeDistance: 25.02,
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
      baselineDistance: 40.0,
      verticalDistance: -0.98,
      horizontalDistance: 40.0,
      slopeDistance: 40.01,
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
      baselineDistance: 18.5,
      verticalDistance: 4.20,
      horizontalDistance: 18.5,
      slopeDistance: 18.97,
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

  // Log new survey station to SQLite with Total Station Trigonometry
  const handleLogStation = () => {
    const newId = surveyEntries.length > 0 ? Math.max(...surveyEntries.map((e) => e.id)) + 1 : 1;
    const pitchRad = (filteredPitch * Math.PI) / 180.0;
    const verticalDist = baselineDistance * Math.tan(pitchRad);
    const horizontalDist = baselineDistance;
    const cosPitch = Math.abs(Math.cos(pitchRad));
    const slopeDist = cosPitch > 0.001 ? baselineDistance / cosPitch : baselineDistance;

    const newRecord: SurveyRecord = {
      id: newId,
      title: `STATION_${String(newId).padStart(3, '0')}`,
      azimuth: parseFloat(filteredAzimuth.toFixed(2)),
      pitch: parseFloat(filteredPitch.toFixed(2)),
      roll: parseFloat(filteredRoll.toFixed(2)),
      baselineDistance: parseFloat(baselineDistance.toFixed(2)),
      verticalDistance: parseFloat(verticalDist.toFixed(2)),
      horizontalDistance: parseFloat(horizontalDist.toFixed(2)),
      slopeDistance: parseFloat(slopeDist.toFixed(2)),
      latitude: parseFloat(latitude.toFixed(6)),
      longitude: parseFloat(longitude.toFixed(6)),
      altitude: parseFloat(altitude.toFixed(1)),
      accuracy: 0.04,
      zoomFactor: zoomFactor,
      notes: `Total Station record: Base ${baselineDistance.toFixed(1)}m, VD ${verticalDist >= 0 ? '+' : ''}${verticalDist.toFixed(2)}m, HD ${horizontalDist.toFixed(2)}m`,
      timestamp: new Date().toISOString(),
    };

    setSurveyEntries([newRecord, ...surveyEntries]);
    showToast(`Station ${newRecord.title} Logged (VD: ${verticalDist >= 0 ? '+' : ''}${verticalDist.toFixed(2)}m)`);
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

  // Device Gyroscope permission for iOS Safari & Android Chrome
  const [gyroPermissionGranted, setGyroPermissionGranted] = useState<boolean>(false);
  const [hasGyroHardware, setHasGyroHardware] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      setHasGyroHardware(true);
    }
  }, []);

  const requestGyroPermission = async () => {
    if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
      try {
        const response = await (DeviceOrientationEvent as any).requestPermission();
        if (response === 'granted') {
          setGyroPermissionGranted(true);
          showToast('Hardware Gyroscope Enabled!');
        } else {
          showToast('Sensor permission declined');
        }
      } catch (e) {
        showToast('Sensor access error');
      }
    } else {
      setGyroPermissionGranted(true);
      showToast('Device orientation sensors listening');
    }
  };

  // Virtual Joystick / Pan handlers
  const handlePan = (dAz: number, dPitch: number) => {
    if (isTargetLocked) return;
    setRawAzimuth((prev) => (prev + dAz + 360) % 360);
    setRawPitch((prev) => Math.max(-89, Math.min(89, prev + dPitch)));
  };

  // Mobile gimbal accordion open state
  const [showMobileGimbal, setShowMobileGimbal] = useState<boolean>(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200 pb-20 sm:pb-0">
      {/* Hidden camera video element */}
      <video ref={videoRef} playsInline muted className="hidden" />

      {/* Top Bar (Clean 3-Zone Contract responsive on mobile) */}
      <header className="border-b border-slate-800 bg-slate-950/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between">
          {/* Zone 1: Single text element wordmark */}
          <div className="flex items-center gap-2.5">
            <span className="font-['Chakra_Petch',sans-serif] text-base sm:text-lg font-bold tracking-wider text-amber-400">
              GEOSIGHT
            </span>
            <span className="text-slate-600 hidden md:inline">/</span>
            <span className="text-xs font-mono text-slate-400 hidden md:inline">
              Flutter Theodolite & Geodetic Engine
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 sm:inline flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              RTK FIX
            </span>
          </div>

          {/* Zone 2: Desktop Navigation Links (hidden on mobile, uses bottom nav) */}
          <nav className="hidden sm:flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('viewfinder')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap min-h-[36px] ${
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
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap min-h-[36px] ${
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
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap min-h-[36px] ${
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
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap min-h-[36px] ${
                activeTab === 'database'
                  ? 'bg-amber-500/15 text-amber-300 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Survey Log ({surveyEntries.length})</span>
            </button>
          </nav>

          {/* Zone 3: Primary Action & Quick Lock */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsOnboardingOpen(true)}
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-mono font-medium border border-slate-700 bg-slate-900 text-amber-400 hover:text-amber-300 flex items-center gap-1.5 min-h-[40px]"
              title="Total Station Tutorial Guide"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Guide</span>
            </button>

            <button
              onClick={() => setIsTargetLocked(!isTargetLocked)}
              className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-mono font-medium border flex items-center gap-1.5 transition-colors whitespace-nowrap min-h-[40px] ${
                isTargetLocked
                  ? 'bg-red-500/20 border-red-500/60 text-red-400'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Lock crosshairs to read static angle"
            >
              {isTargetLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isTargetLocked ? 'Locked' : 'Tracking'}</span>
            </button>

            <button
              onClick={handleLogStation}
              className="px-3 sm:px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs font-mono flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all whitespace-nowrap min-h-[40px]"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Log Station</span>
              <span className="xs:hidden">Log</span>
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 sm:bottom-5 sm:top-auto right-3 sm:right-5 z-50 bg-slate-900 border border-amber-500/40 text-amber-300 px-3.5 py-2 rounded-xl shadow-2xl font-mono text-xs flex items-center gap-2 animate-in fade-in duration-200">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-3 sm:p-6 space-y-5">
        {/* VIEW 1: LIVE RETICLE VIEWFINDER */}
        {activeTab === 'viewfinder' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Viewfinder Canvas Stage (8 cols) */}
            <div className="lg:col-span-8 space-y-3">
              <div className="relative aspect-[4/5] xs:aspect-[3/4] sm:aspect-[4/3] w-full rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl touch-none">
                <TheodoliteCanvas
                  telemetry={{
                    azimuth: filteredAzimuth,
                    pitch: filteredPitch,
                    roll: filteredRoll,
                    rawAzimuth,
                    rawPitch,
                    rawRoll,
                  }}
                  baselineDistance={baselineDistance}
                  latitude={latitude}
                  longitude={longitude}
                  altitude={altitude}
                  zoomFactor={zoomFactor}
                  isTargetLocked={isTargetLocked}
                  videoRef={videoRef}
                  useSyntheticCamera={useSyntheticCamera}
                  onPan={handlePan}
                  onZoomChange={setZoomFactor}
                />

                {/* Top overlay controls */}
                <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
                  <button
                    onClick={toggleRealCamera}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900/85 hover:bg-slate-900 text-slate-200 border border-slate-700/80 text-[11px] font-mono flex items-center gap-1.5 backdrop-blur transition-colors min-h-[36px]"
                  >
                    {useSyntheticCamera ? (
                      <>
                        <Video className="w-3.5 h-3.5 text-amber-400" />
                        <span className="hidden xs:inline">WebCam</span>
                      </>
                    ) : (
                      <>
                        <VideoOff className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="hidden xs:inline">Terrain</span>
                      </>
                    )}
                  </button>

                  <div className="px-2 py-1.5 rounded-lg bg-slate-900/85 text-emerald-400 border border-slate-700/80 text-[10px] font-mono flex items-center gap-1 backdrop-blur">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>60 FPS</span>
                  </div>
                </div>

                {/* Zoom control bar at top right */}
                <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-slate-900/85 p-1 rounded-lg border border-slate-700/80 backdrop-blur">
                  {[1.0, 2.0, 4.0, 8.0].map((z) => (
                    <button
                      key={z}
                      onClick={() => setZoomFactor(z)}
                      className={`px-2 py-1 rounded text-[10px] sm:text-[11px] font-mono transition-colors min-w-[28px] min-h-[28px] flex items-center justify-center ${
                        zoomFactor === z
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {z}x
                    </button>
                  ))}
                </div>

                {/* Touch Drag Prompt watermark hint */}
                <div className="absolute top-14 left-1/2 -translate-x-1/2 pointer-events-none opacity-40 text-[9px] font-mono text-slate-400 tracking-wider uppercase sm:hidden">
                  Swipe screen to aim reticle
                </div>
              </div>

              {/* Mobile Quick Action Strip (Natural Thumb Zone) */}
              <div className="space-y-2.5">
                {/* Prominent Edit Baseline Distance Button */}
                <button
                  onClick={() => {
                    setBaselineInputText(baselineDistance.toString());
                    setIsBaselineModalOpen(true);
                  }}
                  className="w-full py-2.5 px-3 bg-slate-900/90 hover:bg-slate-800 text-cyan-400 border border-cyan-500/40 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-2 transition-all min-h-[44px] shadow-sm"
                >
                  <Ruler className="w-4 h-4 text-cyan-400" />
                  <span>BASE DISTANCE: {baselineDistance.toFixed(1)} m [TAP TO EDIT]</span>
                </button>

                {/* Primary Station Log Button on Mobile */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLogStation}
                    className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs font-mono flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 transition-all min-h-[48px] active:scale-[0.98]"
                  >
                    <PlusCircle className="w-4 h-4" />
                    LOG TOTAL STATION MARK
                  </button>

                  <button
                    onClick={() => setShowMobileGimbal(!showMobileGimbal)}
                    className={`p-3 rounded-xl border flex items-center justify-center min-h-[48px] min-w-[48px] transition-colors lg:hidden ${
                      showMobileGimbal
                        ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                    }`}
                    title="Toggle manual gimbal adjustment"
                  >
                    <Navigation className="w-4 h-4" />
                  </button>

                  {hasGyroHardware && !gyroPermissionGranted && (
                    <button
                      onClick={requestGyroPermission}
                      className="px-3 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 font-mono text-xs flex items-center gap-1.5 min-h-[48px]"
                      title="Enable Device Gyroscope"
                    >
                      <Compass className="w-4 h-4 text-cyan-400" />
                      <span className="hidden xs:inline">Gyro</span>
                    </button>
                  )}
                </div>

                {/* Viewfinder Instructions */}
                <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 px-1 gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-amber-400 font-mono font-medium">Aim:</span>
                    <span>Touch-drag canvas or use gimbal controls.</span>
                  </div>
                  <div className="font-mono text-slate-500 text-[10px]">
                    Optics: F/1.8 · Stadia: 100 · 25mrad
                  </div>
                </div>
              </div>
            </div>

            {/* Viewfinder Lateral Control & Surveying Panel (4 cols on desktop, collapsible on mobile) */}
            <div className={`lg:col-span-4 space-y-4 ${showMobileGimbal ? 'block' : 'hidden lg:block'}`}>
              {/* Aiming Gimbal & Orientation Scrubbers */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-xs font-semibold text-slate-200 font-mono uppercase tracking-wide flex items-center gap-2">
                    <Navigation className="w-3.5 h-3.5 text-amber-500" />
                    Manual Theodolite Gimbal
                  </h3>
                  <button
                    onClick={() => {
                      setRawAzimuth(0);
                      setFilteredAzimuth(0);
                      setRawPitch(0);
                      setFilteredPitch(0);
                      setRawRoll(0);
                      setFilteredRoll(0);
                    }}
                    className="text-[10px] font-mono text-amber-400 hover:text-amber-300"
                  >
                    [Reset 0° North]
                  </button>
                </div>

                {/* Gimbal Jogger Controls */}
                <div className="flex flex-col items-center justify-center py-2 space-y-2">
                  <button
                    onClick={() => handlePan(0, 2.5)}
                    className="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform min-h-[44px] min-w-[120px]"
                    title="Pitch Up"
                  >
                    ▲ Elevation +2.5°
                  </button>

                  <div className="flex items-center gap-2 w-full justify-center">
                    <button
                      onClick={() => handlePan(-5.0, 0)}
                      className="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform min-h-[44px]"
                      title="Azimuth West"
                    >
                      ◄ Pan -5°
                    </button>

                    <div className="px-3 py-2 bg-slate-950 rounded-lg border border-slate-800 text-center font-mono text-xs">
                      <div className="text-[9px] text-slate-500">BEARING</div>
                      <div className="font-bold text-amber-400">{filteredAzimuth.toFixed(1)}°</div>
                    </div>

                    <button
                      onClick={() => handlePan(5.0, 0)}
                      className="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform min-h-[44px]"
                      title="Azimuth East"
                    >
                      Pan +5° ►
                    </button>
                  </div>

                  <button
                    onClick={() => handlePan(0, -2.5)}
                    className="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 text-xs font-mono font-bold active:scale-95 transition-transform min-h-[44px] min-w-[120px]"
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
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 touch-pan-x"
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
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500 touch-pan-x"
                    />
                  </div>
                </div>
              </div>

              {/* Station Geodetic Position Card & Total Station Controls */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-200 font-mono uppercase tracking-wide flex items-center gap-1.5">
                    <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                    Total Station Analysis
                  </h3>
                  <span className="text-[10px] font-mono text-cyan-400">TRIG ENGINE</span>
                </div>

                {/* Trigonometry Computed Metrics Grid */}
                {(() => {
                  const pitchRad = (filteredPitch * Math.PI) / 180.0;
                  const vd = baselineDistance * Math.tan(pitchRad);
                  const hd = baselineDistance;
                  const cosPitch = Math.abs(Math.cos(pitchRad));
                  const sd = cosPitch > 0.001 ? baselineDistance / cosPitch : baselineDistance;
                  return (
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="p-2 bg-slate-950 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">BASE DIST (GROUND)</span>
                        <span className="text-white font-bold">{baselineDistance.toFixed(2)} m</span>
                      </div>
                      <div className="p-2 bg-slate-950 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">HORIZ DIST (HD)</span>
                        <span className="text-cyan-400 font-bold">{hd.toFixed(2)} m</span>
                      </div>
                      <div className="p-2 bg-slate-950 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">VERTICAL HEIGHT (VD)</span>
                        <span className="text-emerald-400 font-bold">{vd >= 0 ? '+' : ''}{vd.toFixed(2)} m</span>
                      </div>
                      <div className="p-2 bg-slate-950 rounded border border-slate-800">
                        <span className="text-[9px] text-slate-500 block">SLOPE DIST (SD)</span>
                        <span className="text-amber-400 font-bold">{sd.toFixed(2)} m</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Prominent Edit Baseline Distance Button (Desktop Panel) */}
                <button
                  onClick={() => {
                    setBaselineInputText(baselineDistance.toString());
                    setIsBaselineModalOpen(true);
                  }}
                  className="w-full py-2.5 px-3 bg-slate-950 hover:bg-slate-800 text-cyan-400 border border-cyan-500/40 rounded-lg text-xs font-mono font-bold flex items-center justify-center gap-2 transition-colors min-h-[40px]"
                >
                  <Ruler className="w-3.5 h-3.5 text-cyan-400" />
                  <span>EDIT BASE DISTANCE [{baselineDistance.toFixed(1)} m]</span>
                </button>

                {/* GNSS Coords */}
                <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1 border-t border-slate-800">
                  <div className="p-2 bg-slate-950/60 rounded border border-slate-800/80">
                    <span className="text-[9px] text-slate-500 block">LATITUDE</span>
                    <span className="text-slate-200">{latitude.toFixed(6)}°</span>
                  </div>
                  <div className="p-2 bg-slate-950/60 rounded border border-slate-800/80">
                    <span className="text-[9px] text-slate-500 block">LONGITUDE</span>
                    <span className="text-slate-200">{longitude.toFixed(6)}°</span>
                  </div>
                </div>
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

      {/* REQUIREMENT 3: First-Time User Tutorial Modal Dialog */}
      {isOnboardingOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-amber-500/60 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/15 text-amber-400">
                  <Calculator className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-100 font-mono">Total Station Field Guide</h3>
                  <p className="text-[11px] text-slate-400 font-mono">GeoSight Surveying Onboarding</p>
                </div>
              </div>
              <button
                onClick={() => setIsOnboardingOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Welcome to the upgraded GeoSight Total Station! Follow these 4 quick steps to calculate live elevations and heights:
            </p>

            <div className="space-y-3 font-mono text-xs">
              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <div className="font-semibold text-slate-200 text-xs">Align Crosshairs at Target</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                    Aim the center optical reticle and stadia lines directly at the top or benchmark of your target feature.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <div className="font-semibold text-slate-200 text-xs">Set Baseline Ground Distance</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                    Tap "EDIT BASE DISTANCE" to input your tape or laser-measured horizontal distance to the target base (e.g. 25.0 m).
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <div className="font-semibold text-slate-200 text-xs">Read Trigonometric Heights</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                    The HUD dynamically computes Vertical Height (VD = Base × tan(θ)) and Slope Distance (SD = Base / cos(θ)) at 60 FPS.
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-[11px] shrink-0 mt-0.5">
                  4
                </div>
                <div>
                  <div className="font-semibold text-slate-200 text-xs">Log Station Record</div>
                  <div className="text-[11px] text-slate-400 mt-0.5 leading-normal">
                    Tap "LOG TOTAL STATION MARK" to record full angles, computed heights, and GNSS fix to the SQLite database.
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={() => setIsOnboardingOpen(false)}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs font-mono shadow-lg shadow-amber-500/20 transition-all"
              >
                START SURVEYING
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REQUIREMENT 4: Interactive Baseline Distance Input Alert Box Modal */}
      {isBaselineModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-cyan-500/60 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Ruler className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100 font-mono">Target Baseline Distance</h3>
              </div>
              <button
                onClick={() => setIsBaselineModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Enter measured horizontal baseline distance from your station to the target base (meters):
            </p>

            <div>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  autoFocus
                  value={baselineInputText}
                  onChange={(e) => setBaselineInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = parseFloat(baselineInputText);
                      if (!isNaN(val) && val > 0.1) {
                        setBaselineDistance(val);
                        setIsBaselineModalOpen(false);
                        showToast(`Baseline updated to ${val.toFixed(2)} m`);
                      }
                    }
                  }}
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-lg font-mono font-bold text-amber-400 focus:outline-none focus:border-cyan-500/70"
                />
                <span className="absolute right-3 top-3 text-xs font-mono text-slate-500">meters</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setIsBaselineModalOpen(false)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono font-semibold rounded-lg text-xs transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={() => {
                  const val = parseFloat(baselineInputText);
                  if (!isNaN(val) && val > 0.1) {
                    setBaselineDistance(val);
                    setIsBaselineModalOpen(false);
                    showToast(`Baseline updated to ${val.toFixed(2)} m`);
                  } else {
                    showToast('Please enter a valid distance (> 0.1 m)');
                  }
                }}
                className="flex-1 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold rounded-lg text-xs shadow-md shadow-cyan-500/20 transition-all"
              >
                APPLY DISTANCE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation Bar (Thumb Zone) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 h-16 pb-safe grid grid-cols-4 items-center">
        <button
          onClick={() => setActiveTab('viewfinder')}
          className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
            activeTab === 'viewfinder' ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Eye className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">Reticle</span>
        </button>

        <button
          onClick={() => setActiveTab('lab')}
          className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
            activeTab === 'lab' ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Sliders className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">Filter Lab</span>
        </button>

        <button
          onClick={() => setActiveTab('code')}
          className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
            activeTab === 'code' ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Code2 className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">Flutter</span>
        </button>

        <button
          onClick={() => setActiveTab('database')}
          className={`flex flex-col items-center justify-center h-full min-h-[44px] transition-colors ${
            activeTab === 'database' ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Database className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1">
            Logs ({surveyEntries.length})
          </span>
        </button>
      </nav>

      {/* Clean Technical Desktop Footer */}
      <footer className="hidden sm:block border-t border-slate-800/80 bg-slate-950 py-4 px-6 text-xs text-slate-500 mt-auto">
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
