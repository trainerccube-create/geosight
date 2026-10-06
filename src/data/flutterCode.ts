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
import 'package:camera/camera.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import 'package:vector_math/vector_math_64.dart' as vmath;

/// ============================================================================
/// 1. DATA MODELS & TOTAL STATION TRIGONOMETRY
/// ============================================================================

/// Represents tilt-compensated geospatial orientation telemetry.
class TelemetryData {
  final double azimuth;      // 0.0 to 359.99 degrees (North = 0, East = 90)
  final double pitch;        // -90.0 to +90.0 degrees (Elevation angle)
  final double roll;         // -180.0 to +180.0 degrees (Horizon bank angle)
  final double jitterDelta;
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

/// Real-time Total Station Trigonometry Computation Engine
class TotalStationTrig {
  final double baselineDistance; // User-input ground distance in meters (D_base)
  final double pitchAngleDeg;     // Live pitch angle in degrees (theta)

  TotalStationTrig({
    required this.baselineDistance,
    required this.pitchAngleDeg,
  });

  /// Pitch in radians for trigonometric math
  double get pitchRad => pitchAngleDeg * (math.pi / 180.0);

  /// Vertical Distance (VD / Delta Height) using Tangent formula:
  /// VD = Baseline * tan(theta)
  double get verticalDistance => baselineDistance * math.tan(pitchRad);

  /// Horizontal Distance (HD) using Cosine formula:
  /// When aiming at target top from ground baseline, HD = Baseline
  double get horizontalDistance => baselineDistance;

  /// Slope Line-of-Sight Distance (SD) using Cosine formula:
  /// SD = Baseline / cos(theta) = sqrt(HD^2 + VD^2)
  double get slopeDistance {
    final double cosTheta = math.cos(pitchRad).abs();
    if (cosTheta < 0.0001) return baselineDistance;
    return baselineDistance / cosTheta;
  }
}

/// Survey entry data model for SQLite logging
class SurveyEntry {
  final int? id;
  final String title;
  final double azimuth;
  final double pitch;
  final double roll;
  final double baselineDistance;
  final double verticalDistance;
  final double horizontalDistance;
  final double slopeDistance;
  final double latitude;
  final double longitude;
  final double altitude;
  final double accuracy;
  final double zoomFactor;
  final String? notes;
  final DateTime timestamp;

  SurveyEntry({
    this.id,
    required this.title,
    required this.azimuth,
    required this.pitch,
    required this.roll,
    required this.baselineDistance,
    required this.verticalDistance,
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
      'azimuth': azimuth,
      'pitch': pitch,
      'roll': roll,
      'baseline_dist': baselineDistance,
      'vertical_dist': verticalDistance,
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

  factory SurveyEntry.fromMap(Map<String, dynamic> map) {
    return SurveyEntry(
      id: map['id'] as int?,
      title: map['title'] as String,
      azimuth: (map['azimuth'] as num).toDouble(),
      pitch: (map['pitch'] as num).toDouble(),
      roll: (map['roll'] as num).toDouble(),
      baselineDistance: (map['baseline_dist'] as num?)?.toDouble() ?? 0.0,
      verticalDistance: (map['vertical_dist'] as num?)?.toDouble() ?? 0.0,
      horizontalDistance: (map['horizontal_dist'] as num?)?.toDouble() ?? 0.0,
      slopeDistance: (map['slope_dist'] as num?)?.toDouble() ?? 0.0,
      latitude: (map['latitude'] as num).toDouble(),
      longitude: (map['longitude'] as num).toDouble(),
      altitude: (map['altitude'] as num).toDouble(),
      accuracy: (map['accuracy'] as num).toDouble(),
      zoomFactor: (map['zoom_factor'] as num).toDouble(),
      notes: map['notes'] as String?,
      timestamp: DateTime.parse(map['timestamp'] as String),
    );
  }
}

/// ============================================================================
/// 2. SQLITE LOCAL DATABASE LAYER
/// ============================================================================

class DBHelper {
  static const String _dbName = 'geosight_total_station.db';
  static const int _dbVersion = 1;
  static const String tableSurveyEntries = 'survey_entries';

  static final DBHelper _instance = DBHelper._internal();
  factory DBHelper() => _instance;
  DBHelper._internal();

  Database? _db;

  Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDatabase();
    return _db!;
  }

  Future<Database> _initDatabase() async {
    final String databasesPath = await getDatabasesPath();
    final String dbPath = p.join(databasesPath, _dbName);

    return await openDatabase(
      dbPath,
      version: _dbVersion,
      onCreate: (Database db, int version) async {
        await db.execute('''
          CREATE TABLE \$tableSurveyEntries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            azimuth REAL NOT NULL,
            pitch REAL NOT NULL,
            roll REAL NOT NULL,
            baseline_dist REAL NOT NULL,
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
        await db.execute(
          'CREATE INDEX idx_survey_time ON \$tableSurveyEntries(timestamp DESC)',
        );
      },
    );
  }

  Future<int> insertSurveyEntry(SurveyEntry entry) async {
    final Database db = await database;
    return await db.insert(
      tableSurveyEntries,
      entry.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<SurveyEntry>> getAllEntries() async {
    final Database db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      tableSurveyEntries,
      orderBy: 'timestamp DESC',
    );
    return maps.map((m) => SurveyEntry.fromMap(m)).toList();
  }
}

/// ============================================================================
/// 3. IMU SENSOR FUSION & LOW-PASS MATHEMATICAL FILTER
/// ============================================================================

class SensorService {
  double _alpha;
  final StreamController<TelemetryData> _telemetryController =
      StreamController<TelemetryData>.broadcast();

  Stream<TelemetryData> get telemetryStream => _telemetryController.stream;

  vmath.Vector3 _filteredAccel = vmath.Vector3.zero();
  vmath.Vector3 _filteredMag = vmath.Vector3.zero();

  double _filteredAzimuth = 0.0;
  double _filteredPitch = 0.0;
  double _filteredRoll = 0.0;
  bool _isInitialized = false;

  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<MagnetometerEvent>? _magSub;

  SensorService({double filterAlpha = 0.18}) : _alpha = filterAlpha;

  void start() {
    _accelSub = accelerometerEvents.listen((AccelerometerEvent event) {
      _processAccelerometer(vmath.Vector3(event.x, event.y, event.z));
    });
    _magSub = magnetometerEvents.listen((MagnetometerEvent event) {
      _processMagnetometer(vmath.Vector3(event.x, event.y, event.z));
    });
  }

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

  vmath.Vector3 _applyLowPassVector(vmath.Vector3 cur, vmath.Vector3 prev, double a) {
    return vmath.Vector3(
      a * cur.x + (1.0 - a) * prev.x,
      a * cur.y + (1.0 - a) * prev.y,
      a * cur.z + (1.0 - a) * prev.z,
    );
  }

  double _filterAngleCircular(double target, double current, double a) {
    double delta = (target - current + 180.0) % 360.0 - 180.0;
    if (delta < -180.0) delta += 360.0;
    double result = (current + a * delta) % 360.0;
    if (result < 0.0) result += 360.0;
    return result;
  }

  double _filterScalar(double target, double current, double a) {
    return current + a * (target - current);
  }

  void _processAccelerometer(vmath.Vector3 raw) {
    if (!_isInitialized) {
      _filteredAccel = raw;
    } else {
      _filteredAccel = _applyLowPassVector(raw, _filteredAccel, _alpha);
    }
    _computeAttitude();
  }

  void _processMagnetometer(vmath.Vector3 raw) {
    if (!_isInitialized) {
      _filteredMag = raw;
    } else {
      _filteredMag = _applyLowPassVector(raw, _filteredMag, _alpha);
    }
    _computeAttitude();
  }

  void _computeAttitude() {
    if (_filteredAccel.length2 == 0 || _filteredMag.length2 == 0) return;

    final vmath.Vector3 g = _filteredAccel.normalized();
    final vmath.Vector3 m = _filteredMag.normalized();

    // 3D Orthogonal Vector Transformation: East = Mag x Grav, North = Grav x East
    final vmath.Vector3 e = m.cross(g);
    if (e.length2 == 0) return;
    final vmath.Vector3 east = e.normalized();
    final vmath.Vector3 north = g.cross(east).normalized();

    final double rawPitchRad = math.atan2(g.y, math.sqrt(g.x * g.x + g.z * g.z));
    final double rawRollRad = math.atan2(-g.x, g.z);
    final double rawAzimuthRad = math.atan2(east.x, north.x);

    double rawAzDeg = vmath.degrees(rawAzimuthRad);
    if (rawAzDeg < 0.0) rawAzDeg += 360.0;
    final double rawPitchDeg = vmath.degrees(rawPitchRad);
    final double rawRollDeg = vmath.degrees(rawRollRad);

    if (!_isInitialized) {
      _filteredAzimuth = rawAzDeg;
      _filteredPitch = rawPitchDeg;
      _filteredRoll = rawRollDeg;
      _isInitialized = true;
    } else {
      _filteredAzimuth = _filterAngleCircular(rawAzDeg, _filteredAzimuth, _alpha);
      _filteredPitch = _filterScalar(rawPitchDeg, _filteredPitch, _alpha);
      _filteredRoll = _filterScalar(rawRollDeg, _filteredRoll, _alpha);
    }

    final double jitterDelta =
        (rawAzDeg - _filteredAzimuth).abs() + (rawPitchDeg - _filteredPitch).abs();

    _telemetryController.add(TelemetryData(
      azimuth: _filteredAzimuth,
      pitch: _filteredPitch,
      roll: _filteredRoll,
      jitterDelta: jitterDelta,
      timestamp: DateTime.now(),
    ));
  }
}

/// ============================================================================
/// 4. 60 FPS TOTAL STATION RETICLE & TELEMETRY HUD CANVAS
/// ============================================================================

class CameraOverlayView extends StatelessWidget {
  final TelemetryData telemetry;
  final TotalStationTrig totalStation;
  final double? latitude;
  final double? longitude;
  final double? altitude;
  final double zoomFactor;
  final bool isTargetLocked;

  const CameraOverlayView({
    super.key,
    required this.telemetry,
    required this.totalStation,
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
          totalStation: totalStation,
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

class TheodoliteReticlePainter extends CustomPainter {
  final TelemetryData telemetry;
  final TotalStationTrig totalStation;
  final double? latitude;
  final double? longitude;
  final double? altitude;
  final double zoomFactor;
  final bool isTargetLocked;

  late final Paint _reticlePaint;
  late final Paint _accentPaint;
  late final Paint _horizonPaint;
  late final Paint _tapeTickPaint;
  late final Paint _tapeMajorPaint;
  late final Paint _backgroundScrimPaint;
  late final Paint _trigBoxScrimPaint;

  TheodoliteReticlePainter({
    required this.telemetry,
    required this.totalStation,
    this.latitude,
    this.longitude,
    this.altitude,
    this.zoomFactor = 1.0,
    this.isTargetLocked = false,
  }) {
    final Color mainColor = isTargetLocked
        ? const Color(0xFFEF4444) // Locked Red
        : const Color(0xFFF59E0B); // Total Station Amber

    _reticlePaint = Paint()
      ..color = mainColor.withOpacity(0.9)
      ..strokeWidth = 1.3
      ..style = PaintingStyle.stroke;

    _accentPaint = Paint()
      ..color = const Color(0xFF06B6D4) // Laser Cyan
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    _horizonPaint = Paint()
      ..color = const Color(0xFF10B981).withOpacity(0.85) // Horizon Emerald
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;

    _tapeTickPaint = Paint()
      ..color = Colors.white.withOpacity(0.5)
      ..strokeWidth = 1.0
      ..style = PaintingStyle.stroke;

    _tapeMajorPaint = Paint()
      ..color = Colors.white
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;

    _backgroundScrimPaint = Paint()
      ..color = const Color(0xFF0F172A).withOpacity(0.85)
      ..style = PaintingStyle.fill;

    _trigBoxScrimPaint = Paint()
      ..color = const Color(0xFF020617).withOpacity(0.90)
      ..style = PaintingStyle.fill;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = Offset(size.width / 2, size.height / 2);

    // 1. Viewfinder Framing
    _drawOpticalFrame(canvas, size);

    // 2. Artificial Horizon Line (Roll rotation)
    _drawArtificialHorizon(canvas, center);

    // 3. Central Reticle, Crosshairs & Stadia Mil-Ticks
    _drawPrecisionCrosshair(canvas, center);

    // 4. Azimuth Compass Tape (Top)
    _drawAzimuthTape(canvas, size);

    // 5. Pitch Elevation Ladder (Right)
    _drawPitchLadder(canvas, size);

    // 6. TOTAL STATION TRIGONOMETRY HUD (Top-Center / Left)
    _drawTotalStationHUD(canvas, size);

    // 7. Core Geodetic & Telemetry Data Bar (Bottom)
    _drawTelemetryHUD(canvas, size);
  }

  void _drawOpticalFrame(Canvas canvas, Size size) {
    const double pad = 16.0;
    const double len = 22.0;
    final Paint p = _reticlePaint;

    canvas.drawLine(const Offset(pad, pad + len), const Offset(pad, pad), p);
    canvas.drawLine(const Offset(pad, pad), const Offset(pad + len, pad), p);

    canvas.drawLine(Offset(size.width - pad - len, pad), Offset(size.width - pad, pad), p);
    canvas.drawLine(Offset(size.width - pad, pad), Offset(size.width - pad, pad + len), p);

    canvas.drawLine(Offset(pad, size.height - pad - len), Offset(pad, size.height - pad), p);
    canvas.drawLine(Offset(pad, size.height - pad), Offset(pad + len, size.height - pad), p);

    canvas.drawLine(Offset(size.width - pad - len, size.height - pad), Offset(size.width - pad, size.height - pad), p);
    canvas.drawLine(Offset(size.width - pad, size.height - pad), Offset(size.width - pad, size.height - pad - len), p);
  }

  void _drawArtificialHorizon(Canvas canvas, Offset center) {
    canvas.save();
    canvas.translate(center.dx, center.dy);
    final double rollRad = -telemetry.roll * (math.pi / 180.0);
    canvas.rotate(rollRad);

    const double barHalfWidth = 110.0;
    const double gap = 40.0;

    canvas.drawLine(const Offset(-barHalfWidth, 0), const Offset(-gap, 0), _horizonPaint);
    canvas.drawLine(const Offset(gap, 0), const Offset(barHalfWidth, 0), _horizonPaint);
    canvas.drawCircle(Offset.zero, 2.5, _horizonPaint);

    canvas.restore();
  }

  void _drawPrecisionCrosshair(Canvas canvas, Offset center) {
    const double outerRadius = 36.0;
    const double innerRadius = 16.0;

    canvas.drawCircle(center, outerRadius, _reticlePaint);
    canvas.drawCircle(center, innerRadius, _reticlePaint);
    canvas.drawCircle(center, 2.0, _accentPaint);

    const double armLength = 75.0;
    const double gap = 8.0;

    canvas.drawLine(Offset(center.dx, center.dy - armLength), Offset(center.dx, center.dy - gap), _reticlePaint);
    canvas.drawLine(Offset(center.dx, center.dy + gap), Offset(center.dx, center.dy + armLength), _reticlePaint);
    canvas.drawLine(Offset(center.dx - armLength, center.dy), Offset(center.dx - gap, center.dy), _reticlePaint);
    canvas.drawLine(Offset(center.dx + gap, center.dy), Offset(center.dx + armLength, center.dy), _reticlePaint);

    // Stadia mil marks
    const List<double> mils = [28.0, 48.0, 68.0];
    for (final d in mils) {
      canvas.drawLine(Offset(center.dx - d, center.dy - 3), Offset(center.dx - d, center.dy + 3), _reticlePaint);
      canvas.drawLine(Offset(center.dx + d, center.dy - 3), Offset(center.dx + d, center.dy + 3), _reticlePaint);
      canvas.drawLine(Offset(center.dx - 3, center.dy - d), Offset(center.dx + 3, center.dy - d), _reticlePaint);
      canvas.drawLine(Offset(center.dx - 3, center.dy + d), Offset(center.dx + 3, center.dy + d), _reticlePaint);
    }
  }

  void _drawAzimuthTape(Canvas canvas, Size size) {
    const double tapeY = 46.0;
    final double centerX = size.width / 2;
    const double pxPerDeg = 7.0;
    const double visibleHalfWidth = 140.0;

    final Rect tapeRect = Rect.fromCenter(
      center: Offset(centerX, tapeY),
      width: visibleHalfWidth * 2 + 16,
      height: 34,
    );
    canvas.drawRRect(RRect.fromRectAndRadius(tapeRect, const Radius.circular(6)), _backgroundScrimPaint);

    final double curAz = telemetry.azimuth;
    final int startDeg = (curAz - (visibleHalfWidth / pxPerDeg)).floor() - 1;
    final int endDeg = (curAz + (visibleHalfWidth / pxPerDeg)).ceil() + 1;

    for (int deg = startDeg; deg <= endDeg; deg++) {
      final double norm = (deg % 360 + 360) % 360;
      final double x = centerX + (deg - curAz) * pxPerDeg;

      if (x < centerX - visibleHalfWidth || x > centerX + visibleHalfWidth) continue;

      final bool isCard = norm % 90 == 0;
      final bool isMajor = norm % 10 == 0;
      final double tickH = isCard ? 12.0 : (isMajor ? 8.0 : 4.0);

      canvas.drawLine(Offset(x, tapeY - tickH / 2), Offset(x, tapeY + tickH / 2), isMajor ? _tapeMajorPaint : _tapeTickPaint);

      if (isMajor) {
        String label = '\${norm.toInt()}°';
        if (norm == 0) label = 'N';
        if (norm == 90) label = 'E';
        if (norm == 180) label = 'S';
        if (norm == 270) label = 'W';

        _drawText(
          canvas,
          label,
          Offset(x, tapeY + 12),
          fontSize: isCard ? 10 : 8,
          isBold: isCard,
          color: isCard ? const Color(0xFFF59E0B) : Colors.white,
        );
      }
    }

    // Pointer Index
    final Path needle = Path()
      ..moveTo(centerX, tapeY - 14)
      ..lineTo(centerX - 5, tapeY - 20)
      ..lineTo(centerX + 5, tapeY - 20)
      ..close();
    canvas.drawPath(needle, Paint()..color = const Color(0xFFF59E0B));
  }

  void _drawPitchLadder(Canvas canvas, Size size) {
    final double ladderX = size.width - 36.0;
    final double centerY = size.height / 2;
    const double pxPerDeg = 5.5;
    const double visibleHalfHeight = 100.0;

    final double curPitch = telemetry.pitch;
    final int startDeg = (curPitch - (visibleHalfHeight / pxPerDeg)).floor() - 1;
    final int endDeg = (curPitch + (visibleHalfHeight / pxPerDeg)).ceil() + 1;

    for (int deg = startDeg; deg <= endDeg; deg++) {
      if (deg < -90 || deg > 90) continue;
      final double y = centerY - (deg - curPitch) * pxPerDeg;
      if (y < centerY - visibleHalfHeight || y > centerY + visibleHalfHeight) continue;

      final bool isMajor = deg % 5 == 0;
      final double tickW = isMajor ? 14.0 : 6.0;

      canvas.drawLine(Offset(ladderX - tickW, y), Offset(ladderX, y), isMajor ? _tapeMajorPaint : _tapeTickPaint);

      if (isMajor && deg != 0) {
        _drawText(canvas, '\${deg > 0 ? "+" : ""}\$deg°', Offset(ladderX - 22, y), fontSize: 7, color: Colors.white70);
      }
    }

    canvas.drawLine(Offset(ladderX - 18, centerY), Offset(ladderX, centerY), Paint()..color = const Color(0xFFF59E0B)..strokeWidth = 2);
  }

  /// TOTAL STATION TRIGONOMETRY HUD DISPLAY
  /// Renders Baseline Distance, Computed Vertical Distance (VD), and Horizontal Distance (HD)
  void _drawTotalStationHUD(Canvas canvas, Size size) {
    const double top = 92.0;
    const double left = 16.0;
    const double boxWidth = 220.0;
    const double boxHeight = 78.0;

    final Rect boxRect = Rect.fromLTWH(left, top, boxWidth, boxHeight);

    // Box Scrim & Border
    canvas.drawRRect(RRect.fromRectAndRadius(boxRect, const Radius.circular(8)), _trigBoxScrimPaint);
    canvas.drawRRect(
      RRect.fromRectAndRadius(boxRect, const Radius.circular(8)),
      Paint()
        ..color = const Color(0xFF06B6D4).withOpacity(0.5)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );

    // Header Tag
    _drawText(
      canvas,
      'TOTAL STATION ANALYSIS',
      Offset(left + boxWidth / 2, top + 10),
      fontSize: 8,
      isBold: true,
      color: const Color(0xFF06B6D4),
    );

    // Math readout rows
    final String baseStr = '\${totalStation.baselineDistance.toStringAsFixed(2)} m';
    final String vdStr = '\${totalStation.verticalDistance >= 0 ? "+" : ""}\${totalStation.verticalDistance.toStringAsFixed(2)} m';
    final String hdStr = '\${totalStation.horizontalDistance.toStringAsFixed(2)} m';
    final String sdStr = '\${totalStation.slopeDistance.toStringAsFixed(2)} m';

    // Left column: Base & HD
    _drawDataCell(canvas, 'BASE DIST', baseStr, Offset(left + 50, top + 26));
    _drawDataCell(canvas, 'HORIZ (HD)', hdStr, Offset(left + 50, top + 52));

    // Right column: VD (Height) & SD (Slope)
    _drawDataCell(
      canvas,
      'HEIGHT (VD)',
      vdStr,
      Offset(left + 160, top + 26),
      valColor: const Color(0xFF10B981), // Emerald for height
    );
    _drawDataCell(canvas, 'SLOPE (SD)', sdStr, Offset(left + 160, top + 52));
  }

  void _drawTelemetryHUD(Canvas canvas, Size size) {
    const double pad = 12.0;
    const double hudH = 68.0;
    final Rect hudRect = Rect.fromLTWH(pad, size.height - hudH - pad, size.width - (pad * 2), hudH);

    canvas.drawRRect(RRect.fromRectAndRadius(hudRect, const Radius.circular(8)), _backgroundScrimPaint);
    canvas.drawRRect(
      RRect.fromRectAndRadius(hudRect, const Radius.circular(8)),
      Paint()
        ..color = Colors.white.withOpacity(0.15)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1,
    );

    final double y1 = hudRect.top + 16;
    final double y2 = hudRect.top + 44;

    final double col1 = hudRect.left + (hudRect.width * 0.18);
    final double col2 = hudRect.left + (hudRect.width * 0.50);
    final double col3 = hudRect.left + (hudRect.width * 0.82);

    // Row 1: Core Angles
    _drawDataCell(canvas, 'AZIMUTH', '\${telemetry.azimuth.toStringAsFixed(1)}°', Offset(col1, y1));
    _drawDataCell(canvas, 'PITCH', '\${telemetry.pitch >= 0 ? "+" : ""}\${telemetry.pitch.toStringAsFixed(1)}°', Offset(col2, y1));
    _drawDataCell(canvas, 'ROLL', '\${telemetry.roll.toStringAsFixed(1)}°', Offset(col3, y1));

    // Row 2: GNSS & Optics
    final String latStr = latitude != null ? '\${latitude!.toStringAsFixed(5)}°' : '--';
    final String lonStr = longitude != null ? '\${longitude!.toStringAsFixed(5)}°' : '--';

    _drawDataCell(canvas, 'LAT / LON', '\$latStr, \$lonStr', Offset(col1, y2));
    _drawDataCell(canvas, 'ELEVATION', altitude != null ? '\${altitude!.toStringAsFixed(1)} m' : '--', Offset(col2, y2));
    _drawDataCell(canvas, 'OPTICS', '\${zoomFactor.toStringAsFixed(1)}x', Offset(col3, y2));
  }

  void _drawDataCell(Canvas canvas, String label, String value, Offset offset, {Color? valColor}) {
    _drawText(canvas, label, offset, fontSize: 7, color: Colors.white54);
    _drawText(
      canvas,
      value,
      Offset(offset.dx, offset.dy + 12),
      fontSize: 10,
      isBold: true,
      color: valColor ?? const Color(0xFFF59E0B),
    );
  }

  void _drawText(
    Canvas canvas,
    String text,
    Offset center, {
    double fontSize = 9,
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
    tp.paint(canvas, Offset(center.dx - (tp.width / 2), center.dy - (tp.height / 2)));
  }

  @override
  bool shouldRepaint(covariant TheodoliteReticlePainter old) {
    return old.telemetry.azimuth != telemetry.azimuth ||
        old.telemetry.pitch != telemetry.pitch ||
        old.telemetry.roll != telemetry.roll ||
        old.totalStation.baselineDistance != totalStation.baselineDistance ||
        old.zoomFactor != zoomFactor ||
        old.isTargetLocked != isTargetLocked;
  }
}

/// ============================================================================
/// 5. MAIN TOTAL STATION APPLICATION & ONBOARDING TUTORIAL
/// ============================================================================

List<CameraDescription> _availableCameras = [];

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    _availableCameras = await availableCameras();
  } catch (e) {
    debugPrint('Camera initialization error: \$e');
  }
  runApp(const TotalStationApp());
}

class TotalStationApp extends StatelessWidget {
  const TotalStationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GeoSight Total Station',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: Colors.black,
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFF59E0B),
          secondary: Color(0xFF06B6D4),
        ),
      ),
      home: const TotalStationScreen(),
    );
  }
}

class TotalStationScreen extends StatefulWidget {
  const TotalStationScreen({super.key});

  @override
  State<TotalStationScreen> createState() => _TotalStationScreenState();
}

class _TotalStationScreenState extends State<TotalStationScreen> {
  CameraController? _cameraController;
  final SensorService _sensorService = SensorService(filterAlpha: 0.18);
  final DBHelper _dbHelper = DBHelper();

  TelemetryData _currentTelemetry = TelemetryData.initial();
  Position? _currentPosition;

  // Total Station Ground Baseline (Default 25.0 meters)
  double _baselineDistance = 25.0;
  double _zoomFactor = 1.0;
  bool _isLocked = false;
  bool _isLogging = false;

  @override
  void initState() {
    super.initState();
    _initCamera();
    _initSensors();
    _initGeolocation();

    // REQUIREMENT 3: First-Time User Tutorial triggers on boot via post-frame callback
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _showFirstTimeTutorialDialog();
    });
  }

  Future<void> _initCamera() async {
    if (_availableCameras.isEmpty) return;
    final backCam = _availableCameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.back,
      orElse: () => _availableCameras.first,
    );

    _cameraController = CameraController(
      backCam,
      ResolutionPreset.max,
      enableAudio: false,
    );
    await _cameraController!.initialize();
    if (mounted) setState(() {});
  }

  void _initSensors() {
    _sensorService.start();
    _sensorService.telemetryStream.listen((data) {
      if (mounted) setState(() => _currentTelemetry = data);
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
        if (mounted) setState(() => _currentPosition = pos);
      });
    }
  }

  /// REQUIREMENT 3: Automatic Onboarding Dialog Popup
  void _showFirstTimeTutorialDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext ctx) {
        return AlertDialog(
          backgroundColor: const Color(0xFF0F172A),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFFF59E0B), width: 1.2),
          ),
          title: Row(
            children: const [
              Icon(Icons.architecture, color: Color(0xFFF59E0B)),
              SizedBox(width: 8),
              Text(
                'Total Station Field Guide',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Welcome to GeoSight Total Station! Follow these 4 quick steps to measure elevation heights and coordinates:',
                  style: TextStyle(fontSize: 12, color: Colors.white70),
                ),
                const SizedBox(height: 14),
                _buildTutorialStep(
                  '1. Align Optical Crosshairs',
                  'Aim the center optical reticle and stadia lines directly at the top or benchmark of your target feature.',
                  Icons.gps_fixed,
                ),
                _buildTutorialStep(
                  '2. Set Baseline Ground Distance',
                  'Tap "EDIT BASE DIST" to input your tape or laser-measured horizontal distance to the target base (e.g. 25.0 m).',
                  Icons.straighten,
                ),
                _buildTutorialStep(
                  '3. Read Live Trigonometric Heights',
                  'The HUD computes Vertical Distance (VD = Base * tan(pitch)) and Slope Distance (SD = Base / cos(pitch)) in real time at 60 FPS.',
                  Icons.calculate,
                ),
                _buildTutorialStep(
                  '4. Log Station Record',
                  'Tap "LOG TOTAL STATION MARK" to record full angles, heights, GNSS coordinates, and timestamps to the local SQLite database.',
                  Icons.save,
                ),
              ],
            ),
          ),
          actions: [
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFFF59E0B),
                foregroundColor: Colors.black,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              ),
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('START SURVEYING', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  Widget _buildTutorialStep(String title, String desc, IconData icon) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: const Color(0xFF06B6D4).withOpacity(0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Icon(icon, size: 16, color: const Color(0xFF06B6D4)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                ),
                const SizedBox(height: 2),
                Text(desc, style: const TextStyle(fontSize: 11, color: Colors.white60)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// REQUIREMENT 4: Interactive Baseline Distance Input Dialog
  void _showBaselineInputDialog() {
    final controller = TextEditingController(text: _baselineDistance.toStringAsFixed(1));
    showDialog(
      context: context,
      builder: (BuildContext ctx) {
        return AlertDialog(
          backgroundColor: const Color(0xFF0F172A),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
            side: const BorderSide(color: Color(0xFF06B6D4)),
          ),
          title: const Text(
            'Target Baseline Ground Distance',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.white),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Enter measured horizontal baseline distance from station to target (meters):',
                style: TextStyle(fontSize: 12, color: Colors.white70),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                autofocus: true,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: const TextStyle(fontFamily: 'monospace', fontSize: 18, color: Color(0xFFF59E0B)),
                decoration: const InputDecoration(
                  suffixText: 'meters',
                  suffixStyle: TextStyle(color: Colors.white54),
                  border: OutlineInputBorder(),
                  focusedBorder: OutlineInputBorder(
                    borderSide: BorderSide(color: Color(0xFFF59E0B), width: 1.5),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('CANCEL', style: TextStyle(color: Colors.white54)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF06B6D4),
                foregroundColor: Colors.black,
              ),
              onPressed: () {
                final double? val = double.tryParse(controller.text);
                if (val != null && val > 0.1) {
                  setState(() => _baselineDistance = val);
                  Navigator.of(ctx).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Baseline updated to \${val.toStringAsFixed(2)} m'),
                      backgroundColor: const Color(0xFF06B6D4),
                      duration: const Duration(seconds: 2),
                    ),
                  );
                }
              },
              child: const Text('APPLY DISTANCE', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  Future<void> _logSurveyPoint() async {
    setState(() => _isLogging = true);
    final trig = TotalStationTrig(
      baselineDistance: _baselineDistance,
      pitchAngleDeg: _currentTelemetry.pitch,
    );

    final entry = SurveyEntry(
      title: 'STATION_\${DateTime.now().millisecondsSinceEpoch % 10000}',
      azimuth: _currentTelemetry.azimuth,
      pitch: _currentTelemetry.pitch,
      roll: _currentTelemetry.roll,
      baselineDistance: trig.baselineDistance,
      verticalDistance: trig.verticalDistance,
      horizontalDistance: trig.horizontalDistance,
      slopeDistance: trig.slopeDistance,
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
          content: Text(
            'Mark Logged! VD: \${trig.verticalDistance.toStringAsFixed(2)}m · Az: \${entry.azimuth.toStringAsFixed(1)}°',
          ),
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
    // Live Trigonometry instance
    final trig = TotalStationTrig(
      baselineDistance: _baselineDistance,
      pitchAngleDeg: _currentTelemetry.pitch,
    );

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          // 1. Live Camera Feed
          if (_cameraController != null && _cameraController!.value.isInitialized)
            CameraPreview(_cameraController!)
          else
            const Center(child: CircularProgressIndicator(color: Color(0xFFF59E0B))),

          // 2. 60 FPS Total Station HUD Reticle
          CameraOverlayView(
            telemetry: _currentTelemetry,
            totalStation: trig,
            latitude: _currentPosition?.latitude,
            longitude: _currentPosition?.longitude,
            altitude: _currentPosition?.altitude,
            zoomFactor: _zoomFactor,
            isTargetLocked: _isLocked,
          ),

          // 3. User Controls & Interactive Total Station Buttons
          SafeArea(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Top Action Bar
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      // Guide button
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.black54,
                          foregroundColor: const Color(0xFFF59E0B),
                          side: const BorderSide(color: Colors.white24),
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        ),
                        onPressed: _showFirstTimeTutorialDialog,
                        icon: const Icon(Icons.help_outline, size: 16),
                        label: const Text(
                          'TOTAL STATION',
                          style: TextStyle(fontFamily: 'monospace', fontSize: 11, fontWeight: FontWeight.bold),
                        ),
                      ),
                      // Target Lock toggle
                      IconButton(
                        style: IconButton.styleFrom(backgroundColor: Colors.black54),
                        icon: Icon(
                          _isLocked ? Icons.lock : Icons.lock_open,
                          color: _isLocked ? Colors.redAccent : Colors.white,
                        ),
                        onPressed: () => setState(() => _isLocked = !_isLocked),
                      ),
                    ],
                  ),
                ),

                // Bottom Action Tray (Thumb Zone)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 16.0),
                  child: Column(
                    children: [
                      // REQUIREMENT 4: Prominent Edit Baseline Distance Button
                      Container(
                        width: double.infinity,
                        margin: const EdgeInsets.only(bottom: 8.0),
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0F172A).withOpacity(0.9),
                            foregroundColor: const Color(0xFF06B6D4),
                            side: const BorderSide(color: Color(0xFF06B6D4), width: 1.2),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          onPressed: _showBaselineInputDialog,
                          icon: const Icon(Icons.straighten, size: 18),
                          label: Text(
                            'BASE DISTANCE: \${_baselineDistance.toStringAsFixed(1)} m  [TAP TO EDIT]',
                            style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 12),
                          ),
                        ),
                      ),

                      // Primary Mark Logger Button
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFF59E0B),
                            foregroundColor: Colors.black,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
                            elevation: 4,
                          ),
                          onPressed: _isLogging ? null : _logSurveyPoint,
                          icon: const Icon(Icons.add_location_alt),
                          label: const Text(
                            'LOG TOTAL STATION MARK',
                            style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1),
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
    description: 'Complete, standalone Total Station application with trigonometry engine (VD/HD), live 60 FPS reticle HUD, onboarding tutorial popup, and baseline editing.',
    code: STANDALONE_MAIN_DART,
  },
  {
    id: 'pubspec',
    filename: 'pubspec.yaml',
    filepath: 'pubspec.yaml',
    language: 'yaml',
    category: 'config',
    description: 'Complete dependencies for camera, sensors_plus, geolocator, sqflite, path, and vector_math.',
    code: `name: geosight
description: "A production-grade Total Station optical theodolite application with real-time trigonometry HUD."
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
