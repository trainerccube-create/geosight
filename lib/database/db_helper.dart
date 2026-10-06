import 'dart:async';
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
      CREATE TABLE $tableSurveyEntries (
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
      CREATE INDEX idx_survey_timestamp ON $tableSurveyEntries(timestamp DESC)
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
