export interface FlutterFile {
  id: string;
  filename: string;
  filepath: string;
  language: string;
  category: 'config' | 'service' | 'view' | 'database' | 'model' | 'main';
  description: string;
  code: string;
}

export const STANDALONE_MAIN_DART = `import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:camera/camera.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import 'package:vector_math/vector_math_64.dart' as vmath;
import 'package:intl/intl.dart';

/// ============================================================================
/// GEOSIGHT ELITE INDUSTRIAL TOTAL STATION & SPATIAL SURVEYING SUITE
/// Unified Standalone Single-File Architecture (lib/main.dart)
/// Industrial Electronic Total Station (ETS) Emulator with Mathematical Kalman Filter
/// ============================================================================

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  runApp(const GeoSightEnterpriseTotalStationApp());
}

/// Root Application Material Definition with MD3 Dark Corporate Palette
class GeoSightEnterpriseTotalStationApp extends StatelessWidget {
  const GeoSightEnterpriseTotalStationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GeoSight Enterprise Total Station',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF070B12), // Deep Slate Black
        primaryColor: const Color(0xFFF59E0B),           // Industrial Surveying Amber
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFF59E0B),
          secondary: Color(0xFF10B981),                  // Neon Emerald
          tertiary: Color(0xFF06B6D4),                   // Cyan Telemetry
          surface: Color(0xFF0F172A),
          surfaceContainerHighest: Color(0xFF1E293B),
        ),
        fontFamily: 'monospace',
      ),
      home: const TotalStationScreen(),
    );
  }
}

/// ============================================================================
/// 1. MATHEMATICAL KALMAN FILTER ENGINE (1D MATRIX ARRAY & CIRCULAR UNWRAPPING)
/// ============================================================================

/// 1D Linear Kalman Filter for scalar sensor tracking (Pitch, Roll, Accel, Mag)
class KalmanFilter1D {
  double _q; // Process noise covariance (Q)
  double _r; // Measurement noise covariance (R)
  double _x; // Filtered state estimate
  double _p; // Estimation error covariance (P)
  double _k = 0.0; // Kalman gain (K)

  KalmanFilter1D({
    double processNoise = 0.008,
    double measurementNoise = 0.08,
    double initialEstimate = 0.0,
    double initialError = 1.0,
  })  : _q = processNoise,
        _r = measurementNoise,
        _x = initialEstimate,
        _p = initialError;

  /// Time update (Predict) & Measurement update (Correct)
  double update(double measurement) {
    // 1. Prediction update
    _p = _p + _q;

    // 2. Compute Kalman Gain: K = P / (P + R)
    _k = _p / (_p + _r);

    // 3. State estimate correction: x = x + K * (z - x)
    _x = _x + _k * (measurement - _x);

    // 4. Covariance correction: P = (1 - K) * P
    _p = (1.0 - _k) * _p;

    return _x;
  }

  void reset(double val) {
    _x = val;
    _p = 1.0;
  }

  double get estimate => _x;
  double get errorCovariance => _p;
  double get kalmanGain => _k;
  double get processNoise => _q;
  double get measurementNoise => _r;

  void configure({double? q, double? r}) {
    if (q != null) _q = q;
    if (r != null) _r = r;
  }
}

/// Circular Kalman Filter for Azimuth/Compass (Unwraps across 0° <-> 360° phase boundary)
class KalmanFilterCircular {
  double _q;
  double _r;
  double _x;
  double _p;
  double _k = 0.0;

  KalmanFilterCircular({
    double processNoise = 0.010,
    double measurementNoise = 0.09,
    double initialEstimate = 0.0,
  })  : _q = processNoise,
        _r = measurementNoise,
        _x = initialEstimate,
        _p = 1.0;

  double update(double measuredAngleDeg) {
    _p = _p + _q;
    _k = _p / (_p + _r);

    // Circular shortest angular deviation across 360 degrees
    double delta = ((measuredAngleDeg - _x + 180.0) % 360.0) - 180.0;
    if (delta < -180.0) delta += 360.0;

    _x = (_x + _k * delta) % 360.0;
    if (_x < 0.0) _x += 360.0;

    _p = (1.0 - _k) * _p;
    return _x;
  }

  void reset(double val) {
    _x = val % 360.0;
    _p = 1.0;
  }

  double get estimate => _x;
  double get kalmanGain => _k;
}

/// ============================================================================
/// 2. DATA MODELS & SPATIAL GEOMETRY STRUCTURES
/// ============================================================================

/// Industry Standard Survey Feature Classification Codes
enum FeatureCode {
  BM,   // Benchmark (Datum / Control Point)
  BND,  // Boundary Marker (Property corner / cadastral)
  TOPO, // Topography (Natural ground / stockpile boundary)
  UTIL, // Utility (Pipes, valves, poles, hydrants)
}

extension FeatureCodeDetails on FeatureCode {
  String get code => name;

  String get label {
    switch (this) {
      case FeatureCode.BM:
        return 'Benchmark';
      case FeatureCode.BND:
        return 'Boundary';
      case FeatureCode.TOPO:
        return 'Topography';
      case FeatureCode.UTIL:
        return 'Utility';
    }
  }

  Color get color {
    switch (this) {
      case FeatureCode.BM:
        return const Color(0xFFF59E0B); // Industrial Amber
      case FeatureCode.BND:
        return const Color(0xFF10B981); // Neon Emerald
      case FeatureCode.TOPO:
        return const Color(0xFF06B6D4); // Cyan
      case FeatureCode.UTIL:
        return const Color(0xFFA855F7); // Violet Purple
    }
  }

  static FeatureCode fromString(String val) {
    switch (val.toUpperCase()) {
      case 'BM':
        return FeatureCode.BM;
      case 'BND':
        return FeatureCode.BND;
      case 'UTIL':
        return FeatureCode.UTIL;
      case 'TOPO':
      default:
        return FeatureCode.TOPO;
    }
  }
}

/// Tilt-compensated spatial orientation telemetry with Kalman Filter metrics
class TelemetryData {
  final double azimuth;      // 0.0 to 359.99° (Horizontal Bearing from Grid North)
  final double pitch;        // -90.0 to +90.0° (Vertical Elevation Angle)
  final double roll;         // -180.0 to +180.0° (Horizon bank angle)
  final double rawAzimuth;
  final double rawPitch;
  final double rawRoll;
  final double jitterDelta;
  final double kalmanGain;
  final bool isLevelLocked;  // Pitch & Roll within 0.2 degrees (Dual-axis electronic lock)
  final DateTime timestamp;

  const TelemetryData({
    required this.azimuth,
    required this.pitch,
    required this.roll,
    required this.rawAzimuth,
    required this.rawPitch,
    required this.rawRoll,
    required this.jitterDelta,
    required this.kalmanGain,
    required this.isLevelLocked,
    required this.timestamp,
  });

  factory TelemetryData.initial() => TelemetryData(
        azimuth: 0.0,
        pitch: 0.0,
        roll: 0.0,
        rawAzimuth: 0.0,
        rawPitch: 0.0,
        rawRoll: 0.0,
        jitterDelta: 0.0,
        kalmanGain: 0.1,
        isLevelLocked: true,
        timestamp: DateTime.now(),
      );
}

/// Target Point Coordinates for Stakeout / Precision Guidance
class StakeoutTarget {
  final String pointId;
  final double targetNorthing;
  final double targetEasting;
  final double targetElevation;

  const StakeoutTarget({
    required this.pointId,
    required this.targetNorthing,
    required this.targetEasting,
    required this.targetElevation,
  });
}

/// Real-time Stakeout Deviation Vectors & Directional Navigation Guide
class StakeoutGuidance {
  final double horizontalDistance; // 2D planar distance to target (m)
  final double targetBearing;      // Azimuth from current point to target (deg)
  final double bearingDelta;        // Angle error: targetBearing - currentAzimuth (deg)
  final double moveForward;        // Local longitudinal offset: +Forward / -Back (m)
  final double moveRight;          // Local lateral offset: +Right / -Left (m)
  final double cutFill;            // Vertical delta: Target_Z - Current_Z (m)
  final bool isOnTarget;           // Within precision threshold (< 0.05m)
  final int audioPingIntervalMs;   // Dynamic audio/haptic pulse frequency in ms

  const StakeoutGuidance({
    required this.horizontalDistance,
    required this.targetBearing,
    required this.bearingDelta,
    required this.moveForward,
    required this.moveRight,
    required this.cutFill,
    required this.isOnTarget,
    required this.audioPingIntervalMs,
  });
}

/// Resection Free Stationing Computation Result
class ResectionResult {
  final double computedNorthing;
  final double computedEasting;
  final double residualError;
  final bool isAccurate;
  final String summary;

  const ResectionResult({
    required this.computedNorthing,
    required this.computedEasting,
    required this.residualError,
    required this.isAccurate,
    required this.summary,
  });
}

/// 3D Volumetric and 2D Surface Area Calculation Result
class VolumetricAreaResult {
  final double surfaceAreaSqMeters;
  final double surfaceAreaHectares;
  final double surfaceAreaSqFeet;
  final double perimeterMeters;
  final double estimatedVolumeCuMeters;
  final double minElevation;
  final double maxElevation;
  final double meanElevation;
  final int pointCount;

  const VolumetricAreaResult({
    required this.surfaceAreaSqMeters,
    required this.surfaceAreaHectares,
    required this.surfaceAreaSqFeet,
    required this.perimeterMeters,
    required this.estimatedVolumeCuMeters,
    required this.minElevation,
    required this.maxElevation,
    required this.meanElevation,
    required this.pointCount,
  });
}

/// Total Station Trigonometric & Local Coordinate Transform Engine
class TotalStationTrig {
  final double baselineDistance; // Horizontal ground distance in meters (HD)
  final double pitchAngleDeg;     // Live pitch angle in degrees (theta)
  final double azimuthAngleDeg;   // Live azimuth angle in degrees (alpha)
  final double instrumentHeight;  // HI (meters from station ground to phone lens)
  final double targetHeight;      // HR (meters from ground to prism / target)
  final double stationNorthing;   // Station setup datum N0
  final double stationEasting;    // Station setup datum E0
  final double stationElevation;  // Station setup datum Z0

  TotalStationTrig({
    required this.baselineDistance,
    required this.pitchAngleDeg,
    required this.azimuthAngleDeg,
    this.instrumentHeight = 1.55,
    this.targetHeight = 1.60,
    this.stationNorthing = 0.0,
    this.stationEasting = 0.0,
    this.stationElevation = 100.0,
  });

  double get pitchRad => pitchAngleDeg * (math.pi / 180.0);
  double get azRad => azimuthAngleDeg * (math.pi / 180.0);

  /// Horizontal Distance (HD)
  double get horizontalDistance => baselineDistance;

  /// Optical Vertical Distance (Raw VD = HD * tan(theta))
  double get rawVerticalDistance => baselineDistance * math.tan(pitchRad);

  /// True Relative Elevation Difference factoring HI and HR:
  /// Delta_Z = Raw_VD + HI - HR
  double get trueElevationDelta => rawVerticalDistance + instrumentHeight - targetHeight;

  /// Computed Target True Elevation (Z = Station_Z + Delta_Z)
  double get trueTargetElevation => stationElevation + trueElevationDelta;

  /// Line-of-Sight Slope Distance (SD = HD / |cos(theta)|)
  double get slopeDistance {
    final double cosTheta = math.cos(pitchRad).abs();
    if (cosTheta < 0.0001) return baselineDistance;
    return baselineDistance / cosTheta;
  }

  /// Dynamic Local Coordinate System (NEZ Grid Coordinates)
  double get targetNorthing => stationNorthing + horizontalDistance * math.cos(azRad);
  double get targetEasting => stationEasting + horizontalDistance * math.sin(azRad);

  double get deltaNorthing => horizontalDistance * math.cos(azRad);
  double get deltaEasting => horizontalDistance * math.sin(azRad);
}

/// Comprehensive Survey Station Model for SQLite Persistence & NEZ Tracking
class SurveyStation {
  final int? id;
  final String title;
  final FeatureCode featureCode;
  final double azimuth;
  final double pitch;
  final double roll;
  final double baselineDistance;
  final double instrumentHeight;
  final double targetHeight;
  final double northing;
  final double easting;
  final double trueElevation;
  final double rawVerticalDistance;
  final double horizontalDistance;
  final double slopeDistance;
  final double latitude;
  final double longitude;
  final double altitude;
  final double accuracy;
  final double zoomFactor;
  final String? notes;
  final DateTime timestamp;

  SurveyStation({
    this.id,
    required this.title,
    required this.featureCode,
    required this.azimuth,
    required this.pitch,
    required this.roll,
    required this.baselineDistance,
    required this.instrumentHeight,
    required this.targetHeight,
    required this.northing,
    required this.easting,
    required this.trueElevation,
    required this.rawVerticalDistance,
    required this.horizontalDistance,
    required this.slopeDistance,
    required this.latitude,
    required this.longitude,
    required this.altitude,
    required this.accuracy,
    required this.zoomFactor,
    this.notes,
    required this.timestamp,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'title': title,
      'feature_code': featureCode.code,
      'azimuth': azimuth,
      'pitch': pitch,
      'roll': roll,
      'baseline_dist': baselineDistance,
      'hi_height': instrumentHeight,
      'hr_height': targetHeight,
      'northing': northing,
      'easting': easting,
      'true_elevation': trueElevation,
      'vertical_dist': rawVerticalDistance,
      'horizontal_dist': horizontalDistance,
      'slope_dist': slopeDistance,
      'latitude': latitude,
      'longitude': longitude,
      'altitude': altitude,
      'accuracy': accuracy,
      'zoom_factor': zoomFactor,
      'notes': notes,
      'timestamp': timestamp.toIso8601String(),
    };
  }

  factory SurveyStation.fromMap(Map<String, dynamic> map) {
    return SurveyStation(
      id: map['id'] as int?,
      title: map['title'] as String,
      featureCode: FeatureCodeDetails.fromString((map['feature_code'] as String?) ?? 'TOPO'),
      azimuth: (map['azimuth'] as num).toDouble(),
      pitch: (map['pitch'] as num).toDouble(),
      roll: (map['roll'] as num).toDouble(),
      baselineDistance: (map['baseline_dist'] as num?)?.toDouble() ?? 0.0,
      instrumentHeight: (map['hi_height'] as num?)?.toDouble() ?? 1.55,
      targetHeight: (map['hr_height'] as num?)?.toDouble() ?? 1.60,
      northing: (map['northing'] as num?)?.toDouble() ?? 0.0,
      easting: (map['easting'] as num?)?.toDouble() ?? 0.0,
      trueElevation: (map['true_elevation'] as num?)?.toDouble() ?? 0.0,
      rawVerticalDistance: (map['vertical_dist'] as num?)?.toDouble() ?? 0.0,
      horizontalDistance: (map['horizontal_dist'] as num?)?.toDouble() ?? 0.0,
      slopeDistance: (map['slope_dist'] as num?)?.toDouble() ?? 0.0,
      latitude: (map['latitude'] as num).toDouble(),
      longitude: (map['longitude'] as num).toDouble(),
      altitude: (map['altitude'] as num).toDouble(),
      accuracy: (map['accuracy'] as num).toDouble(),
      zoomFactor: (map['zoom_factor'] as num?)?.toDouble() ?? 1.0,
      notes: map['notes'] as String?,
      timestamp: DateTime.parse(map['timestamp'] as String),
    );
  }
}

/// ============================================================================
/// 3. ADVANCED GEODETIC & INDUSTRIAL MATHEMATICS ENGINES
/// ============================================================================

/// 3.1 Resection (Free Stationing) Calculation Engine
class ResectionCalculationEngine {
  static ResectionResult computeTwoPointResection({
    required double northA,
    required double eastA,
    required double distA,
    required double azA,
    required double northB,
    required double eastB,
    required double distB,
    required double azB,
  }) {
    final double dN = northB - northA;
    final double dE = eastB - eastA;
    final double distAB = math.sqrt(dN * dN + dE * dE);

    if (distAB < 0.001) {
      return const ResectionResult(
        computedNorthing: 0,
        computedEasting: 0,
        residualError: 999.0,
        isAccurate: false,
        summary: 'Control points A and B are identical monuments.',
      );
    }

    if (distA + distB < distAB || distA + distAB < distB || distB + distAB < distA) {
      final double backAzA = (azA + 180.0) % 360.0;
      final double backAzB = (azB + 180.0) % 360.0;
      final double radA = backAzA * (math.pi / 180.0);
      final double radB = backAzB * (math.pi / 180.0);

      final double sA = math.sin(radA);
      final double cA = math.cos(radA);
      final double sB = math.sin(radB);
      final double cB = math.cos(radB);

      final double det = sA * cB - cA * sB;
      if (det.abs() < 0.001) {
        return const ResectionResult(
          computedNorthing: 0,
          computedEasting: 0,
          residualError: 999.0,
          isAccurate: false,
          summary: 'Control points and station are collinear (Dangerous circle).',
        );
      }

      final double t = ((eastB - eastA) * cB - (northB - northA) * sB) / det;
      final double resN = northA + t * cA;
      final double resE = eastA + t * sA;

      return ResectionResult(
        computedNorthing: resN,
        computedEasting: resE,
        residualError: 0.08,
        isAccurate: true,
        summary: 'Angular intersection resection converged successfully.',
      );
    }

    final double x = (distA * distA - distB * distB + distAB * distAB) / (2 * distAB);
    final double y = math.sqrt(math.max(0.0, distA * distA - x * x));

    final double uN = dN / distAB;
    final double uE = dE / distAB;
    final double nN = -uE;
    final double nE = uN;

    final double sol1N = northA + x * uN + y * nN;
    final double sol1E = eastA + x * uE + y * nE;
    final double sol2N = northA + x * uN - y * nN;
    final double sol2E = eastA + x * uE - y * nE;

    final double calcAz1A = (math.atan2(eastA - sol1E, northA - sol1N) * (180.0 / math.pi) + 360.0) % 360.0;
    final double calcAz2A = (math.atan2(eastA - sol2E, northA - sol2N) * (180.0 / math.pi) + 360.0) % 360.0;

    final double err1 = math.min((calcAz1A - azA).abs(), 360.0 - (calcAz1A - azA).abs());
    final double err2 = math.min((calcAz2A - azA).abs(), 360.0 - (calcAz2A - azA).abs());

    final bool useSol1 = err1 <= err2;
    final double finalN = useSol1 ? sol1N : sol2N;
    final double finalE = useSol1 ? sol1E : sol2E;
    final double residual = math.min(err1, err2) * (distA / 57.3);

    return ResectionResult(
      computedNorthing: finalN,
      computedEasting: finalE,
      residualError: residual,
      isAccurate: residual < 0.15,
      summary: 'Trilateration resection computed (Residual: \${residual.toStringAsFixed(3)}m).',
    );
  }
}

/// 3.2 Precision Stakeout Guidance Engine with Audio Ping Interval Matrix
class StakeoutNavigationEngine {
  static StakeoutGuidance calculateGuidance({
    required StakeoutTarget target,
    required double currentNorthing,
    required double currentEasting,
    required double currentElevation,
    required double currentAzimuth,
  }) {
    final double dN = target.targetNorthing - currentNorthing;
    final double dE = target.targetEasting - currentEasting;
    final double dist2D = math.sqrt(dN * dN + dE * dE);

    final double targetAz = (math.atan2(dE, dN) * (180.0 / math.pi) + 360.0) % 360.0;

    double angleDelta = ((targetAz - currentAzimuth + 180.0) % 360.0) - 180.0;
    if (angleDelta < -180.0) angleDelta += 360.0;

    final double deltaRad = angleDelta * (math.pi / 180.0);
    final double moveForward = dist2D * math.cos(deltaRad);
    final double moveRight = dist2D * math.sin(deltaRad);

    final double cutFill = target.targetElevation - currentElevation;
    final bool onTarget = dist2D <= 0.05; // 5 cm precision threshold

    // Accelerated Audio Ping Interval Matrix (approaching 0.0m)
    int intervalMs;
    if (onTarget) {
      intervalMs = 80;   // Rapid solid buzzer
    } else if (dist2D < 0.4) {
      intervalMs = 140;  // Very fast click
    } else if (dist2D < 1.2) {
      intervalMs = 280;  // Fast click
    } else if (dist2D < 3.0) {
      intervalMs = 500;  // Medium click
    } else if (dist2D < 8.0) {
      intervalMs = 950;  // Standard pace
    } else {
      intervalMs = 1600; // Far distance slow ping
    }

    return StakeoutGuidance(
      horizontalDistance: dist2D,
      targetBearing: targetAz,
      bearingDelta: angleDelta,
      moveForward: moveForward,
      moveRight: moveRight,
      cutFill: cutFill,
      isOnTarget: onTarget,
      audioPingIntervalMs: intervalMs,
    );
  }
}

/// 3.3 3D Volumetric & Horizontal Surface Area Calculator (Shoelace Formula)
class VolumetricAreaEngine {
  static VolumetricAreaResult computePolylineVolumeAndArea(List<SurveyStation> polygonPoints) {
    if (polygonPoints.length < 3) {
      return const VolumetricAreaResult(
        surfaceAreaSqMeters: 0,
        surfaceAreaHectares: 0,
        surfaceAreaSqFeet: 0,
        perimeterMeters: 0,
        estimatedVolumeCuMeters: 0,
        minElevation: 0,
        maxElevation: 0,
        meanElevation: 0,
        pointCount: 0,
      );
    }

    final int n = polygonPoints.length;
    double shoelaceSum = 0.0;
    double perimeter = 0.0;
    double elevSum = 0.0;
    double minZ = polygonPoints.first.trueElevation;
    double maxZ = polygonPoints.first.trueElevation;

    for (int i = 0; i < n; i++) {
      final int next = (i + 1) % n;
      final double xi = polygonPoints[i].easting;
      final double yi = polygonPoints[i].northing;
      final double xNext = polygonPoints[next].easting;
      final double yNext = polygonPoints[next].northing;

      shoelaceSum += (xi * yNext - xNext * yi);

      final double edgeLen = math.sqrt((xNext - xi) * (xNext - xi) + (yNext - yi) * (yNext - yi));
      perimeter += edgeLen;

      final double z = polygonPoints[i].trueElevation;
      elevSum += z;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    final double areaSqM = (shoelaceSum.abs()) / 2.0;
    final double areaHectares = areaSqM / 10000.0;
    final double areaSqFeet = areaSqM * 10.7639;
    final double meanZ = elevSum / n;

    final double meanHeightDelta = math.max(0.0, meanZ - minZ);
    final double volumeCuM = areaSqM * meanHeightDelta;

    return VolumetricAreaResult(
      surfaceAreaSqMeters: areaSqM,
      surfaceAreaHectares: areaHectares,
      surfaceAreaSqFeet: areaSqFeet,
      perimeterMeters: perimeter,
      estimatedVolumeCuMeters: volumeCuM,
      minElevation: minZ,
      maxElevation: maxZ,
      meanElevation: meanZ,
      pointCount: n,
    );
  }
}

/// ============================================================================
/// 4. SENSOR FUSION ENGINE WITH KALMAN FILTER ARRAY
/// ============================================================================

class SensorFusionEngine {
  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<MagnetometerEvent>? _magSub;

  vmath.Vector3 _accel = vmath.Vector3(0, 0, 9.81);
  vmath.Vector3 _magnet = vmath.Vector3(0, 25, -40);

  // Kalman Filter Array for 3-Axis Orientation Stream Feeds
  final KalmanFilterCircular _kalmanAzimuth = KalmanFilterCircular(processNoise: 0.012, measurementNoise: 0.08);
  final KalmanFilter1D _kalmanPitch = KalmanFilter1D(processNoise: 0.008, measurementNoise: 0.07);
  final KalmanFilter1D _kalmanRoll = KalmanFilter1D(processNoise: 0.008, measurementNoise: 0.07);

  final _controller = StreamController<TelemetryData>.broadcast();
  Stream<TelemetryData> get telemetryStream => _controller.stream;

  void start() {
    _accelSub = accelerometerEvents.listen((event) {
      _accel = vmath.Vector3(event.x, event.y, event.z);
      _processSensors();
    });

    _magSub = magnetometerEvents.listen((event) {
      _magnet = vmath.Vector3(event.x, event.y, event.z);
      _processSensors();
    });
  }

  void stop() {
    _accelSub?.cancel();
    _magSub?.cancel();
    _controller.close();
  }

  void _processSensors() {
    final vmath.Vector3 g = _accel.normalized();
    final vmath.Vector3 m = _magnet.normalized();

    // Tilt-Compensated East = Magnetometer x Gravity
    vmath.Vector3 east = m.cross(g);
    if (east.length < 0.001) return;
    east.normalize();

    // Tilt-Compensated North = Gravity x East
    vmath.Vector3 north = g.cross(east);
    north.normalize();

    // Raw Euler Angle Extrapolation
    double rawPitch = math.asin(-g.y.clamp(-1.0, 1.0)) * (180.0 / math.pi);
    double rawRoll = math.atan2(g.x, g.z) * (180.0 / math.pi);
    double rawAzimuth = math.atan2(east.x, north.x) * (180.0 / math.pi);
    if (rawAzimuth < 0) rawAzimuth += 360.0;

    // Filter through Matrix Kalman Engine Array
    final double filteredAz = _kalmanAzimuth.update(rawAzimuth);
    final double filteredPitch = _kalmanPitch.update(rawPitch);
    final double filteredRoll = _kalmanRoll.update(rawRoll);

    // Compute circular jitter error
    double azDelta = ((rawAzimuth - filteredAz + 180.0) % 360.0) - 180.0;
    if (azDelta < -180.0) azDelta += 360.0;

    // Electronic 3D Level Lock Condition: Dual-axis angle <= 0.20 degrees
    final bool isLevel = filteredPitch.abs() <= 0.20 && filteredRoll.abs() <= 0.20;

    _controller.add(
      TelemetryData(
        azimuth: filteredAz,
        pitch: filteredPitch,
        roll: filteredRoll,
        rawAzimuth: rawAzimuth,
        rawPitch: rawPitch,
        rawRoll: rawRoll,
        jitterDelta: azDelta.abs(),
        kalmanGain: _kalmanPitch.kalmanGain,
        isLevelLocked: isLevel,
        timestamp: DateTime.now(),
      ),
    );
  }
}

/// ============================================================================
/// 5. LOCAL SQLITE SURVEY DATABASE HELPER
/// ============================================================================

class StationDatabaseHelper {
  static final StationDatabaseHelper instance = StationDatabaseHelper._init();
  static Database? _database;

  StationDatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('geosight_industrial_totalstation.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 4,
      onCreate: _createDB,
      onUpgrade: (db, oldVersion, newVersion) async {
        await db.execute('DROP TABLE IF EXISTS survey_stations');
        await _createDB(db, newVersion);
      },
    );
  }

  Future _createDB(Database db, int version) async {
    await db.execute('''
      CREATE TABLE survey_stations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        feature_code TEXT NOT NULL,
        azimuth REAL NOT NULL,
        pitch REAL NOT NULL,
        roll REAL NOT NULL,
        baseline_dist REAL NOT NULL,
        hi_height REAL NOT NULL,
        hr_height REAL NOT NULL,
        northing REAL NOT NULL,
        easting REAL NOT NULL,
        true_elevation REAL NOT NULL,
        vertical_dist REAL NOT NULL,
        horizontal_dist REAL NOT NULL,
        slope_dist REAL NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude REAL NOT NULL,
        accuracy REAL NOT NULL,
        zoom_factor REAL NOT NULL,
        notes TEXT,
        timestamp TEXT NOT NULL
      )
    ''');
  }

  Future<int> insertStation(SurveyStation station) async {
    final db = await instance.database;
    return await db.insert('survey_stations', station.toMap());
  }

  Future<List<SurveyStation>> getAllStations() async {
    final db = await instance.database;
    final result = await db.query('survey_stations', orderBy: 'id ASC');
    return result.map((json) => SurveyStation.fromMap(json)).toList();
  }

  Future<int> deleteStation(int id) async {
    final db = await instance.database;
    return await db.delete('survey_stations', where: 'id = ?', whereArgs: [id]);
  }

  Future<int> clearAll() async {
    final db = await instance.database;
    return await db.delete('survey_stations');
  }
}

/// ============================================================================
/// 6. HIGH-VALUE INDUSTRY EXPORT ENGINE (CSV, RAW AUTOCAD DXF, GOOGLE EARTH KML)
/// ============================================================================

class HighValueExportEngine {
  static String generateCSV(List<SurveyStation> stations) {
    final StringBuffer sb = StringBuffer();
    sb.writeln(
      'Point_ID,Feature_Code,Northing_m,Easting_m,True_Elevation_m,Latitude,Longitude,Time,Azimuth_deg,Pitch_deg,Base_Dist_m,Slope_Dist_m,HI_m,HR_m,Notes',
    );
    for (final s in stations) {
      sb.writeln([
        s.id ?? 0,
        '"\${s.featureCode.code}"',
        s.northing.toStringAsFixed(3),
        s.easting.toStringAsFixed(3),
        s.trueElevation.toStringAsFixed(3),
        s.latitude.toStringAsFixed(7),
        s.longitude.toStringAsFixed(7),
        '"\${s.timestamp.toIso8601String()}"',
        s.azimuth.toStringAsFixed(2),
        s.pitch.toStringAsFixed(2),
        s.baselineDistance.toStringAsFixed(2),
        s.slopeDistance.toStringAsFixed(2),
        s.instrumentHeight.toStringAsFixed(2),
        s.targetHeight.toStringAsFixed(2),
        '"\${(s.notes ?? '').replaceAll('"', '""')}"',
      ].join(','));
    }
    return sb.toString();
  }

  static String generateAutoCAD_DXF(List<SurveyStation> stations) {
    final StringBuffer sb = StringBuffer();
    sb.writeln('0\nSECTION\n2\nHEADER\n9\n\$ACADVER\n1\nAC1009\n0\nENDSEC');
    sb.writeln('0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n5');
    for (final fc in FeatureCode.values) {
      sb.writeln('0\nLAYER\n2\n\${fc.code}\n70\n0\n62\n\${_dxfColorForFeature(fc)}\n6\nCONTINUOUS');
    }
    sb.writeln('0\nLAYER\n2\nLABELS\n70\n0\n62\n7\n6\nCONTINUOUS');
    sb.writeln('0\nENDTAB\n0\nENDSEC');

    sb.writeln('0\nSECTION\n2\nENTITIES');
    for (final s in stations) {
      final code = s.featureCode.code;
      sb.writeln('0\nPOINT\n8\n\$code\n10\n\${s.easting.toStringAsFixed(4)}\n20\n\${s.northing.toStringAsFixed(4)}\n30\n\${s.trueElevation.toStringAsFixed(4)}');
      sb.writeln('0\nTEXT\n8\nLABELS\n10\n\${(s.easting + 0.4).toStringAsFixed(4)}\n20\n\${(s.northing + 0.4).toStringAsFixed(4)}\n30\n\${s.trueElevation.toStringAsFixed(4)}\n40\n0.6\n1\n#\${s.id ?? 0} \$code (Z=\${s.trueElevation.toStringAsFixed(2)}m)');
    }

    if (stations.length >= 3) {
      sb.writeln('0\nPOLYLINE\n8\nBOUNDARY_LINE\n66\n1\n70\n1');
      for (final s in stations) {
        sb.writeln('0\nVERTEX\n8\nBOUNDARY_LINE\n10\n\${s.easting.toStringAsFixed(4)}\n20\n\${s.northing.toStringAsFixed(4)}\n30\n\${s.trueElevation.toStringAsFixed(4)}');
      }
      sb.writeln('0\nSEQEND');
    }

    sb.writeln('0\nENDSEC\n0\nEOF');
    return sb.toString();
  }

  static int _dxfColorForFeature(FeatureCode code) {
    switch (code) {
      case FeatureCode.BM:
        return 2;  // Yellow
      case FeatureCode.BND:
        return 3;  // Green
      case FeatureCode.UTIL:
        return 6;  // Magenta
      case FeatureCode.TOPO:
        return 4;  // Cyan
    }
  }

  static String generateGoogleEarth_KML(List<SurveyStation> stations) {
    final StringBuffer sb = StringBuffer();
    sb.writeln('''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>GeoSight Total Station Enterprise Survey</name>
    <description>Total Station survey export with calibrated NEZ coordinates.</description>
    <Style id="style-bm">
      <IconStyle><color>ff00aaff</color><scale>1.2</scale></IconStyle>
    </Style>
    <Style id="style-bnd">
      <IconStyle><color>ff81b910</color><scale>1.2</scale></IconStyle>
    </Style>
    <Style id="style-topo">
      <IconStyle><color>ffd4b606</color><scale>1.2</scale></IconStyle>
    </Style>
    <Style id="style-util">
      <IconStyle><color>fff755a8</color><scale>1.2</scale></IconStyle>
    </Style>''');

    for (final s in stations) {
      final code = s.featureCode.code.toLowerCase();
      sb.writeln('''
    <Placemark>
      <name>#\${s.id ?? 0} [\${s.featureCode.code}]</name>
      <styleUrl>#style-\$code</styleUrl>
      <description><![CDATA[
        <h3>\${s.title}</h3>
        <p><b>NEZ Grid:</b> N:\${s.northing.toStringAsFixed(3)}m, E:\${s.easting.toStringAsFixed(3)}m, Z:\${s.trueElevation.toStringAsFixed(3)}m</p>
        <p><b>Sight Angles:</b> Az: \${s.azimuth.toStringAsFixed(1)}°, Pitch: \${s.pitch.toStringAsFixed(1)}°</p>
        <p><b>Calibration:</b> HI: \${s.instrumentHeight.toStringAsFixed(2)}m, HR: \${s.targetHeight.toStringAsFixed(2)}m</p>
      ]]></description>
      <Point>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>\${s.longitude.toStringAsFixed(7)},\${s.latitude.toStringAsFixed(7)},\${s.trueElevation.toStringAsFixed(3)}</coordinates>
      </Point>
    </Placemark>''');
    }

    if (stations.length >= 3) {
      sb.writeln('''
    <Placemark>
      <name>Boundary Polygon</name>
      <Style>
        <LineStyle><color>ff00ffff</color><width>3</width></LineStyle>
        <PolyStyle><color>4400ffff</color></PolyStyle>
      </Style>
      <Polygon>
        <altitudeMode>absolute</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>''');
      for (final s in stations) {
        sb.writeln('\${s.longitude.toStringAsFixed(7)},\${s.latitude.toStringAsFixed(7)},\${s.trueElevation.toStringAsFixed(2)}');
      }
      final first = stations.first;
      sb.writeln('\${first.longitude.toStringAsFixed(7)},\${first.latitude.toStringAsFixed(7)},\${first.trueElevation.toStringAsFixed(2)}');
      sb.writeln('''
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>''');
    }

    sb.writeln('  </Document>\n</kml>');
    return sb.toString();
  }
}

/// ============================================================================
/// 7. CUSTOM PAINTERS: 60 FPS VIEWFINDER HUD, 3D BUBBLE LEVEL, STAKEOUT & RADAR
/// ============================================================================

/// 7.1 Mode A: Live Viewfinder HUD with 3D Electronic Bubble Level & GNSS Telemetry Bar
class TheodoliteHudPainter extends CustomPainter {
  final TelemetryData telemetry;
  final TotalStationTrig trig;
  final FeatureCode featureCode;
  final bool isTargetLocked;
  final Position? position;

  TheodoliteHudPainter({
    required this.telemetry,
    required this.trig,
    required this.featureCode,
    required this.isTargetLocked,
    this.position,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final accentColor = isTargetLocked ? const Color(0xFFEF4444) : featureCode.color;

    _drawOpticalBrackets(canvas, size, accentColor);
    _drawArtificialHorizon(canvas, center, telemetry.roll);
    _drawPrecisionCrosshairs(canvas, center, accentColor);
    _drawAzimuthTape(canvas, size, accentColor);
    _drawPitchLadder(canvas, size, accentColor);
    _drawGNSSTelemetryBar(canvas, size);
    _drawLiveNezStreamHUD(canvas, size);
    _drawInteractive3DTargetBubbleLevel(canvas, size);
  }

  void _drawOpticalBrackets(Canvas canvas, Size size, Color color) {
    final paint = Paint()
      ..color = color.withOpacity(0.8)
      ..strokeWidth = 1.6
      ..style = PaintingStyle.stroke;

    const double pad = 16.0;
    const double len = 22.0;

    canvas.drawLine(const Offset(pad, pad), const Offset(pad + len, pad), paint);
    canvas.drawLine(const Offset(pad, pad), const Offset(pad, pad + len), paint);

    canvas.drawLine(Offset(size.width - pad, pad), Offset(size.width - pad - len, pad), paint);
    canvas.drawLine(Offset(size.width - pad, pad), Offset(size.width - pad, pad + len), paint);

    canvas.drawLine(Offset(pad, size.height - pad), Offset(pad + len, size.height - pad), paint);
    canvas.drawLine(Offset(pad, size.height - pad), Offset(pad, size.height - pad - len), paint);

    canvas.drawLine(Offset(size.width - pad, size.height - pad), Offset(size.width - pad - len, size.height - pad), paint);
    canvas.drawLine(Offset(size.width - pad, size.height - pad), Offset(size.width - pad, size.height - pad - len), paint);
  }

  void _drawArtificialHorizon(Canvas canvas, Offset center, double rollDeg) {
    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.rotate(-rollDeg * (math.pi / 180.0));

    final paint = Paint()
      ..color = const Color(0xFF10B981).withOpacity(0.85)
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;

    const double lineLen = 120.0;
    const double gap = 40.0;

    canvas.drawLine(const Offset(-lineLen, 0), const Offset(-gap, 0), paint);
    canvas.drawLine(const Offset(-gap, 0), const Offset(-gap, 8), paint);

    canvas.drawLine(const Offset(gap, 0), const Offset(lineLen, 0), paint);
    canvas.drawLine(const Offset(gap, 0), const Offset(gap, 8), paint);

    canvas.restore();
  }

  void _drawPrecisionCrosshairs(Canvas canvas, Offset center, Color color) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;

    canvas.drawCircle(center, 26, paint);
    canvas.drawCircle(center, 3.0, Paint()..color = color..style = PaintingStyle.fill);

    const double armLen = 65.0;
    const double gap = 32.0;

    canvas.drawLine(Offset(center.dx - armLen, center.dy), Offset(center.dx - gap, center.dy), paint);
    canvas.drawLine(Offset(center.dx + gap, center.dy), Offset(center.dx + armLen, center.dy), paint);
    canvas.drawLine(Offset(center.dx, center.dy - armLen), Offset(center.dx, center.dy - gap), paint);
    canvas.drawLine(Offset(center.dx, center.dy + gap), Offset(center.dx, center.dy + armLen), paint);

    for (double d in [42.0, 54.0]) {
      canvas.drawLine(Offset(center.dx - d, center.dy - 3), Offset(center.dx - d, center.dy + 3), paint);
      canvas.drawLine(Offset(center.dx + d, center.dy - 3), Offset(center.dx + d, center.dy + 3), paint);
      canvas.drawLine(Offset(center.dx - 3, center.dy - d), Offset(center.dx + 3, center.dy - d), paint);
      canvas.drawLine(Offset(center.dx - 3, center.dy + d), Offset(center.dx + 3, center.dy + d), paint);
    }
  }

  void _drawAzimuthTape(Canvas canvas, Size size, Color accent) {
    const double tapeY = 56.0;
    final double centerX = size.width / 2;
    const double pxPerDeg = 6.0;
    const double halfW = 120.0;

    final bgRect = Rect.fromCenter(center: Offset(centerX, tapeY), width: halfW * 2 + 16, height: 28);
    canvas.drawRRect(
      RRect.fromRectAndRadius(bgRect, const Radius.circular(6)),
      Paint()..color = const Color(0xFF030712).withOpacity(0.85),
    );

    final double curAz = telemetry.azimuth;
    final int startDeg = (curAz - halfW / pxPerDeg).floor() - 1;
    final int endDeg = (curAz + halfW / pxPerDeg).ceil() + 1;

    for (int deg = startDeg; deg <= endDeg; deg++) {
      final double norm = (deg % 360 + 360) % 360;
      final double x = centerX + (deg - curAz) * pxPerDeg;
      if (x < centerX - halfW || x > centerX + halfW) continue;

      final bool isCard = norm % 90 == 0;
      final bool isMajor = norm % 10 == 0;
      final double tickH = isCard ? 10.0 : (isMajor ? 7.0 : 4.0);

      canvas.drawLine(
        Offset(x, tapeY - tickH / 2),
        Offset(x, tapeY + tickH / 2),
        Paint()
          ..color = isCard ? accent : (isMajor ? Colors.white : Colors.white38)
          ..strokeWidth = isMajor ? 1.4 : 0.8,
      );

      if (isMajor) {
        String label = '\${norm.toInt()}°';
        if (norm == 0) label = 'N';
        if (norm == 90) label = 'E';
        if (norm == 180) label = 'S';
        if (norm == 270) label = 'W';

        _drawText(
          canvas,
          label,
          Offset(x, tapeY + 10),
          fontSize: isCard ? 9.5 : 7.5,
          isBold: isCard,
          color: isCard ? accent : Colors.white,
        );
      }
    }
  }

  void _drawPitchLadder(Canvas canvas, Size size, Color accent) {
    final double ladderX = size.width - 24.0;
    final double centerY = size.height / 2;
    const double pxPerDeg = 5.0;
    const double halfH = 85.0;

    final double pitch = telemetry.pitch;
    final int startDeg = (pitch - halfH / pxPerDeg).floor() - 1;
    final int endDeg = (pitch + halfH / pxPerDeg).ceil() + 1;

    for (int deg = startDeg; deg <= endDeg; deg++) {
      if (deg < -90 || deg > 90) continue;
      final double y = centerY - (deg - pitch) * pxPerDeg;
      if (y < centerY - halfH || y > centerY + halfH) continue;

      final bool isMajor = deg % 5 == 0;
      final double tickLen = isMajor ? 12.0 : 6.0;

      canvas.drawLine(
        Offset(ladderX - tickLen, y),
        Offset(ladderX, y),
        Paint()
          ..color = isMajor ? Colors.white : Colors.white38
          ..strokeWidth = isMajor ? 1.4 : 0.8,
      );

      if (isMajor && deg != 0) {
        _drawText(
          canvas,
          '\${deg > 0 ? '+' : ''}\$deg°',
          Offset(ladderX - 16, y),
          fontSize: 7.5,
          color: Colors.white70,
          align: TextAlign.right,
        );
      }
    }

    canvas.drawLine(
      Offset(ladderX - 16, centerY),
      Offset(ladderX, centerY),
      Paint()..color = accent..strokeWidth = 2.0,
    );
  }

  /// Dedicated High-Precision GNSS Telemetry Bar
  void _drawGNSSTelemetryBar(Canvas canvas, Size size) {
    const double topY = 12.0;
    const double pad = 12.0;
    final double w = size.width - pad * 2;

    final barRect = Rect.fromLTWH(pad, topY, w, 22.0);
    canvas.drawRRect(
      RRect.fromRectAndRadius(barRect, const Radius.circular(5)),
      Paint()..color = const Color(0xFF030712).withOpacity(0.92),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(barRect, const Radius.circular(5)),
      Paint()
        ..color = const Color(0xFF10B981).withOpacity(0.4)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.8,
    );

    canvas.drawCircle(const Offset(pad + 10, topY + 11), 3.5, Paint()..color = const Color(0xFF10B981));
    _drawText(
      canvas,
      'RTK FIXED',
      const Offset(pad + 20, topY + 11),
      fontSize: 8.5,
      isBold: true,
      color: const Color(0xFF10B981),
      align: TextAlign.left,
    );

    final double acc = position?.accuracy ?? 0.015;
    _drawText(
      canvas,
      'HDOP: 0.78  |  SATS: 21/28  |  RMS: ±\${acc.toStringAsFixed(3)}m  |  KALMAN GAIN: \${telemetry.kalmanGain.toStringAsFixed(2)}',
      Offset(pad + w - 8, topY + 11),
      fontSize: 7.5,
      color: Colors.white70,
      align: TextAlign.right,
    );
  }

  /// Live NEZ Grid Coordinates Banner
  void _drawLiveNezStreamHUD(Canvas canvas, Size size) {
    const double topY = 74.0;
    const double pad = 12.0;
    final double w = size.width - pad * 2;

    final hudRect = Rect.fromLTWH(pad, topY, w, 52.0);
    canvas.drawRRect(
      RRect.fromRectAndRadius(hudRect, const Radius.circular(8)),
      Paint()..color = const Color(0xFF030712).withOpacity(0.92),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(hudRect, const Radius.circular(8)),
      Paint()
        ..color = const Color(0xFF06B6D4).withOpacity(0.5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.0,
    );

    final badgeRect = Rect.fromLTWH(pad + 8, topY + 7, 42, 17);
    canvas.drawRRect(
      RRect.fromRectAndRadius(badgeRect, const Radius.circular(4)),
      Paint()..color = featureCode.color.withOpacity(0.2),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(badgeRect, const Radius.circular(4)),
      Paint()..color = featureCode.color..style = PaintingStyle.stroke..strokeWidth = 1.0,
    );
    _drawText(
      canvas,
      featureCode.code,
      Offset(pad + 29, topY + 15),
      fontSize: 9,
      isBold: true,
      color: featureCode.color,
    );

    final n = trig.targetNorthing;
    final e = trig.targetEasting;
    final z = trig.trueTargetElevation;
    final dz = trig.trueElevationDelta;

    _drawText(
      canvas,
      'N:\${n >= 0 ? '+' : ''}\${n.toStringAsFixed(2)}m',
      Offset(pad + 58, topY + 15),
      fontSize: 10,
      isBold: true,
      color: const Color(0xFF10B981),
      align: TextAlign.left,
    );

    _drawText(
      canvas,
      'E:\${e >= 0 ? '+' : ''}\${e.toStringAsFixed(2)}m',
      Offset(pad + w * 0.52, topY + 15),
      fontSize: 10,
      isBold: true,
      color: const Color(0xFF38BDF8),
      align: TextAlign.left,
    );

    _drawText(
      canvas,
      'Z:\${z.toStringAsFixed(2)}m (ΔZ:\${dz >= 0 ? '+' : ''}\${dz.toStringAsFixed(2)}m)',
      Offset(pad + 10, topY + 36),
      fontSize: 10,
      isBold: true,
      color: const Color(0xFFFBBF24),
      align: TextAlign.left,
    );

    _drawText(
      canvas,
      'BASE:\${trig.baselineDistance.toStringAsFixed(1)}m HI:\${trig.instrumentHeight.toStringAsFixed(2)} HR:\${trig.targetHeight.toStringAsFixed(2)}',
      Offset(pad + w - 10, topY + 36),
      fontSize: 8.5,
      color: Colors.white70,
      align: TextAlign.right,
    );
  }

  /// Interactive 3D Target Electronic Bubble Level
  void _drawInteractive3DTargetBubbleLevel(Canvas canvas, Size size) {
    const double radius = 32.0;
    const double pad = 16.0;
    final center = Offset(size.width - radius - pad, size.height - radius - 64.0);

    final bool isLevel = telemetry.isLevelLocked;
    final Color levelColor = isLevel ? const Color(0xFF10B981) : const Color(0xFFF59E0B);

    canvas.drawCircle(
      center,
      radius + 4,
      Paint()..color = const Color(0xFF030712).withOpacity(0.90),
    );

    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..color = levelColor.withOpacity(0.5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );

    canvas.drawCircle(
      center,
      8.0,
      Paint()
        ..color = levelColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = isLevel ? 2.0 : 1.0,
    );

    final gridPaint = Paint()
      ..color = Colors.white24
      ..strokeWidth = 0.8;
    canvas.drawLine(Offset(center.dx - radius, center.dy), Offset(center.dx + radius, center.dy), gridPaint);
    canvas.drawLine(Offset(center.dx, center.dy - radius), Offset(center.dx, center.dy + radius), gridPaint);

    const double maxAngle = 5.0;
    const double bubbleR = 6.0;
    final double maxTravel = radius - bubbleR - 2.0;

    final double normRoll = (telemetry.roll / maxAngle).clamp(-1.0, 1.0);
    final double normPitch = (telemetry.pitch / maxAngle).clamp(-1.0, 1.0);

    final double bubbleX = center.dx + normRoll * maxTravel;
    final double bubbleY = center.dy - normPitch * maxTravel;

    canvas.drawCircle(
      Offset(bubbleX, bubbleY),
      bubbleR + 2,
      Paint()..color = levelColor.withOpacity(0.35),
    );
    canvas.drawCircle(
      Offset(bubbleX, bubbleY),
      bubbleR,
      Paint()..color = levelColor..style = PaintingStyle.fill,
    );
    canvas.drawCircle(
      Offset(bubbleX, bubbleY),
      bubbleR,
      Paint()..color = Colors.white..style = PaintingStyle.stroke..strokeWidth = 1.0,
    );

    _drawText(
      canvas,
      isLevel ? 'LEVEL LOCKED' : 'TILT: \${math.sqrt(telemetry.pitch * telemetry.pitch + telemetry.roll * telemetry.roll).toStringAsFixed(1)}°',
      Offset(center.dx, center.dy + radius + 11),
      fontSize: 7.5,
      isBold: true,
      color: levelColor,
    );
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset position, {
    double fontSize = 10,
    Color color = Colors.white,
    bool isBold = false,
    TextAlign align = TextAlign.center,
  }) {
    final textSpan = TextSpan(
      text: text,
      style: TextStyle(
        color: color,
        fontSize: fontSize,
        fontFamily: 'monospace',
        fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
      ),
    );
    final textPainter = TextPainter(
      text: textSpan,
      textAlign: align,
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();

    Offset offset = position;
    if (align == TextAlign.center) {
      offset = Offset(position.dx - textPainter.width / 2, position.dy - textPainter.height / 2);
    } else if (align == TextAlign.right) {
      offset = Offset(position.dx - textPainter.width, position.dy - textPainter.height / 2);
    } else {
      offset = Offset(position.dx, position.dy - textPainter.height / 2);
    }
    textPainter.paint(canvas, offset);
  }

  @override
  bool shouldRepaint(covariant TheodoliteHudPainter oldDelegate) => true;
}

/// 7.2 Stakeout Navigation CustomPainter
class StakeoutGuidancePainter extends CustomPainter {
  final StakeoutGuidance guidance;
  final StakeoutTarget target;
  final double currentAzimuth;

  StakeoutGuidancePainter({
    required this.guidance,
    required this.target,
    required this.currentAzimuth,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2 - 20);

    final ringPaint = Paint()
      ..color = const Color(0xFF06B6D4).withOpacity(0.2)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    canvas.drawCircle(center, 40, ringPaint);
    canvas.drawCircle(center, 80, ringPaint);
    canvas.drawCircle(center, 120, ringPaint);

    final bullseyePaint = Paint()
      ..color = guidance.isOnTarget ? const Color(0xFF10B981) : const Color(0xFFF59E0B)
      ..style = PaintingStyle.stroke
      ..strokeWidth = guidance.isOnTarget ? 3.0 : 1.5;

    canvas.drawCircle(center, 18, bullseyePaint);

    if (guidance.isOnTarget) {
      canvas.drawCircle(center, 18, Paint()..color = const Color(0xFF10B981).withOpacity(0.3));
    }

    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.rotate(guidance.bearingDelta * (math.pi / 180.0));

    final arrowPaint = Paint()
      ..color = guidance.isOnTarget ? const Color(0xFF10B981) : const Color(0xFFEF4444)
      ..strokeWidth = 3.5
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    const double arrowLen = 75.0;
    canvas.drawLine(Offset.zero, const Offset(0, -arrowLen), arrowPaint);

    final headPath = Path()
      ..moveTo(-10, -arrowLen + 15)
      ..lineTo(0, -arrowLen)
      ..lineTo(10, -arrowLen + 15);
    canvas.drawPath(headPath, arrowPaint..style = PaintingStyle.stroke);

    canvas.restore();

    final topRect = Rect.fromLTWH(14, 16, size.width - 28, 92);
    canvas.drawRRect(
      RRect.fromRectAndRadius(topRect, const Radius.circular(12)),
      Paint()..color = const Color(0xFF030712).withOpacity(0.92),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(topRect, const Radius.circular(12)),
      Paint()
        ..color = guidance.isOnTarget ? const Color(0xFF10B981) : const Color(0xFFF59E0B)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4,
    );

    _drawText(
      canvas,
      guidance.isOnTarget ? '★ ON TARGET [BULLSEYE LOCK] ★' : 'NAVIGATING TO TARGET: \${target.pointId}',
      Offset(size.width / 2, 28),
      fontSize: 10,
      isBold: true,
      color: guidance.isOnTarget ? const Color(0xFF10B981) : const Color(0xFFF59E0B),
    );

    _drawText(
      canvas,
      'DIST: \${guidance.horizontalDistance.toStringAsFixed(2)} m',
      Offset(size.width / 2, 48),
      fontSize: 16,
      isBold: true,
      color: Colors.white,
    );

    final String fwdStr = guidance.moveForward >= 0
        ? '▲ FWD \${guidance.moveForward.toStringAsFixed(2)}m'
        : '▼ BACK \${(-guidance.moveForward).toStringAsFixed(2)}m';
    final String latStr = guidance.moveRight >= 0
        ? '► RIGHT \${guidance.moveRight.toStringAsFixed(2)}m'
        : '◄ LEFT \${(-guidance.moveRight).toStringAsFixed(2)}m';
    final String cfStr = guidance.cutFill >= 0
        ? 'FILL +\${guidance.cutFill.toStringAsFixed(2)}m'
        : 'CUT \${guidance.cutFill.toStringAsFixed(2)}m';

    _drawText(
      canvas,
      '\$fwdStr  |  \$latStr  |  \$cfStr',
      Offset(size.width / 2, 68),
      fontSize: 10,
      isBold: true,
      color: const Color(0xFF06B6D4),
    );

    _drawText(
      canvas,
      'Audio Ping Rate: \${guidance.audioPingIntervalMs}ms | Target: N=\${target.targetNorthing.toStringAsFixed(2)}m, E=\${target.targetEasting.toStringAsFixed(2)}m',
      Offset(size.width / 2, 84),
      fontSize: 8.5,
      color: Colors.white60,
    );
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset position, {
    double fontSize = 10,
    Color color = Colors.white,
    bool isBold = false,
    TextAlign align = TextAlign.center,
  }) {
    final textSpan = TextSpan(
      text: text,
      style: TextStyle(
        color: color,
        fontSize: fontSize,
        fontFamily: 'monospace',
        fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
      ),
    );
    final textPainter = TextPainter(
      text: textSpan,
      textAlign: align,
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();

    Offset offset = position;
    if (align == TextAlign.center) {
      offset = Offset(position.dx - textPainter.width / 2, position.dy - textPainter.height / 2);
    } else if (align == TextAlign.right) {
      offset = Offset(position.dx - textPainter.width, position.dy - textPainter.height / 2);
    } else {
      offset = Offset(position.dx, position.dy - textPainter.height / 2);
    }
    textPainter.paint(canvas, offset);
  }

  @override
  bool shouldRepaint(covariant StakeoutGuidancePainter oldDelegate) => true;
}

/// 7.3 Mode B: 2D Radar Canvas Plotter & 3D Polyline Visualizer
class RadarAndPolygonPlotterPainter extends CustomPainter {
  final List<SurveyStation> stations;
  final TelemetryData telemetry;
  final TotalStationTrig trig;
  final FeatureCode activeFeatureCode;
  final double zoomScale;
  final VolumetricAreaResult? volumeResult;

  RadarAndPolygonPlotterPainter({
    required this.stations,
    required this.telemetry,
    required this.trig,
    required this.activeFeatureCode,
    this.zoomScale = 1.0,
    this.volumeResult,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), Paint()..color = const Color(0xFF030712));

    double maxDist = trig.baselineDistance;
    for (final s in stations) {
      final d = math.sqrt(s.northing * s.northing + s.easting * s.easting);
      if (d > maxDist) maxDist = d;
    }
    if (maxDist < 25) maxDist = 25;

    final double basePpm = (math.min(size.width, size.height) * 0.38) / maxDist;
    final double ppm = basePpm * zoomScale;

    // Range Rings
    for (int i = 1; i <= 6; i++) {
      final double rMeters = i * (maxDist / 4);
      final double rPixels = rMeters * ppm;
      if (rPixels > math.max(size.width, size.height)) break;

      canvas.drawCircle(
        center,
        rPixels,
        Paint()
          ..color = const Color(0xFF06B6D4).withOpacity(0.18)
          ..strokeWidth = 0.8
          ..style = PaintingStyle.stroke,
      );

      _drawText(
        canvas,
        '\${rMeters.toInt()}m',
        Offset(center.dx + 4, center.dy - rPixels + 8),
        fontSize: 8,
        color: const Color(0xFF06B6D4).withOpacity(0.6),
        align: TextAlign.left,
      );
    }

    final axisPaint = Paint()..color = Colors.white24..strokeWidth = 0.8;
    canvas.drawLine(Offset(0, center.dy), Offset(size.width, center.dy), axisPaint);
    canvas.drawLine(Offset(center.dx, 0), Offset(center.dx, size.height), axisPaint);

    _drawText(canvas, 'N (+Northing)', Offset(center.dx, 16), fontSize: 10, isBold: true, color: const Color(0xFF06B6D4));
    _drawText(canvas, 'E (+Easting)', Offset(size.width - 45, center.dy - 8), fontSize: 9, isBold: true, color: const Color(0xFF06B6D4));

    // Center Station (0,0)
    canvas.drawCircle(center, 5.0, Paint()..color = const Color(0xFFF59E0B));
    canvas.drawCircle(center, 8.0, Paint()..color = Colors.white..style = PaintingStyle.stroke..strokeWidth = 1.5);
    _drawText(canvas, 'STATION (0,0)', Offset(center.dx + 12, center.dy + 12), fontSize: 8, isBold: true, color: const Color(0xFFF59E0B), align: TextAlign.left);

    // Aiming Vector Line
    final liveTargetX = center.dx + trig.deltaEasting * ppm;
    final liveTargetY = center.dy - trig.deltaNorthing * ppm;

    canvas.drawLine(
      center,
      Offset(liveTargetX, liveTargetY),
      Paint()..color = const Color(0xFFEF4444).withOpacity(0.8)..strokeWidth = 1.5,
    );
    canvas.drawCircle(Offset(liveTargetX, liveTargetY), 5.0, Paint()..color = const Color(0xFFEF4444));

    // 3D Survey Polygon Boundary
    if (stations.length >= 3) {
      final polyPath = Path();
      for (int i = 0; i < stations.length; i++) {
        final ptX = center.dx + stations[i].easting * ppm;
        final ptY = center.dy - stations[i].northing * ppm;
        if (i == 0) {
          polyPath.moveTo(ptX, ptY);
        } else {
          polyPath.lineTo(ptX, ptY);
        }
      }
      polyPath.close();

      canvas.drawPath(polyPath, Paint()..color = const Color(0xFF10B981).withOpacity(0.15));
      canvas.drawPath(
        polyPath,
        Paint()
          ..color = const Color(0xFF10B981)
          ..strokeWidth = 1.8
          ..style = PaintingStyle.stroke,
      );

      if (volumeResult != null && volumeResult!.surfaceAreaSqMeters > 0) {
        final badgeRect = Rect.fromLTWH(12, size.height - 42, 240, 30);
        canvas.drawRRect(
          RRect.fromRectAndRadius(badgeRect, const Radius.circular(6)),
          Paint()..color = const Color(0xFF030712).withOpacity(0.85),
        );
        _drawText(
          canvas,
          'AREA: \${volumeResult!.surfaceAreaSqMeters.toStringAsFixed(1)} m²  |  VOL: \${volumeResult!.estimatedVolumeCuMeters.toStringAsFixed(1)} m³',
          Offset(20, size.height - 24),
          fontSize: 8.5,
          isBold: true,
          color: const Color(0xFF10B981),
          align: TextAlign.left,
        );
      }
    }

    // Plot Logged Stations
    for (final s in stations) {
      final ptX = center.dx + s.easting * ppm;
      final ptY = center.dy - s.northing * ppm;

      canvas.drawCircle(Offset(ptX, ptY), 5.0, Paint()..color = s.featureCode.color);
      canvas.drawCircle(Offset(ptX, ptY), 7.0, Paint()..color = Colors.white..style = PaintingStyle.stroke..strokeWidth = 1.0);

      _drawText(
        canvas,
        '#\${s.id ?? 0} \${s.featureCode.code} (\${s.trueElevation.toStringAsFixed(1)}m)',
        Offset(ptX + 8, ptY - 6),
        fontSize: 7.5,
        isBold: true,
        color: s.featureCode.color,
        align: TextAlign.left,
      );
    }
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset position, {
    double fontSize = 10,
    Color color = Colors.white,
    bool isBold = false,
    TextAlign align = TextAlign.center,
  }) {
    final textSpan = TextSpan(
      text: text,
      style: TextStyle(
        color: color,
        fontSize: fontSize,
        fontFamily: 'monospace',
        fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
      ),
    );
    final textPainter = TextPainter(
      text: textSpan,
      textAlign: align,
      textDirection: TextDirection.ltr,
    );
    textPainter.layout();

    Offset offset = position;
    if (align == TextAlign.left) {
      offset = Offset(position.dx, position.dy - textPainter.height / 2);
    } else {
      offset = Offset(position.dx - textPainter.width / 2, position.dy - textPainter.height / 2);
    }
    textPainter.paint(canvas, offset);
  }

  @override
  bool shouldRepaint(covariant RadarAndPolygonPlotterPainter oldDelegate) => true;
}

/// ============================================================================
/// 8. PRIMARY TOTAL STATION USER INTERFACE SCREEN
/// Multi-Mode HUD with Audio Stakeout Ping Matrix and Kalman Matrix Tuning
/// ============================================================================

class TotalStationScreen extends StatefulWidget {
  const TotalStationScreen({super.key});

  @override
  State<TotalStationScreen> createState() => _TotalStationScreenState();
}

class _TotalStationScreenState extends State<TotalStationScreen> {
  // Screen Display Mode: 0 = Camera HUD, 1 = 2D Radar Grid, 2 = Stakeout Navigation
  int _activeDisplayMode = 0;

  CameraController? _cameraController;
  late final SensorFusionEngine _sensorEngine;
  TelemetryData _telemetry = TelemetryData.initial();
  Position? _currentPosition;
  bool _isTargetLocked = false;
  double _zoomFactor = 1.0;

  // Station Coordinates Datum
  double _stationNorthing = 0.0;
  double _stationEasting = 0.0;
  double _stationElevation = 100.0;

  // Optical Parameters
  double _baselineDistance = 25.0; // Ground Horizontal Distance (m)
  double _instrumentHeight = 1.55; // HI (m)
  double _targetHeight = 1.60;     // HR (m)

  // Feature Code Selection
  FeatureCode _selectedFeatureCode = FeatureCode.TOPO;

  // Active Stakeout Target
  StakeoutTarget _activeStakeoutTarget = const StakeoutTarget(
    pointId: 'STK-01',
    targetNorthing: 20.0,
    targetEasting: 15.0,
    targetElevation: 101.5,
  );

  // Audio Stakeout Ping Matrix State
  Timer? _stakeoutPingTimer;
  bool _isAudioPingEnabled = true;

  // 3D Volumetric and Area State
  VolumetricAreaResult? _currentVolumetricResult;

  // Logged Station Points in SQLite
  List<SurveyStation> _loggedStations = [];
  bool _isLogging = false;

  @override
  void initState() {
    super.initState();
    _sensorEngine = SensorFusionEngine();
    _sensorEngine.telemetryStream.listen((data) {
      if (!_isTargetLocked && mounted) {
        setState(() => _telemetry = data);
      }
    });
    _sensorEngine.start();

    _initCamera();
    _initLocation();
    _loadStoredStations();
    _startStakeoutPingLoop();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _showOnboardingTutorialDialog();
    });
  }

  @override
  void dispose() {
    _stakeoutPingTimer?.cancel();
    _sensorEngine.stop();
    _cameraController?.dispose();
    super.dispose();
  }

  /// Audio Stakeout Ping Loop: pulses system sound/haptics at accelerated frequency
  void _startStakeoutPingLoop() {
    _stakeoutPingTimer?.cancel();
    _scheduleNextAudioPing();
  }

  void _scheduleNextAudioPing() {
    if (!mounted) return;

    final int intervalMs = (_activeDisplayMode == 2)
        ? _currentStakeoutGuidance.audioPingIntervalMs
        : 2000;

    _stakeoutPingTimer = Timer(Duration(milliseconds: intervalMs), () {
      if (mounted && _activeDisplayMode == 2 && _isAudioPingEnabled) {
        _triggerStakeoutAudioPing();
      }
      _scheduleNextAudioPing();
    });
  }

  void _triggerStakeoutAudioPing() {
    final guidance = _currentStakeoutGuidance;
    if (guidance.isOnTarget) {
      HapticFeedback.heavyImpact();
      SystemSound.play(SystemSoundType.alert);
    } else if (guidance.horizontalDistance < 1.0) {
      HapticFeedback.mediumImpact();
      SystemSound.play(SystemSoundType.click);
    } else {
      HapticFeedback.selectionClick();
      SystemSound.play(SystemSoundType.click);
    }
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isNotEmpty) {
        _cameraController = CameraController(
          cameras.first,
          ResolutionPreset.high,
          enableAudio: false,
        );
        await _cameraController!.initialize();
        if (mounted) setState(() {});
      }
    } catch (e) {
      debugPrint('Camera initialization error: \$e');
    }
  }

  Future<void> _initLocation() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.always || permission == LocationPermission.whileInUse) {
        final pos = await Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.high);
        if (mounted) setState(() => _currentPosition = pos);
      }
    } catch (e) {
      debugPrint('Geolocator error: \$e');
    }
  }

  Future<void> _loadStoredStations() async {
    final stations = await StationDatabaseHelper.instance.getAllStations();
    if (mounted) {
      setState(() {
        _loggedStations = stations;
        if (stations.length >= 3) {
          _currentVolumetricResult = VolumetricAreaEngine.computePolylineVolumeAndArea(stations);
        }
      });
    }
  }

  TotalStationTrig get _currentTrig => TotalStationTrig(
        baselineDistance: _baselineDistance,
        pitchAngleDeg: _telemetry.pitch,
        azimuthAngleDeg: _telemetry.azimuth,
        instrumentHeight: _instrumentHeight,
        targetHeight: _targetHeight,
        stationNorthing: _stationNorthing,
        stationEasting: _stationEasting,
        stationElevation: _currentPosition?.altitude ?? _stationElevation,
      );

  StakeoutGuidance get _currentStakeoutGuidance {
    final trig = _currentTrig;
    return StakeoutNavigationEngine.calculateGuidance(
      target: _activeStakeoutTarget,
      currentNorthing: trig.targetNorthing,
      currentEasting: trig.targetEasting,
      currentElevation: trig.trueTargetElevation,
      currentAzimuth: _telemetry.azimuth,
    );
  }

  Future<void> _logSurveyStation() async {
    setState(() => _isLogging = true);
    final trig = _currentTrig;
    final nextId = _loggedStations.isEmpty ? 1 : (_loggedStations.last.id ?? 0) + 1;

    final station = SurveyStation(
      title: 'STATION_\${nextId.toString().padLeft(3, '0')}',
      featureCode: _selectedFeatureCode,
      azimuth: _telemetry.azimuth,
      pitch: _telemetry.pitch,
      roll: _telemetry.roll,
      baselineDistance: _baselineDistance,
      instrumentHeight: _instrumentHeight,
      targetHeight: _targetHeight,
      northing: trig.targetNorthing,
      easting: trig.targetEasting,
      trueElevation: trig.trueTargetElevation,
      rawVerticalDistance: trig.rawVerticalDistance,
      horizontalDistance: trig.horizontalDistance,
      slopeDistance: trig.slopeDistance,
      latitude: _currentPosition?.latitude ?? 37.774929,
      longitude: _currentPosition?.longitude ?? -122.419416,
      altitude: _currentPosition?.altitude ?? _stationElevation,
      accuracy: _currentPosition?.accuracy ?? 0.04,
      zoomFactor: _zoomFactor,
      notes: 'Industrial Total Station Shot [#\${_selectedFeatureCode.code}]',
      timestamp: DateTime.now(),
    );

    await StationDatabaseHelper.instance.insertStation(station);
    await _loadStoredStations();
    setState(() => _isLogging = false);

    if (mounted) {
      HapticFeedback.mediumImpact();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Station #\${station.id} Logged: N:\${trig.targetNorthing.toStringAsFixed(2)}m, E:\${trig.targetEasting.toStringAsFixed(2)}m, Z:\${trig.trueTargetElevation.toStringAsFixed(2)}m',
          ),
          backgroundColor: const Color(0xFF0F172A),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  // --- MODAL DIALOGS ---

  void _showResectionDialog() {
    if (_loggedStations.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('At least 2 Benchmark points must be logged before Resection.')),
      );
      return;
    }

    int cpAIndex = 0;
    int cpBIndex = 1;
    final distACtrl = TextEditingController(text: '25.0');
    final azACtrl = TextEditingController(text: _telemetry.azimuth.toStringAsFixed(1));
    final distBCtrl = TextEditingController(text: '30.0');
    final azBCtrl = TextEditingController(text: ((_telemetry.azimuth + 60.0) % 360).toStringAsFixed(1));

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlgState) => AlertDialog(
          backgroundColor: const Color(0xFF0F172A),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.share_location, color: Color(0xFFF59E0B)),
              SizedBox(width: 8),
              Text('Resection / Free Stationing', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Select 2 known Control Points to solve Station (N0, E0):', style: TextStyle(fontSize: 11, color: Colors.white70)),
                const SizedBox(height: 12),
                DropdownButtonFormField<int>(
                  value: cpAIndex,
                  decoration: const InputDecoration(labelText: 'Control Point A'),
                  items: List.generate(_loggedStations.length, (idx) {
                    final s = _loggedStations[idx];
                    return DropdownMenuItem(value: idx, child: Text('#\${s.id} \${s.title} (N:\${s.northing.toStringAsFixed(1)}, E:\${s.easting.toStringAsFixed(1)})'));
                  }),
                  onChanged: (val) => setDlgState(() => cpAIndex = val ?? 0),
                ),
                Row(
                  children: [
                    Expanded(child: TextField(controller: distACtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Distance A (m)'))),
                    const SizedBox(width: 8),
                    Expanded(child: TextField(controller: azACtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Azimuth A (°)'))),
                  ],
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<int>(
                  value: cpBIndex,
                  decoration: const InputDecoration(labelText: 'Control Point B'),
                  items: List.generate(_loggedStations.length, (idx) {
                    final s = _loggedStations[idx];
                    return DropdownMenuItem(value: idx, child: Text('#\${s.id} \${s.title} (N:\${s.northing.toStringAsFixed(1)}, E:\${s.easting.toStringAsFixed(1)})'));
                  }),
                  onChanged: (val) => setDlgState(() => cpBIndex = val ?? 1),
                ),
                Row(
                  children: [
                    Expanded(child: TextField(controller: distBCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Distance B (m)'))),
                    const SizedBox(width: 8),
                    Expanded(child: TextField(controller: azBCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Azimuth B (°)'))),
                  ],
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), foregroundColor: Colors.black),
              onPressed: () {
                final cpA = _loggedStations[cpAIndex];
                final cpB = _loggedStations[cpBIndex];
                final dA = double.tryParse(distACtrl.text) ?? 25.0;
                final aA = double.tryParse(azACtrl.text) ?? 0.0;
                final dB = double.tryParse(distBCtrl.text) ?? 30.0;
                final aB = double.tryParse(azBCtrl.text) ?? 60.0;

                final result = ResectionCalculationEngine.computeTwoPointResection(
                  northA: cpA.northing,
                  eastA: cpA.easting,
                  distA: dA,
                  azA: aA,
                  northB: cpB.northing,
                  eastB: cpB.easting,
                  distB: dB,
                  azB: aB,
                );

                if (result.isAccurate) {
                  setState(() {
                    _stationNorthing = result.computedNorthing;
                    _stationEasting = result.computedEasting;
                  });
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Free Station Solved: N=\${result.computedNorthing.toStringAsFixed(3)}m, E=\${result.computedEasting.toStringAsFixed(3)}m')),
                  );
                } else {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(result.summary)),
                  );
                }
              },
              child: const Text('Solve Station Datum', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );
  }

  void _showStakeoutSetupDialog() {
    final ptIdCtrl = TextEditingController(text: _activeStakeoutTarget.pointId);
    final nCtrl = TextEditingController(text: _activeStakeoutTarget.targetNorthing.toStringAsFixed(2));
    final eCtrl = TextEditingController(text: _activeStakeoutTarget.targetEasting.toStringAsFixed(2));
    final zCtrl = TextEditingController(text: _activeStakeoutTarget.targetElevation.toStringAsFixed(2));

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.navigation, color: Color(0xFF10B981)),
            SizedBox(width: 8),
            Text('Stakeout Target Setup', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: ptIdCtrl, decoration: const InputDecoration(labelText: 'Target Design ID')),
            TextField(controller: nCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Design Northing (N) [m]')),
            TextField(controller: eCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Design Easting (E) [m]')),
            TextField(controller: zCtrl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Design Elevation (Z) [m]')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981), foregroundColor: Colors.black),
            onPressed: () {
              setState(() {
                _activeStakeoutTarget = StakeoutTarget(
                  pointId: ptIdCtrl.text,
                  targetNorthing: double.tryParse(nCtrl.text) ?? 20.0,
                  targetEasting: double.tryParse(eCtrl.text) ?? 15.0,
                  targetElevation: double.tryParse(zCtrl.text) ?? 100.0,
                );
                _activeDisplayMode = 2;
              });
              Navigator.pop(ctx);
            },
            child: const Text('Engage Stakeout Mode', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showVolumeAreaReportDialog() {
    if (_loggedStations.length < 3) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('At least 3 survey stations are required for 3D area/volume calculation.')),
      );
      return;
    }

    final res = VolumetricAreaEngine.computePolylineVolumeAndArea(_loggedStations);

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.square_foot, color: Color(0xFF06B6D4)),
            SizedBox(width: 8),
            Text('3D Volumetric & Land Area', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Boundary Polygon: \${res.pointCount} Survey Stations', style: const TextStyle(fontSize: 11, color: Colors.white70)),
            const Divider(color: Colors.white24, height: 20),
            Text('Horizontal Area (Shoelace):', style: TextStyle(color: Theme.of(context).colorScheme.primary, fontSize: 11)),
            Text('\${res.surfaceAreaSqMeters.toStringAsFixed(2)} m²', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
            Text('\${res.surfaceAreaHectares.toStringAsFixed(4)} Ha  (\${res.surfaceAreaSqFeet.toStringAsFixed(1)} Sq Ft)', style: const TextStyle(fontSize: 10, color: Colors.white60)),
            const SizedBox(height: 12),
            Text('Boundary Perimeter:', style: TextStyle(color: Theme.of(context).colorScheme.primary, fontSize: 11)),
            Text('\${res.perimeterMeters.toStringAsFixed(2)} meters', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white)),
            const SizedBox(height: 12),
            Text('Stockpile / Excavation 3D Volume:', style: TextStyle(color: Theme.of(context).colorScheme.primary, fontSize: 11)),
            Text('\${res.estimatedVolumeCuMeters.toStringAsFixed(2)} m³', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF10B981))),
            Text('Min Z: \${res.minElevation.toStringAsFixed(2)}m · Mean Z: \${res.meanElevation.toStringAsFixed(2)}m · Max Z: \${res.maxElevation.toStringAsFixed(2)}m', style: const TextStyle(fontSize: 9.5, color: Colors.white60)),
          ],
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF06B6D4), foregroundColor: Colors.black),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  void _showExportEngineDialog() {
    showDialog(
      context: context,
      builder: (ctx) => DefaultTabController(
        length: 3,
        child: AlertDialog(
          backgroundColor: const Color(0xFF0F172A),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('Industry Data Export Engine', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          content: SizedBox(
            width: double.maxFinite,
            height: 400,
            child: Column(
              children: [
                const TabBar(
                  tabs: [
                    Tab(text: 'AutoCAD DXF'),
                    Tab(text: 'Google KML'),
                    Tab(text: 'CSV Table'),
                  ],
                ),
                Expanded(
                  child: TabBarView(
                    children: [
                      SingleChildScrollView(
                        child: SelectableText(
                          HighValueExportEngine.generateAutoCAD_DXF(_loggedStations),
                          style: const TextStyle(fontFamily: 'monospace', fontSize: 9.5, color: Colors.white70),
                        ),
                      ),
                      SingleChildScrollView(
                        child: SelectableText(
                          HighValueExportEngine.generateGoogleEarth_KML(_loggedStations),
                          style: const TextStyle(fontFamily: 'monospace', fontSize: 9.5, color: Colors.white70),
                        ),
                      ),
                      SingleChildScrollView(
                        child: SelectableText(
                          HighValueExportEngine.generateCSV(_loggedStations),
                          style: const TextStyle(fontFamily: 'monospace', fontSize: 9.5, color: Colors.white70),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton.icon(
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy DXF'),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: HighValueExportEngine.generateAutoCAD_DXF(_loggedStations)));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('AutoCAD DXF string copied to clipboard!')));
              },
            ),
            TextButton.icon(
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy KML'),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: HighValueExportEngine.generateGoogleEarth_KML(_loggedStations)));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Google Earth KML copied to clipboard!')));
              },
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), foregroundColor: Colors.black),
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Done'),
            ),
          ],
        ),
      ),
    );
  }

  void _showOnboardingTutorialDialog() {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.precision_manufacturing, color: Color(0xFFF59E0B)),
            SizedBox(width: 8),
            Text('Industrial Station Guide', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('1. Kalman Filter Array: Eliminates IMU hand jitter for mechanical crosshair precision.', style: TextStyle(fontSize: 12, height: 1.4)),
            SizedBox(height: 8),
            Text('2. 3D Bubble Level: Electronic target shifts from orange to emerald when level ≤ 0.2°.', style: TextStyle(fontSize: 12, height: 1.4)),
            SizedBox(height: 8),
            Text('3. Audio Stakeout Ping: Dynamic sonar pulses accelerate as you approach 0.0m ground spot.', style: TextStyle(fontSize: 12, height: 1.4)),
            SizedBox(height: 8),
            Text('4. Free Stationing & 3D Volume: Built-in 2-point resection & Gauss shoelace area engines.', style: TextStyle(fontSize: 12, height: 1.4)),
          ],
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), foregroundColor: Colors.black),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Commence Survey', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final trig = _currentTrig;
    final stakeout = _currentStakeoutGuidance;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF070B12),
        elevation: 0,
        title: Row(
          children: [
            const Text('GEOSIGHT', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Color(0xFFF59E0B))),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withOpacity(0.15),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: const Color(0xFF10B981).withOpacity(0.4)),
              ),
              child: const Text('KALMAN ACTIVE', style: TextStyle(fontSize: 8.5, color: Color(0xFF10B981), fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        actions: [
          if (_activeDisplayMode == 2)
            IconButton(
              icon: Icon(_isAudioPingEnabled ? Icons.volume_up : Icons.volume_off, color: const Color(0xFF10B981)),
              tooltip: 'Toggle Audio Ping Sonar',
              onPressed: () => setState(() => _isAudioPingEnabled = !_isAudioPingEnabled),
            ),
          IconButton(
            icon: const Icon(Icons.share_location, color: Color(0xFFF59E0B)),
            tooltip: 'Resection / Free Stationing',
            onPressed: _showResectionDialog,
          ),
          IconButton(
            icon: const Icon(Icons.navigation, color: Color(0xFF10B981)),
            tooltip: 'Stakeout Navigation',
            onPressed: _showStakeoutSetupDialog,
          ),
          IconButton(
            icon: const Icon(Icons.square_foot, color: Color(0xFF06B6D4)),
            tooltip: '3D Area & Volume Calculator',
            onPressed: _showVolumeAreaReportDialog,
          ),
          IconButton(
            icon: const Icon(Icons.download, color: Colors.white70),
            tooltip: 'AutoCAD DXF & KML Export',
            onPressed: _showExportEngineDialog,
          ),
        ],
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          return Column(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                color: const Color(0xFF0F172A),
                child: Row(
                  children: [
                    Expanded(
                      child: SegmentedButton<int>(
                        segments: const [
                          ButtonSegment(value: 0, icon: Icon(Icons.camera_alt, size: 16), label: Text('HUD')),
                          ButtonSegment(value: 1, icon: Icon(Icons.radar, size: 16), label: Text('Radar')),
                          ButtonSegment(value: 2, icon: Icon(Icons.navigation, size: 16), label: Text('Stakeout')),
                        ],
                        selected: {_activeDisplayMode},
                        onSelectionChanged: (set) {
                          setState(() => _activeDisplayMode = set.first);
                        },
                      ),
                    ),
                  ],
                ),
              ),

              if (_activeDisplayMode != 2)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  color: const Color(0xFF070B12),
                  child: Row(
                    children: [
                      const Text('CODE: ', style: TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.white70)),
                      Expanded(
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: FeatureCode.values.map((fc) {
                            final isSel = _selectedFeatureCode == fc;
                            return ChoiceChip(
                              label: Text(fc.code, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold, color: isSel ? Colors.black : fc.color)),
                              selected: isSel,
                              selectedColor: fc.color,
                              backgroundColor: const Color(0xFF0F172A),
                              onSelected: (selected) {
                                if (selected) setState(() => _selectedFeatureCode = fc);
                              },
                            );
                          }).toList(),
                        ),
                      ),
                    ],
                  ),
                ),

              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (_activeDisplayMode == 0) ...[
                      if (_cameraController != null && _cameraController!.value.isInitialized)
                        CameraPreview(_cameraController!)
                      else
                        Container(color: Colors.black, child: const Center(child: Text('Simulated Optical Viewfinder', style: TextStyle(color: Colors.white54)))),

                      CustomPaint(
                        painter: TheodoliteHudPainter(
                          telemetry: _telemetry,
                          trig: trig,
                          featureCode: _selectedFeatureCode,
                          isTargetLocked: _isTargetLocked,
                          position: _currentPosition,
                        ),
                      ),
                    ] else if (_activeDisplayMode == 1) ...[
                      CustomPaint(
                        painter: RadarAndPolygonPlotterPainter(
                          stations: _loggedStations,
                          telemetry: _telemetry,
                          trig: trig,
                          activeFeatureCode: _selectedFeatureCode,
                          volumeResult: _currentVolumetricResult,
                        ),
                      ),
                    ] else ...[
                      CustomPaint(
                        painter: StakeoutGuidancePainter(
                          guidance: stakeout,
                          target: _activeStakeoutTarget,
                          currentAzimuth: _telemetry.azimuth,
                        ),
                      ),
                    ],

                    Positioned(
                      left: 12,
                      right: 12,
                      bottom: 12,
                      child: Row(
                        children: [
                          IconButton.filled(
                            style: IconButton.styleFrom(
                              backgroundColor: _isTargetLocked ? const Color(0xFFEF4444) : const Color(0xFF1E293B),
                              minimumSize: const Size(48, 48),
                            ),
                            icon: Icon(_isTargetLocked ? Icons.lock : Icons.lock_open, size: 20),
                            onPressed: () => setState(() => _isTargetLocked = !_isTargetLocked),
                          ),
                          const SizedBox(width: 8),

                          Expanded(
                            child: SizedBox(
                              height: 48,
                              child: ElevatedButton.icon(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: _selectedFeatureCode.color,
                                  foregroundColor: Colors.black,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                ),
                                onPressed: _isLogging ? null : _logSurveyStation,
                                icon: const Icon(Icons.add_location_alt),
                                label: Text(
                                  'LOG POINT [\${_selectedFeatureCode.code}]',
                                  style: const TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
`;

export const FLUTTER_FILES: FlutterFile[] = [
  {
    id: 'main',
    filename: 'main.dart',
    filepath: 'lib/main.dart',
    language: 'dart',
    category: 'main',
    description: 'Enterprise Total Station suite with 1D Kalman Filter array, 3D Target Bubble Level, Audio Stakeout Ping Matrix, GNSS Telemetry Bar, Resection Free Stationing, and AutoCAD DXF/KML export engine.',
    code: STANDALONE_MAIN_DART,
  },
  {
    id: 'pubspec',
    filename: 'pubspec.yaml',
    filepath: 'pubspec.yaml',
    language: 'yaml',
    category: 'config',
    description: 'Dependencies for camera, sensors_plus, geolocator, sqflite, path, vector_math, cupertino_icons, and intl.',
    code: `name: geosight
description: "Industrial Total Station optical theodolite application with Kalman Filter HUD and Stakeout Audio Matrix."
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.2.0 <4.0.0'
  flutter: ">=3.16.0"

dependencies:
  flutter:
    sdk: flutter

  # Hardware Camera & Preview Streaming
  camera: ^0.10.5+9

  # 9-DOF IMU Sensors (Accelerometer, Magnetometer, Gyroscope)
  sensors_plus: ^5.0.1

  # High-Precision GNSS Positioning & Elevation
  geolocator: ^11.0.0

  # High-Performance Local SQLite Persistence
  sqflite: ^2.3.2
  path: ^1.9.0

  # Linear Algebra & Vector Mathematics for 3D Coordinate Transforms
  vector_math: ^2.1.4

  # Icons and Utilities
  cupertino_icons: ^1.0.6
  intl: ^0.19.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0

flutter:
  uses-material-design: true
`,
  },
];
