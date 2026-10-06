import 'dart:math' as math;
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
        String label = '${normalizedDeg.toInt()}°';
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
          '${deg > 0 ? "+" : ""}$deg°',
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
    _drawDataCell(canvas, 'BEARING', '${telemetry.azimuth.toStringAsFixed(1)}°', Offset(hudRect.left + 24, textY1));
    _drawDataCell(canvas, 'PITCH', '${telemetry.pitch >= 0 ? "+" : ""}${telemetry.pitch.toStringAsFixed(1)}°', Offset(hudRect.left + 110, textY1));
    _drawDataCell(canvas, 'ROLL', '${telemetry.roll.toStringAsFixed(1)}°', Offset(hudRect.left + 196, textY1));

    // Secondary Telemetry: GNSS Coordinates & Zoom
    final String latStr = latitude != null ? '${latitude!.toStringAsFixed(5)}°' : 'SEARCHING...';
    final String lonStr = longitude != null ? '${longitude!.toStringAsFixed(5)}°' : 'SEARCHING...';
    final String altStr = altitude != null ? '${altitude!.toStringAsFixed(1)} m' : '--';

    _drawDataCell(canvas, 'LATITUDE', latStr, Offset(hudRect.left + 24, textY2));
    _drawDataCell(canvas, 'LONGITUDE', lonStr, Offset(hudRect.left + 130, textY2));
    _drawDataCell(canvas, 'ELEVATION', altStr, Offset(hudRect.left + 236, textY2));
    _drawDataCell(canvas, 'OPTICS', '${zoomFactor.toStringAsFixed(1)}x', Offset(hudRect.right - 48, textY2));
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
