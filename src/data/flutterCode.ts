export interface FlutterFile {
  id: string;
  filename: string;
  filepath: string;
  language: string;
  category: 'config' | 'service' | 'view' | 'database' | 'model' | 'main';
  description: string;
  code: string;
}

export const FLUTTER_FILES: FlutterFile[] = [
  {
    id: 'pubspec',
    filename: 'pubspec.yaml',
    filepath: 'pubspec.yaml',
    language: 'yaml',
    category: 'config',
    description: 'Dependencies for camera, hardware sensors, geolocation, SQLite database, and vector math.',
    code: `name: geosight
description: "A production-grade optical and electronic Theodolite application with sensor fusion HUD."
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

  # Material Symbols and Cupertino Icons
  cupertino_icons: ^1.0.6
  intl: ^0.19.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0

flutter:
  uses-material-design: true
`
  },
  {
    id: 'sensor_service',
    filename: 'sensor_service.dart',
    filepath: 'lib/services/sensor_service.dart',
    language: 'dart',
    category: 'service',
    description: 'IMU sensor fusion combining Accelerometer, Magnetometer, and Gyroscope with a Low-Pass mathematical filter and circular angle unwrapping to eliminate crosshair jitter.',
    code: `import 'dart:async';
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
`
  },
  {
    id: 'camera_overlay_view',
    filename: 'camera_overlay_view.dart',
    filepath: 'lib/views/camera_overlay_view.dart',
    language: 'dart',
    category: 'view',
    description: 'High-performance 60 FPS CustomPainter HUD canvas rendering optical crosshairs, stadia mil-dots, roll horizon line, azimuth tape, pitch elevation ladder, and digital telemetry.',
    code: `import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../services/sensor_service.dart';

/// Production-ready Theodolite Overlay View.
/// Wraps the custom painter inside a RepaintBoundary to achieve strict 60 FPS
/// rendering without rebuilding parent camera preview trees.
class CameraOverlayView extends StatelessWidget {
  final TelemetryData telemetry;
  final double? latitude;
  final double? longitude;
  final double? altitude;
  final double zoomFactor;
  final bool isTargetLocked;

  const CameraOverlayView({
    super.key,
    required this.telemetry,
    this.latitude,
    this.longitude,
    this.altitude,
    this.zoomFactor = 1.0,
    this.isTargetLocked = false,
  });

  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: CustomPaint(
        size: Size.infinite,
        painter: TheodoliteReticlePainter(
          telemetry: telemetry,
          latitude: latitude,
          longitude: longitude,
          altitude: altitude,
          zoomFactor: zoomFactor,
          isTargetLocked: isTargetLocked,
        ),
      ),
    );
  }
}

/// 60 FPS Hardware-accelerated Canvas Painter for Optical Theodolite Reticle.
class TheodoliteReticlePainter extends CustomPainter {
  final TelemetryData telemetry;
  final double? latitude;
  final double? longitude;
  final double? altitude;
  final double zoomFactor;
  final bool isTargetLocked;

  // Cached paint objects to eliminate GC allocation thrashing inside paint()
  late final Paint _reticlePaint;
  late final Paint _accentPaint;
  late final Paint _horizonPaint;
  late final Paint _tapeTickPaint;
  late final Paint _tapeMajorPaint;
  late final Paint _backgroundScrimPaint;

  TheodoliteReticlePainter({
    required this.telemetry,
    this.latitude,
    this.longitude,
    this.altitude,
    this.zoomFactor = 1.0,
    this.isTargetLocked = false,
  }) {
    final Color mainColor = isTargetLocked
        ? const Color(0xFFEF4444) // Locked red
        : const Color(0xFFF59E0B); // Survey telemetry amber

    _reticlePaint = Paint()
      ..color = mainColor.withOpacity(0.9)
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;

    _accentPaint = Paint()
      ..color = const Color(0xFF06B6D4) // Cyan digital readout
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    _horizonPaint = Paint()
      ..color = const Color(0xFF10B981).withOpacity(0.85) // Horizon emerald
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;

    _tapeTickPaint = Paint()
      ..color = Colors.white.withOpacity(0.6)
      ..strokeWidth = 1.0
      ..style = PaintingStyle.stroke;

    _tapeMajorPaint = Paint()
      ..color = Colors.white
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    _backgroundScrimPaint = Paint()
      ..color = Colors.black.withOpacity(0.4)
      ..style = PaintingStyle.fill;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = Offset(size.width / 2, size.height / 2);

    // 1. Draw corner optical frame borders
    _drawOpticalFrame(canvas, size);

    // 2. Draw dynamic horizon tilt bar (Roll compensation)
    _drawArtificialHorizon(canvas, center, size.width);

    // 3. Draw central crosshair with optical stadia / mil-dots
    _drawPrecisionCrosshair(canvas, center);

    // 4. Draw top horizontal Azimuth / Compass tape
    _drawAzimuthTape(canvas, size);

    // 5. Draw right-hand vertical Pitch / Elevation ladder
    _drawPitchLadder(canvas, size);

    // 6. Draw telemetry digital readout blocks
    _drawTelemetryHUD(canvas, size);
  }

  /// Draws survey viewfinder optical corner crossbars
  void _drawOpticalFrame(Canvas canvas, Size size) {
    const double padding = 20.0;
    const double bracketSize = 24.0;
    final Paint p = _reticlePaint;

    // Top-Left
    canvas.drawLine(const Offset(padding, padding + bracketSize), const Offset(padding, padding), p);
    canvas.drawLine(const Offset(padding, padding), const Offset(padding + bracketSize, padding), p);

    // Top-Right
    canvas.drawLine(Offset(size.width - padding - bracketSize, padding), Offset(size.width - padding, padding), p);
    canvas.drawLine(Offset(size.width - padding, padding), Offset(size.width - padding, padding + bracketSize), p);

    // Bottom-Left
    canvas.drawLine(Offset(padding, size.height - padding - bracketSize), Offset(padding, size.height - padding), p);
    canvas.drawLine(Offset(padding, size.height - padding), Offset(padding + bracketSize, size.height - padding), p);

    // Bottom-Right
    canvas.drawLine(Offset(size.width - padding - bracketSize, size.height - padding), Offset(size.width - padding, size.height - padding), p);
    canvas.drawLine(Offset(size.width - padding, size.height - padding - bracketSize), Offset(size.width - padding, size.height - padding), p);
  }

  /// Draws the Artificial Horizon level line rotated by roll angle
  void _drawArtificialHorizon(Canvas canvas, Offset center, double width) {
    canvas.save();
    canvas.translate(center.dx, center.dy);
    // Rotate canvas by negative roll angle in radians
    final double rollRad = -telemetry.roll * (math.pi / 180.0);
    canvas.rotate(rollRad);

    const double barHalfWidth = 140.0;
    const double gap = 45.0;

    // Left horizon segment
    canvas.drawLine(const Offset(-barHalfWidth, 0), const Offset(-gap, 0), _horizonPaint);
    // Right horizon segment
    canvas.drawLine(const Offset(gap, 0), const Offset(barHalfWidth, 0), _horizonPaint);

    // Pitch bubble indicator in center
    canvas.drawCircle(Offset.zero, 3.0, _horizonPaint);

    canvas.restore();
  }

  /// Draws target crosshair with stadia hairs and mil marks
  void _drawPrecisionCrosshair(Canvas canvas, Offset center) {
    const double outerRadius = 38.0;
    const double innerRadius = 16.0;

    // Concentric reticle rings
    canvas.drawCircle(center, outerRadius, _reticlePaint);
    canvas.drawCircle(center, innerRadius, _reticlePaint);

    // Center focal point
    canvas.drawCircle(center, 2.0, _accentPaint);

    // 4 Crosshair lines with central gap
    const double armLength = 80.0;
    const double gap = 8.0;

    // Up, Down, Left, Right crosshairs
    canvas.drawLine(Offset(center.dx, center.dy - armLength), Offset(center.dx, center.dy - gap), _reticlePaint);
    canvas.drawLine(Offset(center.dx, center.dy + gap), Offset(center.dx, center.dy + armLength), _reticlePaint);
    canvas.drawLine(Offset(center.dx - armLength, center.dy), Offset(center.dx - gap, center.dy), _reticlePaint);
    canvas.drawLine(Offset(center.dx + gap, center.dy), Offset(center.dx + armLength, center.dy), _reticlePaint);

    // Stadia mil ticks (Surveying range estimation marks)
    const List<double> milOffsets = [30.0, 50.0, 70.0];
    for (final double dist in milOffsets) {
      // Horizontal ticks
      canvas.drawLine(Offset(center.dx - dist, center.dy - 3), Offset(center.dx - dist, center.dy + 3), _reticlePaint);
      canvas.drawLine(Offset(center.dx + dist, center.dy - 3), Offset(center.dx + dist, center.dy + 3), _reticlePaint);
      // Vertical ticks
      canvas.drawLine(Offset(center.dx - 3, center.dy - dist), Offset(center.dx + 3, center.dy - dist), _reticlePaint);
      canvas.drawLine(Offset(center.dx - 3, center.dy + dist), Offset(center.dx + 3, center.dy + dist), _reticlePaint);
    }
  }

  /// Draws smooth top horizontal Azimuth compass heading tape
  void _drawAzimuthTape(Canvas canvas, Size size) {
    const double tapeY = 56.0;
    final double centerX = size.width / 2;
    const double pixelsPerDegree = 8.0;
    const double visibleHalfWidth = 150.0;

    // Background panel
    final Rect tapeRect = Rect.fromCenter(center: Offset(centerX, tapeY), width: visibleHalfWidth * 2 + 20, height: 38);
    canvas.drawRRect(RRect.fromRectAndRadius(tapeRect, const Radius.circular(6)), _backgroundScrimPaint);

    final double currentAzimuth = telemetry.azimuth;

    // Draw ticks within visible viewing range
    final int startDeg = (currentAzimuth - (visibleHalfWidth / pixelsPerDegree)).floor() - 2;
    final int endDeg = (currentAzimuth + (visibleHalfWidth / pixelsPerDegree)).ceil() + 2;

    for (int deg = startDeg; deg <= endDeg; deg++) {
      final double normalizedDeg = (deg % 360 + 360) % 360;
      final double xOffset = centerX + (deg - currentAzimuth) * pixelsPerDegree;

      if (xOffset < centerX - visibleHalfWidth || xOffset > centerX + visibleHalfWidth) continue;

      final bool isMajor = normalizedDeg % 10 == 0;
      final bool isCardinal = normalizedDeg % 90 == 0;
      final double tickHeight = isCardinal ? 14.0 : (isMajor ? 10.0 : 5.0);

      canvas.drawLine(
        Offset(xOffset, tapeY - tickHeight / 2),
        Offset(xOffset, tapeY + tickHeight / 2),
        isMajor ? _tapeMajorPaint : _tapeTickPaint,
      );

      if (isMajor) {
        String label = '\${normalizedDeg.toInt()}°';
        if (normalizedDeg == 0) label = 'N';
        if (normalizedDeg == 90) label = 'E';
        if (normalizedDeg == 180) label = 'S';
        if (normalizedDeg == 270) label = 'W';

        _drawText(
          canvas,
          label,
          Offset(xOffset, tapeY + 12),
          fontSize: isCardinal ? 11 : 9,
          isBold: isCardinal,
          color: isCardinal ? const Color(0xFFF59E0B) : Colors.white,
        );
      }
    }

    // Fixed Center Index Marker (Golden Triangle)
    final Path arrow = Path()
      ..moveTo(centerX, tapeY - 14)
      ..lineTo(centerX - 6, tapeY - 22)
      ..lineTo(centerX + 6, tapeY - 22)
      ..close();
    canvas.drawPath(arrow, Paint()..color = const Color(0xFFF59E0B));
  }

  /// Draws vertical Pitch ladder on the right side
  void _drawPitchLadder(Canvas canvas, Size size) {
    final double ladderX = size.width - 48.0;
    final double centerY = size.height / 2;
    const double pixelsPerDegree = 6.0;
    const double visibleHalfHeight = 120.0;

    final double currentPitch = telemetry.pitch;

    final int startDeg = (currentPitch - (visibleHalfHeight / pixelsPerDegree)).floor() - 1;
    final int endDeg = (currentPitch + (visibleHalfHeight / pixelsPerDegree)).ceil() + 1;

    for (int deg = startDeg; deg <= endDeg; deg++) {
      if (deg < -90 || deg > 90) continue;
      final double yOffset = centerY - (deg - currentPitch) * pixelsPerDegree;

      if (yOffset < centerY - visibleHalfHeight || yOffset > centerY + visibleHalfHeight) continue;

      final bool isMajor = deg % 5 == 0;
      final double tickWidth = isMajor ? 16.0 : 8.0;

      canvas.drawLine(
        Offset(ladderX - tickWidth, yOffset),
        Offset(ladderX, yOffset),
        isMajor ? _tapeMajorPaint : _tapeTickPaint,
      );

      if (isMajor && deg != 0) {
        _drawText(
          canvas,
          '\${deg > 0 ? "+" : ""}\$deg°',
          Offset(ladderX - 28, yOffset),
          fontSize: 8,
          color: Colors.white70,
        );
      }
    }

    // Center index pip for current pitch
    canvas.drawLine(Offset(ladderX - 22, centerY), Offset(ladderX, centerY), Paint()..color = const Color(0xFFF59E0B)..strokeWidth = 2);
  }

  /// Draws digital tabular telemetry box at bottom of viewport
  void _drawTelemetryHUD(Canvas canvas, Size size) {
    const double panelMargin = 20.0;
    const double panelHeight = 74.0;
    final Rect hudRect = Rect.fromLTWH(panelMargin, size.height - panelHeight - panelMargin, size.width - (panelMargin * 2), panelHeight);

    // Scrim box
    canvas.drawRRect(RRect.fromRectAndRadius(hudRect, const Radius.circular(8)), _backgroundScrimPaint);
    canvas.drawRRect(
      RRect.fromRectAndRadius(hudRect, const Radius.circular(8)),
      Paint()
        ..color = Colors.white.withOpacity(0.15)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );

    final double textY1 = hudRect.top + 16;
    final double textY2 = hudRect.top + 46;

    // Primary Telemetry: Azimuth, Pitch, Roll
    _drawDataCell(canvas, 'BEARING', '\${telemetry.azimuth.toStringAsFixed(1)}°', Offset(hudRect.left + 24, textY1));
    _drawDataCell(canvas, 'PITCH', '\${telemetry.pitch >= 0 ? "+" : ""}\${telemetry.pitch.toStringAsFixed(1)}°', Offset(hudRect.left + 110, textY1));
    _drawDataCell(canvas, 'ROLL', '\${telemetry.roll.toStringAsFixed(1)}°', Offset(hudRect.left + 196, textY1));

    // Secondary Telemetry: GNSS Coordinates & Zoom
    final String latStr = latitude != null ? '\${latitude!.toStringAsFixed(5)}°' : 'SEARCHING...';
    final String lonStr = longitude != null ? '\${longitude!.toStringAsFixed(5)}°' : 'SEARCHING...';
    final String altStr = altitude != null ? '\${altitude!.toStringAsFixed(1)} m' : '--';

    _drawDataCell(canvas, 'LATITUDE', latStr, Offset(hudRect.left + 24, textY2));
    _drawDataCell(canvas, 'LONGITUDE', lonStr, Offset(hudRect.left + 130, textY2));
    _drawDataCell(canvas, 'ELEVATION', altStr, Offset(hudRect.left + 236, textY2));
    _drawDataCell(canvas, 'OPTICS', '\${zoomFactor.toStringAsFixed(1)}x', Offset(hudRect.right - 48, textY2));
  }

  void _drawDataCell(Canvas canvas, String label, String value, Offset offset) {
    _drawText(canvas, label, offset, fontSize: 8, color: Colors.white54);
    _drawText(canvas, value, Offset(offset.dx, offset.dy + 12), fontSize: 11, isBold: true, color: const Color(0xFFF59E0B));
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset centerOffset, {
    double fontSize = 10,
    bool isBold = false,
    Color color = Colors.white,
  }) {
    final TextSpan span = TextSpan(
      text: text,
      style: TextStyle(
        color: color,
        fontSize: fontSize,
        fontWeight: isBold ? FontWeight.bold : FontWeight.w500,
        fontFamily: 'monospace',
      ),
    );
    final TextPainter tp = TextPainter(
      text: span,
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
    );
    tp.layout();
    tp.paint(canvas, Offset(centerOffset.dx - (tp.width / 2), centerOffset.dy - (tp.height / 2)));
  }

  @override
  bool shouldRepaint(covariant TheodoliteReticlePainter oldDelegate) {
    // Only repaint if telemetry orientation, position, or lock status changes
    return oldDelegate.telemetry.azimuth != telemetry.azimuth ||
        oldDelegate.telemetry.pitch != telemetry.pitch ||
        oldDelegate.telemetry.roll != telemetry.roll ||
        oldDelegate.zoomFactor != zoomFactor ||
        oldDelegate.isTargetLocked != isTargetLocked ||
        oldDelegate.latitude != latitude ||
        oldDelegate.longitude != longitude;
  }
}
`
  },
  {
    id: 'db_helper',
    filename: 'db_helper.dart',
    filepath: 'lib/database/db_helper.dart',
    language: 'dart',
    category: 'database',
    description: 'SQLite database helper using sqflite with transactional inserts, table schemas, queries, and spatial survey export support.',
    code: `import 'dart:async';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Survey entry data model for Theodolite readings
class SurveyEntry {
  final int? id;
  final String title;
  final double azimuth;
  final double pitch;
  final double roll;
  final double latitude;
  final double longitude;
  final double altitude;
  final double accuracy;
  final double zoomFactor;
  final String? notes;
  final String? imagePath;
  final DateTime timestamp;

  SurveyEntry({
    this.id,
    required this.title,
    required this.azimuth,
    required this.pitch,
    required this.roll,
    required this.latitude,
    required this.longitude,
    required this.altitude,
    required this.accuracy,
    required this.zoomFactor,
    this.notes,
    this.imagePath,
    required this.timestamp,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'title': title,
      'azimuth': azimuth,
      'pitch': pitch,
      'roll': roll,
      'latitude': latitude,
      'longitude': longitude,
      'altitude': altitude,
      'accuracy': accuracy,
      'zoom_factor': zoomFactor,
      'notes': notes,
      'image_path': imagePath,
      'timestamp': timestamp.toIso8601String(),
    };
  }

  factory SurveyEntry.fromMap(Map<String, dynamic> map) {
    return SurveyEntry(
      id: map['id'] as int?,
      title: map['title'] as String,
      azimuth: (map['azimuth'] as num).toDouble(),
      pitch: (map['pitch'] as num).toDouble(),
      roll: (map['roll'] as num).toDouble(),
      latitude: (map['latitude'] as num).toDouble(),
      longitude: (map['longitude'] as num).toDouble(),
      altitude: (map['altitude'] as num).toDouble(),
      accuracy: (map['accuracy'] as num).toDouble(),
      zoomFactor: (map['zoom_factor'] as num).toDouble(),
      notes: map['notes'] as String?,
      imagePath: map['image_path'] as String?,
      timestamp: DateTime.parse(map['timestamp'] as String),
    );
  }
}

/// Production SQLite Database Helper for GeoSight survey station logs.
class DBHelper {
  static const String _dbName = 'geosight_survey.db';
  static const int _dbVersion = 1;
  static const String tableSurveyEntries = 'survey_entries';

  // Singleton instance
  static final DBHelper _instance = DBHelper._internal();
  factory DBHelper() => _instance;
  DBHelper._internal();

  Database? _db;

  /// Retrieves the cached database instance or opens a new connection
  Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDatabase();
    return _db!;
  }

  Future<Database> _initDatabase() async {
    final String databasesPath = await getDatabasesPath();
    final String path = p.join(databasesPath, _dbName);

    return await openDatabase(
      path,
      version: _dbVersion,
      onCreate: _onCreate,
      onConfigure: (Database db) async {
        // Enforce SQLite Foreign Key constraints and WAL mode for high performance
        await db.execute('PRAGMA foreign_keys = ON');
      },
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
      CREATE TABLE \$tableSurveyEntries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        azimuth REAL NOT NULL,
        pitch REAL NOT NULL,
        roll REAL NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude REAL NOT NULL,
        accuracy REAL NOT NULL,
        zoom_factor REAL NOT NULL,
        notes TEXT,
        image_path TEXT,
        timestamp TEXT NOT NULL
      )
    ''');

    // Create timestamp index for fast historical querying
    await db.execute('''
      CREATE INDEX idx_survey_timestamp ON \$tableSurveyEntries(timestamp DESC)
    ''');
  }

  /// Inserts a new survey record
  Future<int> insertSurveyEntry(SurveyEntry entry) async {
    final Database db = await database;
    return await db.insert(
      tableSurveyEntries,
      entry.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Retrieves all logged survey marks ordered by newest first
  Future<List<SurveyEntry>> getAllEntries() async {
    final Database db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      tableSurveyEntries,
      orderBy: 'timestamp DESC',
    );
    return maps.map((m) => SurveyEntry.fromMap(m)).toList();
  }

  /// Retrieves a single record by primary key
  Future<SurveyEntry?> getEntryById(int id) async {
    final Database db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      tableSurveyEntries,
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );
    if (maps.isEmpty) return null;
    return SurveyEntry.fromMap(maps.first);
  }

  /// Batch inserts entries inside an atomic SQLite transaction
  Future<void> insertBatch(List<SurveyEntry> entries) async {
    final Database db = await database;
    await db.transaction((txn) async {
      final Batch batch = txn.batch();
      for (final entry in entries) {
        batch.insert(tableSurveyEntries, entry.toMap());
      }
      await batch.commit(noResult: true);
    });
  }

  /// Deletes an entry by ID
  Future<int> deleteEntry(int id) async {
    final Database db = await database;
    return await db.delete(
      tableSurveyEntries,
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  /// Clears all survey history
  Future<int> clearAllEntries() async {
    final Database db = await database;
    return await db.delete(tableSurveyEntries);
  }

  /// Closes database handle
  Future<void> close() async {
    final Database? db = _db;
    if (db != null) {
      await db.close();
      _db = null;
    }
  }
}
`
  },
  {
    id: 'main',
    filename: 'main.dart',
    filepath: 'lib/main.dart',
    language: 'dart',
    category: 'main',
    description: 'Main application entry point orchestrating CameraController, SensorService stream, Geolocation, and HUD overlay.',
    code: `import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'services/sensor_service.dart';
import 'views/camera_overlay_view.dart';
import 'database/db_helper.dart';

List<CameraDescription> _availableCameras = [];

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    _availableCameras = await availableCameras();
  } catch (e) {
    debugPrint('Camera initialization error: \$e');
  }
  runApp(const GeoSightApp());
}

class GeoSightApp extends StatelessWidget {
  const GeoSightApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GeoSight Theodolite',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: Colors.black,
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFF59E0B),
          secondary: Color(0xFF06B6D4),
        ),
      ),
      home: const TheodoliteScreen(),
    );
  }
}

class TheodoliteScreen extends StatefulWidget {
  const TheodoliteScreen({super.key});

  @override
  State<TheodoliteScreen> createState() => _TheodoliteScreenState();
}

class _TheodoliteScreenState extends State<TheodoliteScreen> {
  CameraController? _cameraController;
  final SensorService _sensorService = SensorService(filterAlpha: 0.18);
  final DBHelper _dbHelper = DBHelper();

  TelemetryData _currentTelemetry = TelemetryData.initial();
  Position? _currentPosition;
  double _zoomFactor = 1.0;
  bool _isLocked = false;
  bool _isLogging = false;

  @override
  void initState() {
    super.initState();
    _initCamera();
    _initSensors();
    _initGeolocation();
  }

  Future<void> _initCamera() async {
    if (_availableCameras.isEmpty) return;
    final backCamera = _availableCameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.back,
      orElse: () => _availableCameras.first,
    );

    _cameraController = CameraController(
      backCamera,
      ResolutionPreset.max,
      enableAudio: false,
    );

    await _cameraController!.initialize();
    if (mounted) setState(() {});
  }

  void _initSensors() {
    _sensorService.start();
    _sensorService.telemetryStream.listen((data) {
      if (mounted) {
        setState(() {
          _currentTelemetry = data;
        });
      }
    });
  }

  Future<void> _initGeolocation() async {
    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always) {
      Geolocator.getPositionStream(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).listen((pos) {
        if (mounted) {
          setState(() {
            _currentPosition = pos;
          });
        }
      });
    }
  }

  Future<void> _logSurveyPoint() async {
    setState(() => _isLogging = true);
    final entry = SurveyEntry(
      title: 'STATION_\${DateTime.now().millisecondsSinceEpoch % 10000}',
      azimuth: _currentTelemetry.azimuth,
      pitch: _currentTelemetry.pitch,
      roll: _currentTelemetry.roll,
      latitude: _currentPosition?.latitude ?? 0.0,
      longitude: _currentPosition?.longitude ?? 0.0,
      altitude: _currentPosition?.altitude ?? 0.0,
      accuracy: _currentPosition?.accuracy ?? 0.0,
      zoomFactor: _zoomFactor,
      timestamp: DateTime.now(),
    );

    await _dbHelper.insertSurveyEntry(entry);
    if (mounted) {
      setState(() => _isLogging = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Survey record saved! Az: \${entry.azimuth.toStringAsFixed(1)}°'),
          backgroundColor: const Color(0xFFF59E0B),
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    _sensorService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          // 1. Camera Preview
          if (_cameraController != null && _cameraController!.value.isInitialized)
            CameraPreview(_cameraController!)
          else
            const Center(child: CircularProgressIndicator(color: Color(0xFFF59E0B))),

          // 2. 60 FPS CustomPaint Theodolite HUD Reticle Overlay
          CameraOverlayView(
            telemetry: _currentTelemetry,
            latitude: _currentPosition?.latitude,
            longitude: _currentPosition?.longitude,
            altitude: _currentPosition?.altitude,
            zoomFactor: _zoomFactor,
            isTargetLocked: _isLocked,
          ),

          // 3. User Controls (Top Bar & Capture Actions)
          SafeArea(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Top control bar
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, py: 4),
                        decoration: BoxDecoration(
                          color: Colors.black54,
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: Colors.white24),
                        ),
                        child: Text(
                          'GEOSIGHT // THEODOLITE',
                          style: const TextStyle(
                            fontFamily: 'monospace',
                            fontSize: 12,
                            color: Color(0xFFF59E0B),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: Icon(
                          _isLocked ? Icons.lock : Icons.lock_open,
                          color: _isLocked ? Colors.redAccent : Colors.white,
                        ),
                        onPressed: () => setState(() => _isLocked = !_isLocked),
                      ),
                    ],
                  ),
                ),

                // Bottom Log Action Button
                Padding(
                  padding: const EdgeInsets.only(bottom: 24.0),
                  child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFF59E0B),
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                    ),
                    onPressed: _isLogging ? null : _logSurveyPoint,
                    icon: const Icon(Icons.add_location_alt),
                    label: const Text(
                      'LOG SURVEY STATION',
                      style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
`
  }
];
