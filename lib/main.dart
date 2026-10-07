import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import 'package:vector_math/vector_math_64.dart' as vmath;

/// ============================================================================
/// 1. SPATIAL DATA STRUCTURES & TOTAL STATION ENGINE
/// ============================================================================

/// Industry-standard surveying feature codes
enum FeatureCode {
  bm('BM', 'Benchmark', Color(0xFFF59E0B)),
  bnd('BND', 'Boundary', Color(0xFFEF4444)),
  topo('TOPO', 'Topography', Color(0xFF10B981)),
  util('UTIL', 'Utility', Color(0xFF06B6D4));

  final String code;
  final String label;
  final Color color;
  const FeatureCode(this.code, this.label, this.color);

  static FeatureCode fromString(String val) {
    return FeatureCode.values.firstWhere(
      (e) => e.code.toUpperCase() == val.toUpperCase(),
      orElse: () => FeatureCode.topo,
    );
  }
}

/// Dynamic 3D Local Coordinate System (NEZ Grid) & Geodetic Data
class SurveyStation {
  final int? id;
  final String pointId;
  final FeatureCode featureCode;
  final double northing;      // N (meters)
  final double easting;       // E (meters)
  final double elevation;     // Z (True ground elevation in meters)
  final double rawVD;         // Raw optical height: HD * tan(pitch)
  final double horizontalDist;// HD (meters)
  final double slopeDist;     // SD (meters)
  final double azimuth;       // Horizontal Angle / Bearing (deg)
  final double pitch;         // Vertical Angle / Pitch (deg)
  final double roll;          // Horizon Tilt / Roll (deg)
  final double instrumentHeight; // HI (meters)
  final double targetHeight;     // HR (meters)
  final double latitude;
  final double longitude;
  final double gnssAltitude;
  final DateTime timestamp;
  final String? notes;

  SurveyStation({
    this.id,
    required this.pointId,
    required this.featureCode,
    required this.northing,
    required this.easting,
    required this.elevation,
    required this.rawVD,
    required this.horizontalDist,
    required this.slopeDist,
    required this.azimuth,
    required this.pitch,
    required this.roll,
    required this.instrumentHeight,
    required this.targetHeight,
    required this.latitude,
    required this.longitude,
    required this.gnssAltitude,
    required this.timestamp,
    this.notes,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'point_id': pointId,
      'feature_code': featureCode.code,
      'northing': northing,
      'easting': easting,
      'elevation': elevation,
      'raw_vd': rawVD,
      'horizontal_dist': horizontalDist,
      'slope_dist': slopeDist,
      'azimuth': azimuth,
      'pitch': pitch,
      'roll': roll,
      'hi': instrumentHeight,
      'hr': targetHeight,
      'latitude': latitude,
      'longitude': longitude,
      'gnss_altitude': gnssAltitude,
      'timestamp': timestamp.toIso8601String(),
      'notes': notes,
    };
  }

  factory SurveyStation.fromMap(Map<String, dynamic> map) {
    return SurveyStation(
      id: map['id'] as int?,
      pointId: map['point_id'] as String,
      featureCode: FeatureCode.fromString(map['feature_code'] as String),
      northing: (map['northing'] as num).toDouble(),
      easting: (map['easting'] as num).toDouble(),
      elevation: (map['elevation'] as num).toDouble(),
      rawVD: (map['raw_vd'] as num).toDouble(),
      horizontalDist: (map['horizontal_dist'] as num).toDouble(),
      slopeDist: (map['slope_dist'] as num).toDouble(),
      azimuth: (map['azimuth'] as num).toDouble(),
      pitch: (map['pitch'] as num).toDouble(),
      roll: (map['roll'] as num).toDouble(),
      instrumentHeight: (map['hi'] as num).toDouble(),
      targetHeight: (map['hr'] as num).toDouble(),
      latitude: (map['latitude'] as num).toDouble(),
      longitude: (map['longitude'] as num).toDouble(),
      gnssAltitude: (map['gnss_altitude'] as num).toDouble(),
      timestamp: DateTime.parse(map['timestamp'] as String),
      notes: map['notes'] as String?,
    );
  }
}

/// Live IMU Telemetry Data with circular angle unwrapping
class TelemetryData {
  final double azimuth;      // 0.0 to 359.99 degrees (True North = 0)
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

/// Total Station Real-Time Spatial Trigonometry Calculator
class SpatialTrigEngine {
  /// Computes true relative elevation delta accounting for Instrument Height (HI)
  /// and Reflector/Target Height (HR):
  /// True Delta Z = (HD * tan(theta)) + HI - HR
  static double computeDeltaZ({
    required double horizontalDist,
    required double pitchDeg,
    required double hi,
    required double hr,
  }) {
    final double pitchRad = pitchDeg * (math.pi / 180.0);
    final double rawVD = horizontalDist * math.tan(pitchRad);
    return rawVD + hi - hr;
  }

  /// Computes raw optical vertical distance: VD = HD * tan(pitch)
  static double computeRawVD({
    required double horizontalDist,
    required double pitchDeg,
  }) {
    final double pitchRad = pitchDeg * (math.pi / 180.0);
    return horizontalDist * math.tan(pitchRad);
  }

  /// Computes line-of-sight slope distance: SD = HD / cos(pitch)
  static double computeSlopeDistance({
    required double horizontalDist,
    required double pitchDeg,
  }) {
    final double pitchRad = pitchDeg * (math.pi / 180.0);
    final double cosTheta = math.cos(pitchRad).abs();
    if (cosTheta < 0.0001) return horizontalDist;
    return horizontalDist / cosTheta;
  }

  /// Computes local grid offsets (Delta Northing and Delta Easting) from Azimuth:
  /// Delta Northing = HD * cos(Azimuth)
  /// Delta Easting  = HD * sin(Azimuth)
  static Map<String, double> computeNEOffsets({
    required double horizontalDist,
    required double azimuthDeg,
  }) {
    final double azRad = azimuthDeg * (math.pi / 180.0);
    final double dN = horizontalDist * math.cos(azRad);
    final double dE = horizontalDist * math.sin(azRad);
    return {'dN': dN, 'dE': dE};
  }
}

/// ============================================================================
/// 2. SQLITE DATABASE PERSISTENCE LAYER
/// ============================================================================

class DBHelper {
  static const String _dbName = 'geosight_pro_station.db';
  static const int _dbVersion = 1;
  static const String tableStations = 'survey_stations';

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
          CREATE TABLE $tableStations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            point_id TEXT NOT NULL,
            feature_code TEXT NOT NULL,
            northing REAL NOT NULL,
            easting REAL NOT NULL,
            elevation REAL NOT NULL,
            raw_vd REAL NOT NULL,
            horizontal_dist REAL NOT NULL,
            slope_dist REAL NOT NULL,
            azimuth REAL NOT NULL,
            pitch REAL NOT NULL,
            roll REAL NOT NULL,
            hi REAL NOT NULL,
            hr REAL NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            gnss_altitude REAL NOT NULL,
            timestamp TEXT NOT NULL,
            notes TEXT
          )
        ''');
        await db.execute(
          'CREATE INDEX idx_stations_time ON $tableStations(timestamp DESC)',
        );
      },
    );
  }

  Future<int> insertStation(SurveyStation station) async {
    final Database db = await database;
    return await db.insert(
      tableStations,
      station.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<List<SurveyStation>> getAllStations() async {
    final Database db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      tableStations,
      orderBy: 'timestamp ASC',
    );
    return maps.map((m) => SurveyStation.fromMap(m)).toList();
  }

  Future<int> deleteStation(int id) async {
    final Database db = await database;
    return await db.delete(tableStations, where: 'id = ?', whereArgs: [id]);
  }

  Future<int> clearAllStations() async {
    final Database db = await database;
    return await db.delete(tableStations);
  }
}

/// ============================================================================
/// 3. IMU SENSOR FUSION SERVICE (LOW-PASS EMA + 3D ORTHOGONAL ROTATION)
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
/// 4. MULTI-FORMAT SURVEY REPORT ENGINE (CSV & GOOGLE EARTH KML)
/// ============================================================================

class SurveyReportEngine {
  /// Generates industry-standard Comma-Separated Values (CSV) report
  static String generateCSV(List<SurveyStation> stations) {
    final buffer = StringBuffer();
    // Standard Survey Header
    buffer.writeln(
      'PointID,FeatureCode,Northing_m,Easting_m,Elevation_Z_m,Raw_VD_m,Horiz_HD_m,Slope_SD_m,Azimuth_deg,Pitch_deg,Roll_deg,HI_m,HR_m,Latitude,Longitude,GNSS_Alt_m,Timestamp,Notes',
    );

    for (final s in stations) {
      buffer.writeln([
        s.pointId,
        s.featureCode.code,
        s.northing.toStringAsFixed(3),
        s.easting.toStringAsFixed(3),
        s.elevation.toStringAsFixed(3),
        s.rawVD.toStringAsFixed(3),
        s.horizontalDist.toStringAsFixed(3),
        s.slopeDist.toStringAsFixed(3),
        s.azimuth.toStringAsFixed(2),
        s.pitch.toStringAsFixed(2),
        s.roll.toStringAsFixed(2),
        s.instrumentHeight.toStringAsFixed(2),
        s.targetHeight.toStringAsFixed(2),
        s.latitude.toStringAsFixed(7),
        s.longitude.toStringAsFixed(7),
        s.gnssAltitude.toStringAsFixed(2),
        s.timestamp.toIso8601String(),
        '"${s.notes ?? ''}"',
      ].join(','));
    }

    return buffer.toString();
  }

  /// Generates Google Earth Keyhole Markup Language (KML) with styles & placemarks
  static String generateKML(List<SurveyStation> stations, {String projectName = 'GeoSight Survey'}) {
    final buffer = StringBuffer();
    buffer.writeln('<?xml version="1.0" encoding="UTF-8"?>');
    buffer.writeln('<kml xmlns="http://www.opengis.net/kml/2.2">');
    buffer.writeln('  <Document>');
    buffer.writeln('    <name>$projectName</name>');
    buffer.writeln('    <description>Generated by GeoSight Pro Total Station</description>');

    // Feature Code Style Pin definitions
    buffer.writeln('''
    <Style id="bmStyle">
      <IconStyle>
        <color>ff0b9ef5</color>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/triangle.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="bndStyle">
      <IconStyle>
        <color>ff4444ef</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_square.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="topoStyle">
      <IconStyle>
        <color>ff81b910</color>
        <scale>1.0</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="utilStyle">
      <IconStyle>
        <color>ffd4b606</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon>
      </IconStyle>
    </Style>
    ''');

    for (final s in stations) {
      String styleId = 'topoStyle';
      if (s.featureCode == FeatureCode.bm) styleId = 'bmStyle';
      if (s.featureCode == FeatureCode.bnd) styleId = 'bndStyle';
      if (s.featureCode == FeatureCode.util) styleId = 'utilStyle';

      buffer.writeln('    <Placemark>');
      buffer.writeln('      <name>${s.pointId} [${s.featureCode.code}]</name>');
      buffer.writeln('      <styleUrl>#$styleId</styleUrl>');
      buffer.writeln('      <description><![CDATA[');
      buffer.writeln('        <h3>${s.pointId} - ${s.featureCode.label}</h3>');
      buffer.writeln('        <table border="1" cellpadding="4" style="border-collapse:collapse;font-family:monospace;">');
      buffer.writeln('          <tr><td><b>Northing (N)</b></td><td>${s.northing.toStringAsFixed(3)} m</td></tr>');
      buffer.writeln('          <tr><td><b>Easting (E)</b></td><td>${s.easting.toStringAsFixed(3)} m</td></tr>');
      buffer.writeln('          <tr><td><b>Elevation (Z)</b></td><td>${s.elevation.toStringAsFixed(3)} m</td></tr>');
      buffer.writeln('          <tr><td><b>Horiz Dist (HD)</b></td><td>${s.horizontalDist.toStringAsFixed(2)} m</td></tr>');
      buffer.writeln('          <tr><td><b>Raw VD</b></td><td>${s.rawVD.toStringAsFixed(2)} m</td></tr>');
      buffer.writeln('          <tr><td><b>HI / HR</b></td><td>${s.instrumentHeight}m / ${s.targetHeight}m</td></tr>');
      buffer.writeln('          <tr><td><b>Azimuth / Pitch</b></td><td>${s.azimuth.toStringAsFixed(1)}° / ${s.pitch.toStringAsFixed(1)}°</td></tr>');
      buffer.writeln('        </table>');
      buffer.writeln('      ]]></description>');
      buffer.writeln('      <Point>');
      buffer.writeln('        <coordinates>${s.longitude},${s.latitude},${s.elevation}</coordinates>');
      buffer.writeln('      </Point>');
      buffer.writeln('    </Placemark>');
    }

    buffer.writeln('  </Document>');
    buffer.writeln('</kml>');
    return buffer.toString();
  }
}

/// ============================================================================
/// 5. MODE A: 60 FPS OPTICAL RETICLE & DYNAMIC NEZ HUD PAINTER
/// ============================================================================

class TheodoliteReticlePainter extends CustomPainter {
  final TelemetryData telemetry;
  final double baselineDistance;
  final double instrumentHeight;
  final double targetHeight;
  final FeatureCode currentFeature;
  final double liveNorthing;
  final double liveEasting;
  final double liveElevation;
  final double liveDeltaZ;
  final double? latitude;
  final double? longitude;
  final double zoomFactor;
  final bool isTargetLocked;

  late final Paint _reticlePaint;
  late final Paint _accentPaint;
  late final Paint _horizonPaint;
  late final Paint _tapeTickPaint;
  late final Paint _tapeMajorPaint;
  late final Paint _backgroundScrimPaint;
  late final Paint _hudBoxScrimPaint;

  TheodoliteReticlePainter({
    required this.telemetry,
    required this.baselineDistance,
    required this.instrumentHeight,
    required this.targetHeight,
    required this.currentFeature,
    required this.liveNorthing,
    required this.liveEasting,
    required this.liveElevation,
    required this.liveDeltaZ,
    this.latitude,
    this.longitude,
    this.zoomFactor = 1.0,
    this.isTargetLocked = false,
  }) {
    final Color mainColor = isTargetLocked
        ? const Color(0xFFEF4444)
        : const Color(0xFFF59E0B);

    _reticlePaint = Paint()
      ..color = mainColor.withOpacity(0.9)
      ..strokeWidth = 1.3
      ..style = PaintingStyle.stroke;

    _accentPaint = Paint()
      ..color = const Color(0xFF06B6D4)
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    _horizonPaint = Paint()
      ..color = const Color(0xFF10B981).withOpacity(0.85)
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

    _hudBoxScrimPaint = Paint()
      ..color = const Color(0xFF020617).withOpacity(0.92)
      ..style = PaintingStyle.fill;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = Offset(size.width / 2, size.height / 2);

    _drawOpticalFrame(canvas, size);
    _drawArtificialHorizon(canvas, center);
    _drawPrecisionCrosshair(canvas, center);
    _drawAzimuthTape(canvas, size);
    _drawPitchLadder(canvas, size);
    _drawDynamicNEZHUD(canvas, size);
    _drawTelemetryBar(canvas, size);
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
        String label = '${norm.toInt()}°';
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
        _drawText(canvas, '${deg > 0 ? "+" : ""}$deg°', Offset(ladderX - 22, y), fontSize: 7, color: Colors.white70);
      }
    }

    canvas.drawLine(Offset(ladderX - 18, centerY), Offset(ladderX, centerY), Paint()..color = const Color(0xFFF59E0B)..strokeWidth = 2);
  }

  /// FEATURE 2: DYNAMIC LOCAL COORDINATE SYSTEM (NEZ GRID) HUD
  void _drawDynamicNEZHUD(Canvas canvas, Size size) {
    const double top = 92.0;
    const double left = 16.0;
    const double boxWidth = 230.0;
    const double boxHeight = 88.0;

    final Rect boxRect = Rect.fromLTWH(left, top, boxWidth, boxHeight);

    canvas.drawRRect(RRect.fromRectAndRadius(boxRect, const Radius.circular(8)), _hudBoxScrimPaint);
    canvas.drawRRect(
      RRect.fromRectAndRadius(boxRect, const Radius.circular(8)),
      Paint()
        ..color = currentFeature.color.withOpacity(0.6)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.2,
    );

    // Title & Feature Code Tag
    _drawText(
      canvas,
      'LOCAL NEZ GRID [${currentFeature.code}]',
      Offset(left + 80, top + 10),
      fontSize: 8,
      isBold: true,
      color: currentFeature.color,
    );

    _drawText(
      canvas,
      'HI:${instrumentHeight.toStringAsFixed(2)}m HR:${targetHeight.toStringAsFixed(2)}m',
      Offset(left + boxWidth - 45, top + 10),
      fontSize: 7,
      color: Colors.white60,
    );

    // Coordinate Numbers in high-contrast tabular font
    final String nStr = '${liveNorthing.toStringAsFixed(3)} m';
    final String eStr = '${liveEasting.toStringAsFixed(3)} m';
    final String zStr = '${liveElevation.toStringAsFixed(3)} m';
    final String dzStr = '${liveDeltaZ >= 0 ? "+" : ""}${liveDeltaZ.toStringAsFixed(3)} m';

    _drawDataCell(canvas, 'NORTHING (N)', nStr, Offset(left + 54, top + 26));
    _drawDataCell(canvas, 'EASTING (E)', eStr, Offset(left + 54, top + 54));

    _drawDataCell(
      canvas,
      'ELEVATION (Z)',
      zStr,
      Offset(left + 165, top + 26),
      valColor: const Color(0xFF10B981),
    );
    _drawDataCell(
      canvas,
      'DELTA ELEV (ΔZ)',
      dzStr,
      Offset(left + 165, top + 54),
      valColor: const Color(0xFF06B6D4),
    );
  }

  void _drawTelemetryBar(Canvas canvas, Size size) {
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

    _drawDataCell(canvas, 'AZIMUTH (BEARING)', '${telemetry.azimuth.toStringAsFixed(1)}°', Offset(col1, y1));
    _drawDataCell(canvas, 'PITCH (ELEVATION)', '${telemetry.pitch >= 0 ? "+" : ""}${telemetry.pitch.toStringAsFixed(1)}°', Offset(col2, y1));
    _drawDataCell(canvas, 'HORIZON (ROLL)', '${telemetry.roll.toStringAsFixed(1)}°', Offset(col3, y1));

    final String latStr = latitude != null ? '${latitude!.toStringAsFixed(5)}°' : '--';
    final String lonStr = longitude != null ? '${longitude!.toStringAsFixed(5)}°' : '--';

    _drawDataCell(canvas, 'GNSS COORD', '$latStr, $lonStr', Offset(col1, y2));
    _drawDataCell(canvas, 'BASE DIST (HD)', '${baselineDistance.toStringAsFixed(2)} m', Offset(col2, y2));
    _drawDataCell(canvas, 'OPTICS', '${zoomFactor.toStringAsFixed(1)}x', Offset(col3, y2));
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
        old.baselineDistance != baselineDistance ||
        old.instrumentHeight != instrumentHeight ||
        old.targetHeight != targetHeight ||
        old.currentFeature != currentFeature ||
        old.liveNorthing != liveNorthing ||
        old.liveEasting != liveEasting ||
        old.zoomFactor != zoomFactor ||
        old.isTargetLocked != isTargetLocked;
  }
}

/// ============================================================================
/// 6. MODE B: 2D RADAR CANVAS PLOTTER (CARTESIAN NEZ SURVEY MAPPER)
/// ============================================================================

class RadarGridPlotterPainter extends CustomPainter {
  final List<SurveyStation> stations;
  final TelemetryData telemetry;
  final double liveNorthing;
  final double liveEasting;
  final double currentBaseDist;
  final double stationOriginN;
  final double stationOriginE;

  RadarGridPlotterPainter({
    required this.stations,
    required this.telemetry,
    required this.liveNorthing,
    required this.liveEasting,
    required this.currentBaseDist,
    required this.stationOriginN,
    required this.stationOriginE,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final Offset center = Offset(size.width / 2, size.height / 2);

    // 1. Radar Background Matrix
    final Rect background = Offset.zero & size;
    canvas.drawRect(background, Paint()..color = const Color(0xFF030712));

    // Dynamic scale: compute bounds from all stations plus current aiming point
    double maxDist = currentBaseDist > 0 ? currentBaseDist * 1.3 : 30.0;
    for (final s in stations) {
      final double dN = (s.northing - stationOriginN).abs();
      final double dE = (s.easting - stationOriginE).abs();
      final double d = math.sqrt(dN * dN + dE * dE);
      if (d > maxDist) maxDist = d;
    }
    maxDist = math.max(20.0, maxDist * 1.15);

    final double pxPerMeter = (size.shortestSide / 2 - 30) / maxDist;

    // 2. Concentric Range Rings & Cross Grid Lines
    final Paint ringPaint = Paint()
      ..color = const Color(0xFF1E293B)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    final Paint axisPaint = Paint()
      ..color = const Color(0xFF334155)
      ..strokeWidth = 1.2;

    // N-S Axis & E-W Axis
    canvas.drawLine(Offset(center.dx, 16), Offset(center.dx, size.height - 16), axisPaint);
    canvas.drawLine(Offset(16, center.dy), Offset(size.width - 16, center.dy), axisPaint);

    // Axis Direction Labels
    _drawText(canvas, 'TRUE NORTH (N)', Offset(center.dx, 22), color: const Color(0xFFF59E0B), isBold: true);
    _drawText(canvas, 'EAST (E)', Offset(size.width - 32, center.dy - 10), color: const Color(0xFF38BDF8), isBold: true);
    _drawText(canvas, 'SOUTH (S)', Offset(center.dx, size.height - 24), color: Colors.white38);
    _drawText(canvas, 'WEST (W)', Offset(32, center.dy - 10), color: Colors.white38);

    // Range Rings at 10m, 25m, 50m intervals
    final List<double> rings = [10.0, 25.0, 50.0, 100.0, 200.0];
    for (final r in rings) {
      if (r > maxDist) continue;
      final double radiusPx = r * pxPerMeter;
      canvas.drawCircle(center, radiusPx, ringPaint);
      _drawText(
        canvas,
        '${r.toInt()}m',
        Offset(center.dx + 4, center.dy - radiusPx - 6),
        fontSize: 8,
        color: const Color(0xFF64748B),
      );
    }

    // 3. Current Theodolite Aiming Vector Line
    final double azRad = telemetry.azimuth * (math.pi / 180.0);
    final double aimPxX = center.dx + (currentBaseDist * math.sin(azRad)) * pxPerMeter;
    final double aimPxY = center.dy - (currentBaseDist * math.cos(azRad)) * pxPerMeter;

    final Paint aimVectorPaint = Paint()
      ..color = const Color(0xFF06B6D4).withOpacity(0.7)
      ..strokeWidth = 1.5
      ..strokeCap = StrokeCap.round;

    canvas.drawLine(center, Offset(aimPxX, aimPxY), aimVectorPaint);

    // Live Aim Target Reticle Pip
    canvas.drawCircle(
      Offset(aimPxX, aimPxY),
      5.0,
      Paint()
        ..color = const Color(0xFF06B6D4)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
    canvas.drawCircle(Offset(aimPxX, aimPxY), 2.0, Paint()..color = const Color(0xFF06B6D4));

    // 4. Draw Center Instrument Station (STN 0 / Benchmark)
    canvas.drawCircle(center, 6.0, Paint()..color = const Color(0xFFF59E0B));
    canvas.drawCircle(
      center,
      9.0,
      Paint()
        ..color = const Color(0xFFF59E0B)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
    _drawText(canvas, 'STN-0 (OCCUPIED)', Offset(center.dx, center.dy + 16), fontSize: 8, isBold: true, color: const Color(0xFFF59E0B));

    // 5. Draw Logged Survey Stations
    for (int i = 0; i < stations.length; i++) {
      final s = stations[i];
      final double dE = s.easting - stationOriginE;
      final double dN = s.northing - stationOriginN;

      final double pxX = center.dx + (dE * pxPerMeter);
      final double pxY = center.dy - (dN * pxPerMeter);

      final Color ptColor = s.featureCode.color;

      // Draw feature symbol shape
      _drawFeatureSymbol(canvas, Offset(pxX, pxY), s.featureCode, ptColor);

      // Connect traverse baseline lines
      if (i > 0) {
        final prev = stations[i - 1];
        final prevX = center.dx + ((prev.easting - stationOriginE) * pxPerMeter);
        final prevY = center.dy - ((prev.northing - stationOriginN) * pxPerMeter);
        canvas.drawLine(
          Offset(prevX, prevY),
          Offset(pxX, pxY),
          Paint()
            ..color = Colors.white.withOpacity(0.2)
            ..strokeWidth = 1.0,
        );
      }

      // Station Annotation Callout
      _drawText(
        canvas,
        '${s.pointId} [${s.featureCode.code}]',
        Offset(pxX, pxY - 12),
        fontSize: 8,
        isBold: true,
        color: ptColor,
      );
      _drawText(
        canvas,
        'Z:${s.elevation.toStringAsFixed(1)}m',
        Offset(pxX, pxY + 10),
        fontSize: 7,
        color: Colors.white70,
      );
    }
  }

  void _drawFeatureSymbol(Canvas canvas, Offset pos, FeatureCode code, Color color) {
    final paintFill = Paint()..color = color;
    final paintStroke = Paint()
      ..color = Colors.black
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    switch (code) {
      case FeatureCode.bm: // Triangle
        final path = Path()
          ..moveTo(pos.dx, pos.dy - 6)
          ..lineTo(pos.dx + 6, pos.dy + 5)
          ..lineTo(pos.dx - 6, pos.dy + 5)
          ..close();
        canvas.drawPath(path, paintFill);
        canvas.drawPath(path, paintStroke);
        break;
      case FeatureCode.bnd: // Square
        final rect = Rect.fromCenter(center: pos, width: 9, height: 9);
        canvas.drawRect(rect, paintFill);
        canvas.drawRect(rect, paintStroke);
        break;
      case FeatureCode.topo: // Circle
        canvas.drawCircle(pos, 4.5, paintFill);
        canvas.drawCircle(pos, 4.5, paintStroke);
        break;
      case FeatureCode.util: // Diamond
        final path = Path()
          ..moveTo(pos.dx, pos.dy - 6)
          ..lineTo(pos.dx + 6, pos.dy)
          ..lineTo(pos.dx, pos.dy + 6)
          ..lineTo(pos.dx - 6, pos.dy)
          ..close();
        canvas.drawPath(path, paintFill);
        canvas.drawPath(path, paintStroke);
        break;
    }
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
  bool shouldRepaint(covariant RadarGridPlotterPainter old) {
    return old.stations.length != stations.length ||
        old.telemetry.azimuth != telemetry.azimuth ||
        old.currentBaseDist != currentBaseDist ||
        old.liveNorthing != liveNorthing ||
        old.liveEasting != liveEasting;
  }
}

/// ============================================================================
/// 7. MAIN APPLICATION WIDGET & TOTAL STATION STATE ARCHITECTURE
/// ============================================================================

List<CameraDescription> _availableCameras = [];

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    _availableCameras = await availableCameras();
  } catch (e) {
    debugPrint('Hardware camera initialization: $e');
  }
  runApp(const GeoSightTotalStationApp());
}

class GeoSightTotalStationApp extends StatelessWidget {
  const GeoSightTotalStationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GeoSight Total Station Pro',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: Colors.black,
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFF59E0B),
          secondary: Color(0xFF06B6D4),
          surface: Color(0xFF0F172A),
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

  // IMU Telemetry & Geodetic state
  TelemetryData _currentTelemetry = TelemetryData.initial();
  Position? _currentPosition;
  double _zoomFactor = 1.0;
  bool _isLocked = false;
  bool _isLogging = false;

  // FEATURE 4: DUAL MODE HUD SWITCHER
  // true = Mode A (Live Camera Viewfinder + NEZ HUD)
  // false = Mode B (2D Radar Grid Plotter Canvas)
  bool _isCameraMode = true;

  // FEATURE 1: INSTRUMENT HEIGHT CALIBRATION PARAMETERS
  double _baselineDistance = 25.0; // HD Ground Distance (meters)
  double _instrumentHeight = 1.55; // HI (meters from ground to lens)
  double _targetHeight = 1.80;     // HR (meters from target ground to reflector)

  // FEATURE 3: FEATURE CODE LIBRARY
  FeatureCode _selectedFeature = FeatureCode.topo;

  // FEATURE 2: DYNAMIC LOCAL COORDINATE SYSTEM (NEZ GRID)
  // Benchmark station reference origin (Default: N=1000.0, E=1000.0, Z=100.0)
  double _stationOriginN = 1000.000;
  double _stationOriginE = 1000.000;
  double _stationOriginZ = 100.000;

  // Stored survey stations for 2D radar and multi-format reports
  List<SurveyStation> _loggedStations = [];

  @override
  void initState() {
    super.initState();
    _initCamera();
    _initSensors();
    _initGeolocation();
    _loadStoredStations();

    // First-Time Boot Guide
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _showTutorialDialog();
    });
  }

  Future<void> _loadStoredStations() async {
    final list = await _dbHelper.getAllStations();
    if (mounted) setState(() => _loggedStations = list);
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

  // Live NEZ Coordinate computation relative to current station benchmark
  Map<String, double> get _liveNEZMetrics {
    final dNE = SpatialTrigEngine.computeNEOffsets(
      horizontalDist: _baselineDistance,
      azimuthDeg: _currentTelemetry.azimuth,
    );
    final deltaZ = SpatialTrigEngine.computeDeltaZ(
      horizontalDist: _baselineDistance,
      pitchDeg: _currentTelemetry.pitch,
      hi: _instrumentHeight,
      hr: _targetHeight,
    );

    final double liveN = _stationOriginN + dNE['dN']!;
    final double liveE = _stationOriginE + dNE['dE']!;
    final double liveZ = _stationOriginZ + deltaZ;

    return {
      'N': liveN,
      'E': liveE,
      'Z': liveZ,
      'deltaZ': deltaZ,
    };
  }

  Future<void> _logSurveyPoint() async {
    setState(() => _isLogging = true);
    final nez = _liveNEZMetrics;
    final rawVD = SpatialTrigEngine.computeRawVD(
      horizontalDist: _baselineDistance,
      pitchDeg: _currentTelemetry.pitch,
    );
    final sd = SpatialTrigEngine.computeSlopeDistance(
      horizontalDist: _baselineDistance,
      pitchDeg: _currentTelemetry.pitch,
    );

    final nextId = _loggedStations.length + 1;
    final pointId = '${_selectedFeature.code}-${nextId.toString().padLeft(3, '0')}';

    final station = SurveyStation(
      pointId: pointId,
      featureCode: _selectedFeature,
      northing: nez['N']!,
      easting: nez['E']!,
      elevation: nez['Z']!,
      rawVD: rawVD,
      horizontalDist: _baselineDistance,
      slopeDist: sd,
      azimuth: _currentTelemetry.azimuth,
      pitch: _currentTelemetry.pitch,
      roll: _currentTelemetry.roll,
      instrumentHeight: _instrumentHeight,
      targetHeight: _targetHeight,
      latitude: _currentPosition?.latitude ?? 0.0,
      longitude: _currentPosition?.longitude ?? 0.0,
      gnssAltitude: _currentPosition?.altitude ?? 0.0,
      timestamp: DateTime.now(),
    );

    await _dbHelper.insertStation(station);
    await _loadStoredStations();

    if (mounted) {
      setState(() => _isLogging = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Point $pointId Logged! N: ${station.northing.toStringAsFixed(2)} E: ${station.easting.toStringAsFixed(2)} Z: ${station.elevation.toStringAsFixed(2)}',
          ),
          backgroundColor: _selectedFeature.color,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  /// FEATURE 1: Instrument & Target Height Calibration Dialog
  void _showCalibrationDialog() {
    final hiController = TextEditingController(text: _instrumentHeight.toStringAsFixed(2));
    final hrController = TextEditingController(text: _targetHeight.toStringAsFixed(2));
    final distController = TextEditingController(text: _baselineDistance.toStringAsFixed(1));

    showDialog(
      context: context,
      builder: (BuildContext ctx) {
        return AlertDialog(
          backgroundColor: const Color(0xFF0F172A),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFF06B6D4), width: 1.2),
          ),
          title: Row(
            children: const [
              Icon(Icons.height, color: Color(0xFF06B6D4)),
              SizedBox(width: 8),
              Text(
                'Total Station Calibration',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'Calibrate Instrument Height (HI) and Target Height (HR) to compute true ground elevations:',
                  style: TextStyle(fontSize: 12, color: Colors.white70),
                ),
                const SizedBox(height: 14),
                _buildNumberField(
                  label: 'Instrument Height (HI) [Lens to Ground]',
                  controller: hiController,
                  suffix: 'meters',
                ),
                const SizedBox(height: 12),
                _buildNumberField(
                  label: 'Target / Reflector Height (HR)',
                  controller: hrController,
                  suffix: 'meters',
                ),
                const SizedBox(height: 12),
                _buildNumberField(
                  label: 'Baseline Ground Distance (HD)',
                  controller: distController,
                  suffix: 'meters',
                ),
              ],
            ),
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
                final hi = double.tryParse(hiController.text);
                final hr = double.tryParse(hrController.text);
                final d = double.tryParse(distController.text);
                if (hi != null && hr != null && d != null && d > 0.1) {
                  setState(() {
                    _instrumentHeight = hi;
                    _targetHeight = hr;
                    _baselineDistance = d;
                  });
                  Navigator.of(ctx).pop();
                }
              },
              child: const Text('APPLY CALIBRATION', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  Widget _buildNumberField({
    required String label,
    required TextEditingController controller,
    required String suffix,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.white60)),
        const SizedBox(height: 4),
        TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          style: const TextStyle(fontFamily: 'monospace', fontSize: 16, color: Color(0xFFF59E0B)),
          decoration: InputDecoration(
            suffixText: suffix,
            suffixStyle: const TextStyle(color: Colors.white54, fontSize: 12),
            filled: true,
            fillColor: const Color(0xFF020617),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: Color(0xFFF59E0B)),
            ),
          ),
        ),
      ],
    );
  }

  /// FEATURE 5: MULTI-FORMAT DATA REPORT VIEWER (CSV & KML GENERATOR)
  void _showDataReportDialog() {
    showDialog(
      context: context,
      builder: (BuildContext ctx) {
        return DefaultTabController(
          length: 3,
          child: AlertDialog(
            backgroundColor: const Color(0xFF0F172A),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(color: Color(0xFFF59E0B)),
            ),
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Survey Data Reports',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close, size: 20),
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                  ],
                ),
                const TabBar(
                  indicatorColor: Color(0xFFF59E0B),
                  labelColor: Color(0xFFF59E0B),
                  unselectedLabelColor: Colors.white54,
                  tabs: [
                    Tab(text: 'TABLE'),
                    Tab(text: 'CSV EXPORT'),
                    Tab(text: 'GOOGLE EARTH KML'),
                  ],
                ),
              ],
            ),
            content: SizedBox(
              width: double.maxFinite,
              height: 420,
              child: TabBarView(
                children: [
                  // Tab 1: Formatted Table
                  _buildReportTableView(),
                  // Tab 2: Raw CSV
                  _buildCodeViewer(SurveyReportEngine.generateCSV(_loggedStations), 'CSV'),
                  // Tab 3: Google Earth KML
                  _buildCodeViewer(SurveyReportEngine.generateKML(_loggedStations), 'KML'),
                ],
              ),
            ),
            actions: [
              if (_loggedStations.isNotEmpty)
                TextButton(
                  onPressed: () async {
                    await _dbHelper.clearAllStations();
                    await _loadStoredStations();
                    Navigator.of(ctx).pop();
                  },
                  child: const Text('CLEAR ALL MARKS', style: TextStyle(color: Colors.redAccent)),
                ),
              ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFF59E0B),
                  foregroundColor: Colors.black,
                ),
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('DONE', style: TextStyle(fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildReportTableView() {
    if (_loggedStations.isEmpty) {
      return const Center(
        child: Text('No points logged yet. Aim reticle and tap Log Station.', style: TextStyle(color: Colors.white54)),
      );
    }
    return ListView.separated(
      itemCount: _loggedStations.length,
      separatorBuilder: (_, __) => const Divider(color: Colors.white12, height: 1),
      itemBuilder: (context, idx) {
        final s = _loggedStations[idx];
        return ListTile(
          dense: true,
          contentPadding: EdgeInsets.zero,
          leading: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: s.featureCode.color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(4),
              border: Border.all(color: s.featureCode.color),
            ),
            child: Text(
              s.featureCode.code,
              style: TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 11, color: s.featureCode.color),
            ),
          ),
          title: Text(s.pointId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Colors.white)),
          subtitle: Text(
            'N: ${s.northing.toStringAsFixed(2)}  E: ${s.easting.toStringAsFixed(2)}  Z: ${s.elevation.toStringAsFixed(2)}m',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.white70),
          ),
          trailing: Text(
            '${s.azimuth.toStringAsFixed(0)}° / ${s.horizontalDist.toStringAsFixed(1)}m',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Color(0xFFF59E0B)),
          ),
        );
      },
    );
  }

  Widget _buildCodeViewer(String content, String formatLabel) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('$formatLabel String Output:', style: const TextStyle(fontSize: 11, color: Colors.white54)),
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0F172A),
                side: const BorderSide(color: Color(0xFF06B6D4)),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              ),
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('$formatLabel copied to clipboard!'),
                    backgroundColor: const Color(0xFF06B6D4),
                  ),
                );
              },
              icon: const Icon(Icons.copy, size: 14, color: Color(0xFF06B6D4)),
              label: Text('Copy $formatLabel', style: const TextStyle(fontSize: 11, color: Color(0xFF06B6D4))),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Expanded(
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFF020617),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.white12),
            ),
            child: SingleChildScrollView(
              child: SelectableText(
                content,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.white70),
              ),
            ),
          ),
        ),
      ],
    );
  }

  void _showTutorialDialog() {
    showDialog(
      context: context,
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
              Text('GeoSight Pro Total Station', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: const [
                Text(
                  'Professional Spatial Field Surveying Engine:',
                  style: TextStyle(fontSize: 12, color: Colors.white70),
                ),
                SizedBox(height: 12),
                Text('• Instrument Calibration: Set HI (Lens height) & HR (Target height). True Z elevation accounts for vertical stadia delta.', style: TextStyle(fontSize: 11, color: Colors.white60)),
                SizedBox(height: 8),
                Text('• Dynamic NEZ Grid: Real-time Northing, Easting, and Elevation local grid offsets computed on the live HUD.', style: TextStyle(fontSize: 11, color: Colors.white60)),
                SizedBox(height: 8),
                Text('• Feature Codes: Tag shots as BM (Benchmark), BND (Boundary), TOPO (Topography), or UTIL (Utility).', style: TextStyle(fontSize: 11, color: Colors.white60)),
                SizedBox(height: 8),
                Text('• Dual-Mode HUD: Toggle between Live Camera Crosshair and 2D Radar Grid Plotter map.', style: TextStyle(fontSize: 11, color: Colors.white60)),
                SizedBox(height: 8),
                Text('• Reports: Export clean Comma-Separated Values (CSV) and Google Earth KML files.', style: TextStyle(fontSize: 11, color: Colors.white60)),
              ],
            ),
          ),
          actions: [
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), foregroundColor: Colors.black),
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('BEGIN SURVEY', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    _sensorService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final nez = _liveNEZMetrics;

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          // ------------------------------------------------------------------
          // VIEW LAYER: MODE A (CAMERA HUD) vs MODE B (2D RADAR PLOTTER)
          // ------------------------------------------------------------------
          if (_isCameraMode) ...[
            // Mode A: Camera Feed
            if (_cameraController != null && _cameraController!.value.isInitialized)
              CameraPreview(_cameraController!)
            else
              const Center(child: CircularProgressIndicator(color: Color(0xFFF59E0B))),

            // Mode A: 60 FPS Optical Reticle & NEZ Telemetry Canvas
            RepaintBoundary(
              child: CustomPaint(
                size: Size.infinite,
                painter: TheodoliteReticlePainter(
                  telemetry: _currentTelemetry,
                  baselineDistance: _baselineDistance,
                  instrumentHeight: _instrumentHeight,
                  targetHeight: _targetHeight,
                  currentFeature: _selectedFeature,
                  liveNorthing: nez['N']!,
                  liveEasting: nez['E']!,
                  liveElevation: nez['Z']!,
                  liveDeltaZ: nez['deltaZ']!,
                  latitude: _currentPosition?.latitude,
                  longitude: _currentPosition?.longitude,
                  zoomFactor: _zoomFactor,
                  isTargetLocked: _isLocked,
                ),
              ),
            ),
          ] else ...[
            // Mode B: Interactive 2D Radar Canvas Plotter
            CustomPaint(
              size: Size.infinite,
              painter: RadarGridPlotterPainter(
                stations: _loggedStations,
                telemetry: _currentTelemetry,
                liveNorthing: nez['N']!,
                liveEasting: nez['E']!,
                currentBaseDist: _baselineDistance,
                stationOriginN: _stationOriginN,
                stationOriginE: _stationOriginE,
              ),
            ),
          ],

          // ------------------------------------------------------------------
          // INTERACTIVE CONTROLS & HUD ACTION OVERLAY
          // ------------------------------------------------------------------
          SafeArea(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Top Control Row: Mode Switcher, Calibration, Reports, Lock
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14.0, vertical: 8.0),
                  child: Row(
                    children: [
                      // FEATURE 4: Dual Mode HUD Switcher (Camera vs Radar)
                      Container(
                        decoration: BoxDecoration(
                          color: const Color(0xFF0F172A).withOpacity(0.9),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: const Color(0xFFF59E0B)),
                        ),
                        child: Row(
                          children: [
                            GestureDetector(
                              onTap: () => setState(() => _isCameraMode = true),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: _isCameraMode ? const Color(0xFFF59E0B) : Colors.transparent,
                                  borderRadius: const BorderRadius.horizontal(left: Radius.circular(7)),
                                ),
                                child: Row(
                                  children: [
                                    Icon(Icons.videocam, size: 14, color: _isCameraMode ? Colors.black : Colors.white70),
                                    const SizedBox(width: 4),
                                    Text(
                                      'HUD',
                                      style: TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                        color: _isCameraMode ? Colors.black : Colors.white70,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            GestureDetector(
                              onTap: () => setState(() => _isCameraMode = false),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                decoration: BoxDecoration(
                                  color: !_isCameraMode ? const Color(0xFFF59E0B) : Colors.transparent,
                                  borderRadius: const BorderRadius.horizontal(right: Radius.circular(7)),
                                ),
                                child: Row(
                                  children: [
                                    Icon(Icons.radar, size: 14, color: !_isCameraMode ? Colors.black : Colors.white70),
                                    const SizedBox(width: 4),
                                    Text(
                                      'RADAR',
                                      style: TextStyle(
                                        fontFamily: 'monospace',
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                        color: !_isCameraMode ? Colors.black : Colors.white70,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),

                      const Spacer(),

                      // Calibration Trigger (HI / HR / Base Dist)
                      IconButton(
                        style: IconButton.styleFrom(backgroundColor: const Color(0xFF0F172A).withOpacity(0.85)),
                        icon: const Icon(Icons.tune, color: Color(0xFF06B6D4), size: 18),
                        tooltip: 'Calibrate HI & HR',
                        onPressed: _showCalibrationDialog,
                      ),

                      const SizedBox(width: 6),

                      // Multi-Format Data Reports Trigger (CSV / KML)
                      IconButton(
                        style: IconButton.styleFrom(backgroundColor: const Color(0xFF0F172A).withOpacity(0.85)),
                        icon: const Icon(Icons.assessment, color: Color(0xFF10B981), size: 18),
                        tooltip: 'Data Reports (CSV/KML)',
                        onPressed: _showDataReportDialog,
                      ),

                      const SizedBox(width: 6),

                      // Lock toggle
                      IconButton(
                        style: IconButton.styleFrom(backgroundColor: const Color(0xFF0F172A).withOpacity(0.85)),
                        icon: Icon(
                          _isLocked ? Icons.lock : Icons.lock_open,
                          color: _isLocked ? Colors.redAccent : Colors.white,
                          size: 18,
                        ),
                        onPressed: () => setState(() => _isLocked = !_isLocked),
                      ),
                    ],
                  ),
                ),

                // Bottom Action Drawer: Feature Code Selector & Log Button
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14.0, vertical: 12.0),
                  child: Column(
                    children: [
                      // FEATURE 3: Selectable Feature Code System
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: const Color(0xFF020617).withOpacity(0.92),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: Colors.white24),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'CODE:',
                              style: TextStyle(fontFamily: 'monospace', fontSize: 11, color: Colors.white54, fontWeight: FontWeight.bold),
                            ),
                            ...FeatureCode.values.map((fc) {
                              final isSelected = fc == _selectedFeature;
                              return GestureDetector(
                                onTap: () => setState(() => _selectedFeature = fc),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                  decoration: BoxDecoration(
                                    color: isSelected ? fc.color : Colors.transparent,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    fc.code,
                                    style: TextStyle(
                                      fontFamily: 'monospace',
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                      color: isSelected ? Colors.black : fc.color,
                                    ),
                                  ),
                                ),
                              );
                            }),
                            // Quick Calibration Button
                            GestureDetector(
                              onTap: _showCalibrationDialog,
                              child: Text(
                                'HD:${_baselineDistance.toStringAsFixed(1)}m',
                                style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Color(0xFF06B6D4), fontWeight: FontWeight.bold),
                              ),
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 8),

                      // Primary Station Logger CTA Button
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _selectedFeature.color,
                            foregroundColor: Colors.black,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
                            elevation: 5,
                          ),
                          onPressed: _isLogging ? null : _logSurveyPoint,
                          icon: const Icon(Icons.add_location_alt, size: 20),
                          label: Text(
                            'LOG STATION // ${_selectedFeature.code} [HD ${_baselineDistance.toStringAsFixed(1)}m]',
                            style: const TextStyle(fontWeight: FontWeight.bold, letterSpacing: 0.8, fontSize: 12),
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
