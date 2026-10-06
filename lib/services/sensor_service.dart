import 'dart:async';
import 'dart:math' as math;
import 'package:sensors_plus/sensors_plus.dart';
import 'package:vector_math/vector_math_64.dart' as vmath;

/// Represents fully filtered, tilt-compensated geospatial orientation telemetry.
class TelemetryData {
  /// Azimuth (Bearing) in degrees: 0.0 to 359.99 (0 = North, 90 = East)
  final double azimuth;

  /// Pitch (Elevation angle) in degrees: -90.0 (Zenith/Up) to +90.0 (Nadir/Down)
  final double pitch;

  /// Roll (Horizon bank angle) in degrees: -180.0 to +180.0
  final double roll;

  /// Raw sensor jitter magnitude (delta variance between raw & filtered)
  final double jitterDelta;

  /// Timestamp when measurement was processed
  final DateTime timestamp;

  const TelemetryData({
    required this.azimuth,
    required this.pitch,
    required this.roll,
    required this.jitterDelta,
    required this.timestamp,
  });

  factory TelemetryData.initial() => TelemetryData(
        azimuth: 0.0,
        pitch: 0.0,
        roll: 0.0,
        jitterDelta: 0.0,
        timestamp: DateTime.now(),
      );
}

/// Production sensor fusion service.
/// Fuses Accelerometer and Magnetometer vectors using a 3D orthogonal rotation
/// matrix with tilt compensation, smoothed by a Low-Pass Exponential Moving
/// Average (EMA) filter with circular angular distance handling.
class SensorService {
  // Smoothing factor alpha in range (0.0, 1.0].
  // Lower alpha = smoother/less jitter, slight lag.
  // Higher alpha = instant response, higher micro-jitter.
  // 0.15 - 0.20 is the sweet spot for hand-held field surveying.
  double _alpha;

  // Stream controller broadcasting 60Hz filtered telemetry
  final StreamController<TelemetryData> _telemetryController =
      StreamController<TelemetryData>.broadcast();

  Stream<TelemetryData> get telemetryStream => _telemetryController.stream;

  // Internal raw vector buffers
  vmath.Vector3 _accel = vmath.Vector3.zero();
  vmath.Vector3 _mag = vmath.Vector3.zero();

  // Low-Pass filtered state vectors
  vmath.Vector3 _filteredAccel = vmath.Vector3.zero();
  vmath.Vector3 _filteredMag = vmath.Vector3.zero();

  // Smoothed Euler outputs
  double _filteredAzimuth = 0.0;
  double _filteredPitch = 0.0;
  double _filteredRoll = 0.0;

  bool _isInitialized = false;

  // Sensor subscriptions
  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<MagnetometerEvent>? _magSub;

  SensorService({double filterAlpha = 0.18}) : _alpha = filterAlpha;

  double get alpha => _alpha;
  set alpha(double value) {
    _alpha = value.clamp(0.01, 1.0);
  }

  /// Starts listening to device IMU sensors.
  void start() {
    // 1. Accelerometer subscription (gravitational orientation)
    _accelSub = accelerometerEvents.listen((AccelerometerEvent event) {
      _processAccelerometer(vmath.Vector3(event.x, event.y, event.z));
    });

    // 2. Magnetometer subscription (geomagnetic field direction)
    _magSub = magnetometerEvents.listen((MagnetometerEvent event) {
      _processMagnetometer(vmath.Vector3(event.x, event.y, event.z));
    });
  }

  /// Stops all active subscriptions to prevent memory leaks.
  void stop() {
    _accelSub?.cancel();
    _magSub?.cancel();
    _accelSub = null;
    _magSub = null;
  }

  void dispose() {
    stop();
    _telemetryController.close();
  }

  /// Mathematical 3D Vector Low-Pass Filter:
  /// V_filtered(t) = alpha * V_raw(t) + (1 - alpha) * V_filtered(t - 1)
  vmath.Vector3 _applyLowPassVector(
      vmath.Vector3 current, vmath.Vector3 previous, double alpha) {
    return vmath.Vector3(
      alpha * current.x + (1.0 - alpha) * previous.x,
      alpha * current.y + (1.0 - alpha) * previous.y,
      alpha * current.z + (1.0 - alpha) * previous.z,
    );
  }

  /// Circular Angular Low-Pass Filter:
  /// Corrects for discontinuity wrap-around at 0° / 360° boundaries.
  /// Prevents crosshairs from violently rotating 359° when crossing North.
  double _filterAngleCircular(double target, double current, double alpha) {
    // Calculate shortest angular distance delta in range [-180, +180]
    double delta = (target - current + 180.0) % 360.0 - 180.0;
    if (delta < -180.0) {
      delta += 360.0;
    }
    double result = (current + alpha * delta) % 360.0;
    if (result < 0.0) {
      result += 360.0;
    }
    return result;
  }

  /// Linear Low-Pass Filter for non-wrapping axes (Pitch and Roll within bounds).
  double _filterScalar(double target, double current, double alpha) {
    return current + alpha * (target - current);
  }

  void _processAccelerometer(vmath.Vector3 raw) {
    _accel = raw;
    if (!_isInitialized) {
      _filteredAccel = raw;
    } else {
      _filteredAccel = _applyLowPassVector(raw, _filteredAccel, _alpha);
    }
    _computeAttitude();
  }

  void _processMagnetometer(vmath.Vector3 raw) {
    _mag = raw;
    if (!_isInitialized) {
      _filteredMag = raw;
    } else {
      _filteredMag = _applyLowPassVector(raw, _filteredMag, _alpha);
    }
    _computeAttitude();
  }

  /// Computes tilt-compensated orientation matrix and extracts Euler angles.
  void _computeAttitude() {
    if (_filteredAccel.length2 == 0 || _filteredMag.length2 == 0) return;

    // Normalize gravity vector
    final vmath.Vector3 g = _filteredAccel.normalized();
    final vmath.Vector3 m = _filteredMag.normalized();

    // Cross product H = E x G (East vector, orthogonal to both gravity and magnetic field)
    final vmath.Vector3 e = m.cross(g);
    if (e.length2 == 0) return;
    final vmath.Vector3 east = e.normalized();

    // Cross product M = G x H (North vector, orthogonal to gravity and East)
    final vmath.Vector3 north = g.cross(east).normalized();

    // Calculate Pitch (elevation) and Roll (tilt) in radians
    // g.x, g.y, g.z correspond to device axes
    final double rawPitchRad = math.atan2(g.y, math.sqrt(g.x * g.x + g.z * g.z));
    final double rawRollRad = math.atan2(-g.x, g.z);

    // Compute tilt-compensated Azimuth using transformed North/East components
    // in the horizontal plane:
    final double rawAzimuthRad = math.atan2(east.x, north.x);

    // Convert to degrees
    double rawAzimuthDeg = vmath.degrees(rawAzimuthRad);
    if (rawAzimuthDeg < 0.0) {
      rawAzimuthDeg += 360.0;
    }
    final double rawPitchDeg = vmath.degrees(rawPitchRad);
    final double rawRollDeg = vmath.degrees(rawRollRad);

    if (!_isInitialized) {
      _filteredAzimuth = rawAzimuthDeg;
      _filteredPitch = rawPitchDeg;
      _filteredRoll = rawRollDeg;
      _isInitialized = true;
    } else {
      _filteredAzimuth = _filterAngleCircular(rawAzimuthDeg, _filteredAzimuth, _alpha);
      _filteredPitch = _filterScalar(rawPitchDeg, _filteredPitch, _alpha);
      _filteredRoll = _filterScalar(rawRollDeg, _filteredRoll, _alpha);
    }

    final double jitterDelta = (rawAzimuthDeg - _filteredAzimuth).abs() +
        (rawPitchDeg - _filteredPitch).abs();

    _telemetryController.add(TelemetryData(
      azimuth: _filteredAzimuth,
      pitch: _filteredPitch,
      roll: _filteredRoll,
      jitterDelta: jitterDelta,
      timestamp: DateTime.now(),
    ));
  }
}
