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

/// ============================================================================
/// GEOSIGHT PROFESSIONAL TOTAL STATION & GEOSPATIAL FIELD SURVEYING SUITE
/// Unified Standalone Single-File Architecture (lib/main.dart)
/// ============================================================================

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);
  runApp(const GeoSightTotalStationApp());
}

/// Root Application Material Definition
class GeoSightTotalStationApp extends StatelessWidget {
  const GeoSightTotalStationApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'GeoSight Total Station',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF030712),
        primaryColor: const Color(0xFF06B6D4),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF06B6D4),
          secondary: Color(0xFFF59E0B),
          surface: Color(0xFF0F172A),
        ),
      ),
      home: const TotalStationScreen(),
    );
  }
}

/// ============================================================================
/// 1. FEATURE CODES & SPATIAL DATA STRUCTURES
/// ============================================================================

/// Industry Standard Survey Feature Classification Codes
enum FeatureCode {
  BM,   // Benchmark (Datum / Station Reference)
  BND,  // Boundary Marker (Property line / corner)
  TOPO, // Topography (Ground elevation / terrain)
  UTIL, // Utility Infrastructure (Pipes, poles, valves, pits)
}

extension FeatureCodeDetails on FeatureCode {
  String get code {
    switch (this) {
      case FeatureCode.BM:
        return 'BM';
      case FeatureCode.BND:
        return 'BND';
      case FeatureCode.TOPO:
        return 'TOPO';
      case FeatureCode.UTIL:
        return 'UTIL';
    }
  }

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
        return const Color(0xFFF59E0B); // Amber / Gold
      case FeatureCode.BND:
        return const Color(0xFF10B981); // Emerald Green
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

/// Tilt-compensated spatial orientation telemetry
class TelemetryData {
  final double azimuth;      // 0.0 to 359.99° (0° = Grid North, 90° = East)
  final double pitch;        // -90.0 to +90.0° (Vertical Angle)
  final double roll;         // -180.0 to +180.0° (Horizontal tilt / bank)
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

/// Total Station Trigonometric & Local Coordinate Transform Engine
class TotalStationTrig {
  final double baselineDistance; // Horizontal ground distance in meters (HD)
  final double pitchAngleDeg;     // Live pitch angle in degrees (theta)
  final double azimuthAngleDeg;   // Live azimuth angle in degrees (alpha)
  final double instrumentHeight;  // HI (meters from station ground to phone lens)
  final double targetHeight;      // HR (meters from ground to prism / target)
  final double stationElevation;  // Station datum elevation (Z0)

  TotalStationTrig({
    required this.baselineDistance,
    required this.pitchAngleDeg,
    required this.azimuthAngleDeg,
    this.instrumentHeight = 1.55,
    this.targetHeight = 1.60,
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

  /// Dynamic Local Coordinate System (NEZ Grid Offsets relative to Station Origin)
  /// Northing (N) = HD * cos(Azimuth)
  double get northingOffset => horizontalDistance * math.cos(azRad);

  /// Easting (E) = HD * sin(Azimuth)
  double get eastingOffset => horizontalDistance * math.sin(azRad);
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
/// 2. SENSOR FUSION ENGINE & LOW-PASS MATHEMATICAL FILTER
/// ============================================================================

class SensorFusionEngine {
  final double alpha; // Low-Pass Smoothing factor (0.05 to 0.35)
  StreamSubscription<AccelerometerEvent>? _accelSub;
  StreamSubscription<MagnetometerEvent>? _magSub;

  vmath.Vector3 _accel = vmath.Vector3(0, 0, 9.81);
  vmath.Vector3 _magnet = vmath.Vector3(0, 25, -40);

  double _smoothAzimuth = 0.0;
  double _smoothPitch = 0.0;
  double _smoothRoll = 0.0;

  final _controller = StreamController<TelemetryData>.broadcast();
  Stream<TelemetryData> get telemetryStream => _controller.stream;

  SensorFusionEngine({this.alpha = 0.18});

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

    // Live Euler Angle Extrapolation
    double rawPitch = math.asin(-g.y.clamp(-1.0, 1.0)) * (180.0 / math.pi);
    double rawRoll = math.atan2(g.x, g.z) * (180.0 / math.pi);
    double rawAzimuth = math.atan2(east.x, north.x) * (180.0 / math.pi);
    if (rawAzimuth < 0) rawAzimuth += 360.0;

    // Circular Shortest-Angular Distance Unwrapping across 0° <-> 360° boundary
    double azDelta = ((rawAzimuth - _smoothAzimuth + 180.0) % 360.0) - 180.0;
    if (azDelta < -180.0) azDelta += 360.0;

    _smoothAzimuth = (_smoothAzimuth + alpha * azDelta) % 360.0;
    if (_smoothAzimuth < 0) _smoothAzimuth += 360.0;

    // Linear EMA for Pitch and Roll
    _smoothPitch += alpha * (rawPitch - _smoothPitch);
    _smoothRoll += alpha * (rawRoll - _smoothRoll);

    _controller.add(
      TelemetryData(
        azimuth: _smoothAzimuth,
        pitch: _smoothPitch,
        roll: _smoothRoll,
        jitterDelta: azDelta.abs(),
        timestamp: DateTime.now(),
      ),
    );
  }
}

/// ============================================================================
/// 3. LOCAL SQLITE SURVEY DATABASE HELPER
/// ============================================================================

class StationDatabaseHelper {
  static final StationDatabaseHelper instance = StationDatabaseHelper._init();
  static Database? _database;

  StationDatabaseHelper._init();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDB('geosight_stations_nez.db');
    return _database!;
  }

  Future<Database> _initDB(String filePath) async {
    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, filePath);

    return await openDatabase(
      path,
      version: 2,
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
    final result = await db.query('survey_stations', orderBy: 'id DESC');
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
/// 4. MULTI-FORMAT DATA REPORT ENGINE (CSV & GOOGLE EARTH KML)
/// ============================================================================

class DataReportEngine {
  /// Robust Comma-Separated Values (CSV) Generation Engine
  static String generateCSV(List<SurveyStation> stations) {
    final StringBuffer sb = StringBuffer();
    // Standard industry CSV Header
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

  /// Clean Google Earth KML Geometric String Generation Engine
  static String generateKML(List<SurveyStation> stations) {
    final StringBuffer sb = StringBuffer();
    sb.writeln('<?xml version="1.0" encoding="UTF-8"?>');
    sb.writeln('<kml xmlns="http://www.opengis.net/kml/2.2">');
    sb.writeln('  <Document>');
    sb.writeln('    <name>GeoSight Total Station Spatial Survey</name>');
    sb.writeln('    <description>Total Station points with NEZ coordinates and feature classification.</description>');

    // Styles for BM, BND, TOPO, UTIL
    sb.writeln('''
    <Style id="style-bm">
      <IconStyle>
        <color>ff00aaff</color>
        <scale>1.2</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="style-bnd">
      <IconStyle>
        <color>ff00ff00</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/flag.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="style-topo">
      <IconStyle>
        <color>ffffaa00</color>
        <scale>1.0</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/triangle.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="style-util">
      <IconStyle>
        <color>ffff00aa</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon>
      </IconStyle>
    </Style>''');

    for (final s in stations) {
      final code = s.featureCode.code.toLowerCase();
      sb.writeln('''
    <Placemark>
      <name>Station #\${s.id ?? 0} [\${s.featureCode.code}]</name>
      <styleUrl>#style-\$code</styleUrl>
      <description><![CDATA[
        <h3>\${s.title}</h3>
        <p><b>Feature Code:</b> \${s.featureCode.code} (\${s.featureCode.label})</p>
        <p><b>Local Coordinates:</b> N: \${s.northing.toStringAsFixed(2)}m, E: \${s.easting.toStringAsFixed(2)}m, Z: \${s.trueElevation.toStringAsFixed(2)}m</p>
        <p><b>Aim:</b> Azimuth: \${s.azimuth.toStringAsFixed(1)}°, Pitch: \${s.pitch.toStringAsFixed(1)}°</p>
        <p><b>Baseline:</b> \${s.baselineDistance.toStringAsFixed(1)}m (HI: \${s.instrumentHeight.toStringAsFixed(2)}m, HR: \${s.targetHeight.toStringAsFixed(2)}m)</p>
        <p><b>Timestamp:</b> \${s.timestamp}</p>
        <p><b>Notes:</b> \${s.notes ?? 'None'}</p>
      ]]></description>
      <ExtendedData>
        <Data name="Point_ID"><value>\${s.id ?? 0}</value></Data>
        <Data name="Feature_Code"><value>\${s.featureCode.code}</value></Data>
        <Data name="Northing_m"><value>\${s.northing.toStringAsFixed(3)}</value></Data>
        <Data name="Easting_m"><value>\${s.easting.toStringAsFixed(3)}</value></Data>
        <Data name="True_Elevation_m"><value>\${s.trueElevation.toStringAsFixed(3)}</value></Data>
        <Data name="HI_m"><value>\${s.instrumentHeight.toStringAsFixed(2)}</value></Data>
        <Data name="HR_m"><value>\${s.targetHeight.toStringAsFixed(2)}</value></Data>
      </ExtendedData>
      <Point>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>\${s.longitude.toStringAsFixed(7)},\${s.latitude.toStringAsFixed(7)},\${s.trueElevation.toStringAsFixed(2)}</coordinates>
      </Point>
    </Placemark>''');
    }

    sb.writeln('  </Document>');
    sb.writeln('</kml>');
    return sb.toString();
  }
}

/// ============================================================================
/// 5. MODE A: CAMERA VIEWER OVERLAY CANVAS PAINTER
/// High-Contrast Reticle HUD + Live NEZ Coordinate Stream
/// ============================================================================

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
    _drawLiveNezStreamHUD(canvas, size);
    _drawTelemetryFooter(canvas, size);
  }

  void _drawOpticalBrackets(Canvas canvas, Size size, Color color) {
    final paint = Paint()
      ..color = color.withOpacity(0.8)
      ..strokeWidth = 1.6
      ..style = PaintingStyle.stroke;

    const double pad = 16.0;
    const double len = 22.0;

    // Top-Left
    canvas.drawLine(const Offset(pad, pad), const Offset(pad + len, pad), paint);
    canvas.drawLine(const Offset(pad, pad), const Offset(pad, pad + len), paint);

    // Top-Right
    canvas.drawLine(Offset(size.width - pad, pad), Offset(size.width - pad - len, pad), paint);
    canvas.drawLine(Offset(size.width - pad, pad), Offset(size.width - pad, pad + len), paint);

    // Bottom-Left
    canvas.drawLine(Offset(pad, size.height - pad), Offset(pad + len, size.height - pad), paint);
    canvas.drawLine(Offset(pad, size.height - pad), Offset(pad, size.height - pad - len), paint);

    // Bottom-Right
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

    const double lineLen = 130.0;
    const double gap = 45.0;

    // Left Wing
    canvas.drawLine(const Offset(-lineLen, 0), const Offset(-gap, 0), paint);
    canvas.drawLine(const Offset(-gap, 0), const Offset(-gap, 8), paint);

    // Right Wing
    canvas.drawLine(const Offset(gap, 0), const Offset(lineLen, 0), paint);
    canvas.drawLine(const Offset(gap, 0), const Offset(gap, 8), paint);

    canvas.restore();
  }

  void _drawPrecisionCrosshairs(Canvas canvas, Offset center, Color color) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.4
      ..style = PaintingStyle.stroke;

    // Reticle Center Rings
    canvas.drawCircle(center, 28, paint);
    canvas.drawCircle(center, 3.0, Paint()..color = color..style = PaintingStyle.fill);

    // Stadia Crosshairs
    const double armLen = 70.0;
    const double gap = 34.0;

    canvas.drawLine(Offset(center.dx - armLen, center.dy), Offset(center.dx - gap, center.dy), paint);
    canvas.drawLine(Offset(center.dx + gap, center.dy), Offset(center.dx + armLen, center.dy), paint);
    canvas.drawLine(Offset(center.dx, center.dy - armLen), Offset(center.dx, center.dy - gap), paint);
    canvas.drawLine(Offset(center.dx, center.dy + gap), Offset(center.dx, center.dy + armLen), paint);

    // 100:1 Stadia Mil-Ticks
    for (double d in [45.0, 58.0]) {
      canvas.drawLine(Offset(center.dx - d, center.dy - 3), Offset(center.dx - d, center.dy + 3), paint);
      canvas.drawLine(Offset(center.dx + d, center.dy - 3), Offset(center.dx + d, center.dy + 3), paint);
      canvas.drawLine(Offset(center.dx - 3, center.dy - d), Offset(center.dx + 3, center.dy - d), paint);
      canvas.drawLine(Offset(center.dx - 3, center.dy + d), Offset(center.dx + 3, center.dy + d), paint);
    }
  }

  void _drawAzimuthTape(Canvas canvas, Size size, Color accent) {
    const double tapeY = 48.0;
    final double centerX = size.width / 2;
    const double pxPerDeg = 6.0;
    const double halfW = 120.0;

    final bgRect = Rect.fromCenter(center: Offset(centerX, tapeY), width: halfW * 2 + 16, height: 30);
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
          Offset(x, tapeY + 11),
          fontSize: isCard ? 10 : 8,
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
    const double halfH = 90.0;

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
          fontSize: 8,
          color: Colors.white70,
          align: TextAlign.right,
        );
      }
    }

    // Pitch center pip
    canvas.drawLine(
      Offset(ladderX - 16, centerY),
      Offset(ladderX, centerY),
      Paint()..color = accent..strokeWidth = 2.0,
    );
  }

  /// Live High-Contrast NEZ Coordinate Stream HUD
  void _drawLiveNezStreamHUD(Canvas canvas, Size size) {
    const double topY = 70.0;
    const double pad = 12.0;
    final double w = size.width - pad * 2;

    // Background Container
    final hudRect = Rect.fromLTWH(pad, topY, w, 54.0);
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

    // Feature Code Badge
    final badgeRect = Rect.fromLTWH(pad + 8, topY + 8, 42, 18);
    canvas.drawRRect(
      RRect.fromRectAndRadius(badgeRect, const Radius.circular(4)),
      Paint()..color = featureCode.color.withOpacity(0.2),
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(badgeRect, const Radius.circular(4)),
      Paint()
        ..color = featureCode.color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.0,
    );
    _drawText(
      canvas,
      featureCode.code,
      Offset(pad + 29, topY + 17),
      fontSize: 9,
      isBold: true,
      color: featureCode.color,
    );

    // Live NEZ Coordinates
    final n = trig.northingOffset;
    final e = trig.eastingOffset;
    final z = trig.trueTargetElevation;
    final dz = trig.trueElevationDelta;

    final String nStr = 'N: \${n >= 0 ? '+' : ''}\${n.toStringAsFixed(2)}m';
    final String eStr = 'E: \${e >= 0 ? '+' : ''}\${e.toStringAsFixed(2)}m';
    final String zStr = 'Z: \${z.toStringAsFixed(2)}m (ΔZ: \${dz >= 0 ? '+' : ''}\${dz.toStringAsFixed(2)}m)';

    _drawText(
      canvas,
      nStr,
      Offset(pad + 58, topY + 17),
      fontSize: 10,
      isBold: true,
      color: const Color(0xFF10B981),
      align: TextAlign.left,
    );

    _drawText(
      canvas,
      eStr,
      Offset(pad + w * 0.52, topY + 17),
      fontSize: 10,
      isBold: true,
      color: const Color(0xFF38BDF8),
      align: TextAlign.left,
    );

    // Second Row: Elevation & Instrument Calibration
    _drawText(
      canvas,
      zStr,
      Offset(pad + 10, topY + 38),
      fontSize: 10,
      isBold: true,
      color: const Color(0xFFFBBF24),
      align: TextAlign.left,
    );

    final String calibStr = 'BASE:\${trig.baselineDistance.toStringAsFixed(1)}m | HI:\${trig.instrumentHeight.toStringAsFixed(2)}m HR:\${trig.targetHeight.toStringAsFixed(2)}m';
    _drawText(
      canvas,
      calibStr,
      Offset(pad + w - 10, topY + 38),
      fontSize: 8.5,
      color: Colors.white70,
      align: TextAlign.right,
    );
  }

  void _drawTelemetryFooter(Canvas canvas, Size size) {
    const double h = 34.0;
    final double y = size.height - h - 12.0;
    const double pad = 12.0;

    final bgRect = Rect.fromLTWH(pad, y, size.width - pad * 2, h);
    canvas.drawRRect(
      RRect.fromRectAndRadius(bgRect, const Radius.circular(6)),
      Paint()..color = const Color(0xFF030712).withOpacity(0.90),
    );

    final String lat = position != null ? position!.latitude.toStringAsFixed(5) : '37.77492';
    final String lon = position != null ? position!.longitude.toStringAsFixed(5) : '-122.41941';

    _drawText(
      canvas,
      'AZ: \${telemetry.azimuth.toStringAsFixed(1)}° | PITCH: \${telemetry.pitch.toStringAsFixed(1)}°',
      Offset(pad + 10, y + 17),
      fontSize: 9.5,
      isBold: true,
      color: const Color(0xFF06B6D4),
      align: TextAlign.left,
    );

    _drawText(
      canvas,
      'GNSS: \$lat°, \$lon° [RTK FIX]',
      Offset(size.width - pad - 10, y + 17),
      fontSize: 8.5,
      color: const Color(0xFF10B981),
      align: TextAlign.right,
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

/// ============================================================================
/// 6. MODE B: 2D RADAR CANVAS PLOTTER
/// Relative Local NEZ Grid Visualizer with Aiming Vector & Feature Markers
/// ============================================================================

class RadarGridPlotterPainter extends CustomPainter {
  final List<SurveyStation> stations;
  final TelemetryData telemetry;
  final TotalStationTrig trig;
  final FeatureCode activeFeatureCode;
  final double zoomScale;

  RadarGridPlotterPainter({
    required this.stations,
    required this.telemetry,
    required this.trig,
    required this.activeFeatureCode,
    this.zoomScale = 1.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);

    // Dark Radar background
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), Paint()..color = const Color(0xFF030712));

    // Dynamic Scale Calculation (fit max distance within 40% of canvas)
    double maxDist = trig.baselineDistance;
    for (final s in stations) {
      final d = math.sqrt(s.northing * s.northing + s.easting * s.easting);
      if (d > maxDist) maxDist = d;
    }
    if (maxDist < 25) maxDist = 25;

    final double basePpm = (math.min(size.width, size.height) * 0.4) / maxDist;
    final double ppm = basePpm * zoomScale; // Pixels per meter

    // Concentric Range Rings (10m, 20m, 30m, 50m intervals)
    double interval = 10.0;
    if (maxDist / zoomScale > 80) interval = 25.0;
    if (maxDist / zoomScale > 150) interval = 50.0;

    for (int i = 1; i <= 6; i++) {
      final double rMeters = i * interval;
      final double rPixels = rMeters * ppm;
      if (rPixels > math.max(size.width, size.height)) break;

      canvas.drawCircle(
        center,
        rPixels,
        Paint()
          ..color = (i % 2 == 0 ? const Color(0xFF06B6D4) : const Color(0xFF334155)).withOpacity(0.3)
          ..strokeWidth = (i % 2 == 0 ? 1.2 : 0.8)
          ..style = PaintingStyle.stroke,
      );

      // Distance Ring Label along North Axis
      _drawText(
        canvas,
        '\${rMeters.toInt()}m',
        Offset(center.dx + 4, center.dy - rPixels + 8),
        fontSize: 8,
        color: const Color(0xFF06B6D4).withOpacity(0.7),
        align: TextAlign.left,
      );
    }

    // Cross Axes: Northing (Y) & Easting (X)
    final axisPaint = Paint()
      ..color = Colors.white24
      ..strokeWidth = 1.0;

    canvas.drawLine(Offset(0, center.dy), Offset(size.width, center.dy), axisPaint);
    canvas.drawLine(Offset(center.dx, 0), Offset(center.dx, size.height), axisPaint);

    // Cardinal Labels
    _drawText(canvas, 'N (+Northing)', Offset(center.dx, 16), fontSize: 10, isBold: true, color: const Color(0xFF06B6D4));
    _drawText(canvas, 'S (-Northing)', Offset(center.dx, size.height - 16), fontSize: 10, isBold: true, color: const Color(0xFF06B6D4));
    _drawText(canvas, 'E (+Easting)', Offset(size.width - 45, center.dy - 8), fontSize: 9, isBold: true, color: const Color(0xFF06B6D4));
    _drawText(canvas, 'W (-Easting)', Offset(45, center.dy - 8), fontSize: 9, isBold: true, color: const Color(0xFF06B6D4));

    // Center Station Instrument Datum Monument (0, 0)
    canvas.drawCircle(center, 5.0, Paint()..color = const Color(0xFFF59E0B));
    canvas.drawCircle(center, 8.0, Paint()..color = Colors.white..style = PaintingStyle.stroke..strokeWidth = 1.5);
    _drawText(canvas, 'STATION (0,0)', Offset(center.dx + 12, center.dy + 12), fontSize: 8.5, isBold: true, color: const Color(0xFFF59E0B), align: TextAlign.left);

    // Live Aiming Line of Sight (LOS) Vector
    final liveTargetX = center.dx + trig.eastingOffset * ppm;
    final liveTargetY = center.dy - trig.northingOffset * ppm;

    // Draw Aiming Vector Line
    canvas.drawLine(
      center,
      Offset(liveTargetX, liveTargetY),
      Paint()
        ..color = const Color(0xFFEF4444).withOpacity(0.8)
        ..strokeWidth = 1.5,
    );

    // Live Aiming Target Reticle on Radar
    canvas.drawCircle(
      Offset(liveTargetX, liveTargetY),
      8.0,
      Paint()..color = const Color(0xFFEF4444).withOpacity(0.3),
    );
    canvas.drawCircle(
      Offset(liveTargetX, liveTargetY),
      5.0,
      Paint()
        ..color = const Color(0xFFEF4444)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.8,
    );
    _drawText(
      canvas,
      'AIM [\${activeFeatureCode.code}]',
      Offset(liveTargetX + 10, liveTargetY - 10),
      fontSize: 8,
      isBold: true,
      color: const Color(0xFFEF4444),
      align: TextAlign.left,
    );

    // Plot all Logged Station Points
    for (final s in stations) {
      final ptX = center.dx + s.easting * ppm;
      final ptY = center.dy - s.northing * ppm;

      // Connecting ray from station (faint)
      canvas.drawLine(
        center,
        Offset(ptX, ptY),
        Paint()
          ..color = s.featureCode.color.withOpacity(0.25)
          ..strokeWidth = 0.8,
      );

      // Distinct Marker per Feature Code
      final markerPaint = Paint()..color = s.featureCode.color;
      const double mSize = 5.0;

      if (s.featureCode == FeatureCode.BM) {
        // Diamond
        final path = Path()
          ..moveTo(ptX, ptY - mSize)
          ..lineTo(ptX + mSize, ptY)
          ..lineTo(ptX, ptY + mSize)
          ..lineTo(ptX - mSize, ptY)
          ..close();
        canvas.drawPath(path, markerPaint);
      } else if (s.featureCode == FeatureCode.BND) {
        // Square
        canvas.drawRect(Rect.fromCenter(center: Offset(ptX, ptY), width: mSize * 2, height: mSize * 2), markerPaint);
      } else if (s.featureCode == FeatureCode.UTIL) {
        // Triangle
        final path = Path()
          ..moveTo(ptX, ptY - mSize)
          ..lineTo(ptX + mSize, ptY + mSize)
          ..lineTo(ptX - mSize, ptY + mSize)
          ..close();
        canvas.drawPath(path, markerPaint);
      } else {
        // Circle (TOPO)
        canvas.drawCircle(Offset(ptX, ptY), mSize, markerPaint);
      }

      // Border around marker
      canvas.drawCircle(Offset(ptX, ptY), mSize + 2, Paint()..color = Colors.white..style = PaintingStyle.stroke..strokeWidth = 1.0);

      // Label Pill
      final String lbl = '#\${s.id ?? 0} \${s.featureCode.code} (Z:\${s.trueElevation.toStringAsFixed(1)}m)';
      _drawText(
        canvas,
        lbl,
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
  bool shouldRepaint(covariant RadarGridPlotterPainter oldDelegate) => true;
}

/// ============================================================================
/// 7. PRIMARY TOTAL STATION USER INTERFACE SCREEN
/// Dual Mode (Mode A: Camera HUD | Mode B: 2D Radar Plotter)
/// ============================================================================

class TotalStationScreen extends StatefulWidget {
  const TotalStationScreen({super.key});

  @override
  State<TotalStationScreen> createState() => _TotalStationScreenState();
}

class _TotalStationScreenState extends State<TotalStationScreen> {
  // Mode Toggle: false = Mode A (Camera HUD), true = Mode B (2D Radar Plotter)
  bool _isRadarMode = false;

  // Camera & Sensor State
  CameraController? _cameraController;
  late final SensorFusionEngine _sensorEngine;
  TelemetryData _telemetry = TelemetryData.initial();
  Position? _currentPosition;
  bool _isTargetLocked = false;
  double _zoomFactor = 1.0;

  // Total Station Spatial Parameters
  double _baselineDistance = 25.0; // Ground Distance (meters)
  double _instrumentHeight = 1.55; // HI (phone lens height from ground)
  double _targetHeight = 1.60;     // HR (reflector / stadia rod height)
  double _stationDatumElevation = 100.0; // Local benchmark reference datum

  // Feature Code selection
  FeatureCode _selectedFeatureCode = FeatureCode.TOPO;

  // Radar Zoom Scale
  double _radarZoom = 1.0;

  // Database of logged stations
  List<SurveyStation> _loggedStations = [];
  bool _isLogging = false;

  @override
  void initState() {
    super.initState();
    _sensorEngine = SensorFusionEngine(alpha: 0.18);
    _sensorEngine.telemetryStream.listen((data) {
      if (!_isTargetLocked && mounted) {
        setState(() => _telemetry = data);
      }
    });
    _sensorEngine.start();

    _initCamera();
    _initLocation();
    _loadStoredStations();

    // Trigger First-Time User Tutorial Dialog
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _showOnboardingTutorialDialog();
    });
  }

  @override
  void dispose() {
    _sensorEngine.stop();
    _cameraController?.dispose();
    super.dispose();
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
    if (mounted) setState(() => _loggedStations = stations);
  }

  TotalStationTrig get _currentTrig => TotalStationTrig(
        baselineDistance: _baselineDistance,
        pitchAngleDeg: _telemetry.pitch,
        azimuthAngleDeg: _telemetry.azimuth,
        instrumentHeight: _instrumentHeight,
        targetHeight: _targetHeight,
        stationElevation: _currentPosition?.altitude ?? _stationDatumElevation,
      );

  Future<void> _logSurveyStation() async {
    setState(() => _isLogging = true);
    final trig = _currentTrig;
    final nextId = _loggedStations.isEmpty ? 1 : (_loggedStations.first.id ?? 0) + 1;

    final station = SurveyStation(
      title: 'STATION_\${nextId.toString().padLeft(3, '0')}',
      featureCode: _selectedFeatureCode,
      azimuth: _telemetry.azimuth,
      pitch: _telemetry.pitch,
      roll: _telemetry.roll,
      baselineDistance: _baselineDistance,
      instrumentHeight: _instrumentHeight,
      targetHeight: _targetHeight,
      northing: trig.northingOffset,
      easting: trig.eastingOffset,
      trueElevation: trig.trueTargetElevation,
      rawVerticalDistance: trig.rawVerticalDistance,
      horizontalDistance: trig.horizontalDistance,
      slopeDistance: trig.slopeDistance,
      latitude: _currentPosition?.latitude ?? 37.774929,
      longitude: _currentPosition?.longitude ?? -122.419416,
      altitude: _currentPosition?.altitude ?? _stationDatumElevation,
      accuracy: _currentPosition?.accuracy ?? 0.05,
      zoomFactor: _zoomFactor,
      notes: 'Total Station Shot: N \${trig.northingOffset.toStringAsFixed(2)}m, E \${trig.eastingOffset.toStringAsFixed(2)}m',
      timestamp: DateTime.now(),
    );

    await StationDatabaseHelper.instance.insertStation(station);
    await _loadStoredStations();
    setState(() => _isLogging = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Station Logged: N \${trig.northingOffset.toStringAsFixed(2)}m, E \${trig.eastingOffset.toStringAsFixed(2)}m [#\${station.featureCode.code}]'),
          backgroundColor: const Color(0xFF0F172A),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// First-Time Surveyor Onboarding Tutorial Dialog
  void _showOnboardingTutorialDialog() {
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.architecture, color: Color(0xFF06B6D4)),
            SizedBox(width: 8),
            Text('Total Station Guide', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('1. Crosshair Alignment: Sight target via crosshairs and artificial horizon.', style: TextStyle(fontSize: 12, height: 1.4)),
            SizedBox(height: 8),
            Text('2. Calibration (HI / HR): Tap the Calibrate button to configure Instrument Height (HI) and Reflector/Target Height (HR).', style: TextStyle(fontSize: 12, height: 1.4)),
            SizedBox(height: 8),
            Text('3. Local NEZ Grid: Real-time Northing, Easting, and Elevation compute automatically relative to your station.', style: TextStyle(fontSize: 12, height: 1.4)),
            SizedBox(height: 8),
            Text('4. Dual Mode HUD: Toggle between Camera Reticle HUD and 2D Radar Canvas Plotter anytime.', style: TextStyle(fontSize: 12, height: 1.4)),
          ],
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF06B6D4), foregroundColor: Colors.black),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Start Surveying', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  /// Interactive Instrument Calibration & Base Distance Dialog
  void _showCalibrationDialog() {
    final baseCtrl = TextEditingController(text: _baselineDistance.toStringAsFixed(1));
    final hiCtrl = TextEditingController(text: _instrumentHeight.toStringAsFixed(2));
    final hrCtrl = TextEditingController(text: _targetHeight.toStringAsFixed(2));

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF0F172A),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Instrument Calibration', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: baseCtrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Base Ground Distance (m)', suffixText: 'meters'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: hiCtrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Instrument Height (HI)', suffixText: 'meters'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: hrCtrl,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Reflector/Target Height (HR)', suffixText: 'meters'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF06B6D4), foregroundColor: Colors.black),
            onPressed: () {
              setState(() {
                _baselineDistance = double.tryParse(baseCtrl.text) ?? _baselineDistance;
                _instrumentHeight = double.tryParse(hiCtrl.text) ?? _instrumentHeight;
                _targetHeight = double.tryParse(hrCtrl.text) ?? _targetHeight;
              });
              Navigator.pop(ctx);
            },
            child: const Text('Apply Calibration', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  /// Multi-Format Spatial Data Report Modal (CSV & KML)
  void _showDataReportDialog() {
    showDialog(
      context: context,
      builder: (ctx) => DefaultTabController(
        length: 2,
        child: AlertDialog(
          backgroundColor: const Color(0xFF0F172A),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('Spatial Report Engine', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          content: SizedBox(
            width: double.maxFinite,
            height: 380,
            child: Column(
              children: [
                const TabBar(
                  tabs: [
                    Tab(icon: Icon(Icons.table_chart, size: 18), text: 'CSV Format'),
                    Tab(icon: Icon(Icons.public, size: 18), text: 'Google Earth KML'),
                  ],
                ),
                Expanded(
                  child: TabBarView(
                    children: [
                      // CSV Preview
                      SingleChildScrollView(
                        child: SelectableText(
                          DataReportEngine.generateCSV(_loggedStations),
                          style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.white70),
                        ),
                      ),
                      // KML Preview
                      SingleChildScrollView(
                        child: SelectableText(
                          DataReportEngine.generateKML(_loggedStations),
                          style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Colors.white70),
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
              label: const Text('Copy CSV'),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: DataReportEngine.generateCSV(_loggedStations)));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('CSV Copied to Clipboard')));
              },
            ),
            TextButton.icon(
              icon: const Icon(Icons.copy, size: 16),
              label: const Text('Copy KML'),
              onPressed: () {
                Clipboard.setData(ClipboardData(text: DataReportEngine.generateKML(_loggedStations)));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('KML Copied to Clipboard')));
              },
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF06B6D4), foregroundColor: Colors.black),
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Close'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final trig = _currentTrig;

    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF030712),
        elevation: 0,
        title: Row(
          children: [
            const Text('GEOSIGHT', style: TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, fontSize: 15, color: Color(0xFF06B6D4))),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withOpacity(0.15),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: const Color(0xFF10B981).withOpacity(0.4)),
              ),
              child: const Text('RTK FIX', style: TextStyle(fontSize: 9, fontFamily: 'monospace', color: Color(0xFF10B981), fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        actions: [
          // Dual Mode Toggle: Camera vs 2D Radar Plotter
          IconButton(
            icon: Icon(_isRadarMode ? Icons.camera_alt : Icons.radar, color: const Color(0xFF06B6D4)),
            tooltip: _isRadarMode ? 'Switch to Camera HUD' : 'Switch to 2D Radar Plotter',
            onPressed: () => setState(() => _isRadarMode = !_isRadarMode),
          ),
          // Calibration dialog
          IconButton(
            icon: const Icon(Icons.tune, color: Color(0xFFF59E0B)),
            tooltip: 'Calibrate HI / HR',
            onPressed: _showCalibrationDialog,
          ),
          // Export report engine
          IconButton(
            icon: const Icon(Icons.file_download, color: Color(0xFF10B981)),
            tooltip: 'Export CSV / KML',
            onPressed: _showDataReportDialog,
          ),
        ],
      ),
      body: Column(
        children: [
          // Top Feature Code Selector Row
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            color: const Color(0xFF0F172A),
            child: Row(
              children: [
                const Text('CODE: ', style: TextStyle(fontFamily: 'monospace', fontSize: 11, fontWeight: FontWeight.bold, color: Colors.white70)),
                Expanded(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: FeatureCode.values.map((fc) {
                      final isSel = _selectedFeatureCode == fc;
                      return ChoiceChip(
                        label: Text(fc.code, style: TextStyle(fontFamily: 'monospace', fontSize: 10, fontWeight: FontWeight.bold, color: isSel ? Colors.black : fc.color)),
                        selected: isSel,
                        selectedColor: fc.color,
                        backgroundColor: const Color(0xFF030712),
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

          // Main Viewport: Mode A (Camera + HUD) or Mode B (2D Radar Canvas Plotter)
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (!_isRadarMode) ...[
                  // Mode A: Camera Live Stream
                  if (_cameraController != null && _cameraController!.value.isInitialized)
                    CameraPreview(_cameraController!)
                  else
                    Container(color: Colors.black, child: const Center(child: Text('Simulated Optical Field View', style: TextStyle(color: Colors.white54, fontFamily: 'monospace')))),

                  // HUD Canvas Layer
                  CustomPaint(
                    painter: TheodoliteHudPainter(
                      telemetry: _telemetry,
                      trig: trig,
                      featureCode: _selectedFeatureCode,
                      isTargetLocked: _isTargetLocked,
                      position: _currentPosition,
                    ),
                  ),
                ] else ...[
                  // Mode B: Interactive 2D Radar Canvas Plotter
                  CustomPaint(
                    painter: RadarGridPlotterPainter(
                      stations: _loggedStations,
                      telemetry: _telemetry,
                      trig: trig,
                      activeFeatureCode: _selectedFeatureCode,
                      zoomScale: _radarZoom,
                    ),
                  ),

                  // Radar Zoom Controls overlay
                  Positioned(
                    top: 12,
                    right: 12,
                    child: Column(
                      children: [
                        IconButton.filledTonal(
                          icon: const Icon(Icons.zoom_in, size: 20),
                          onPressed: () => setState(() => _radarZoom = math.min(3.5, _radarZoom * 1.25)),
                        ),
                        const SizedBox(height: 6),
                        IconButton.filledTonal(
                          icon: const Icon(Icons.zoom_out, size: 20),
                          onPressed: () => setState(() => _radarZoom = math.max(0.4, _radarZoom / 1.25)),
                        ),
                      ],
                    ),
                  ),
                ],

                // Bottom Interactive Controls & Logging Action
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 12,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Quick Calibration & Angle Lock Row
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                backgroundColor: const Color(0xFF030712).withOpacity(0.85),
                                foregroundColor: const Color(0xFF06B6D4),
                                side: const BorderSide(color: Color(0xFF06B6D4)),
                              ),
                              onPressed: _showCalibrationDialog,
                              icon: const Icon(Icons.straighten, size: 16),
                              label: Text('BASE: \${_baselineDistance.toStringAsFixed(1)}m (HI:\${_instrumentHeight.toStringAsFixed(2)})', style: const TextStyle(fontSize: 11, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
                            ),
                          ),
                          const SizedBox(width: 8),
                          IconButton.filled(
                            style: IconButton.styleFrom(
                              backgroundColor: _isTargetLocked ? const Color(0xFFEF4444) : const Color(0xFF0F172A),
                            ),
                            icon: Icon(_isTargetLocked ? Icons.lock : Icons.lock_open, size: 18),
                            onPressed: () => setState(() => _isTargetLocked = !_isTargetLocked),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),

                      // Primary Mark Logger Button
                      SizedBox(
                        width: double.infinity,
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
                            'LOG STATION POINT [\${_selectedFeatureCode.code}]',
                            style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.bold, letterSpacing: 1),
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
    description: 'Unified single-file Flutter Total Station surveying app with Instrument Height calibration (HI/HR), local NEZ grid coordinate system, Feature Code library (BM/BND/TOPO/UTIL), Dual Mode HUD (Camera vs 2D Radar Canvas Plotter), and multi-format CSV/KML report engine.',
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
