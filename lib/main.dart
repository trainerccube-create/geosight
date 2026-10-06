import 'package:flutter/material.dart';
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
    debugPrint('Camera initialization error: $e');
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
      title: 'STATION_${DateTime.now().millisecondsSinceEpoch % 10000}',
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
          content: Text('Survey record saved! Az: ${entry.azimuth.toStringAsFixed(1)}°'),
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
