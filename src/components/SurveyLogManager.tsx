import React, { useState } from 'react';
import {
  Database,
  Download,
  Trash2,
  MapPin,
  Search,
  Calendar,
  ChevronRight,
  FileText,
  Copy,
  Check,
  Globe,
  Sliders,
  Layers,
  Sparkles,
  X
} from 'lucide-react';

export interface SurveyRecord {
  id: number;
  title: string;
  featureCode?: 'BM' | 'BND' | 'TOPO' | 'UTIL';
  azimuth: number;
  pitch: number;
  roll: number;
  baselineDistance?: number;
  verticalDistance?: number;
  horizontalDistance?: number;
  slopeDistance?: number;
  instrumentHeight?: number; // HI
  targetHeight?: number;     // HR
  northing?: number;         // Local N offset (meters)
  easting?: number;          // Local E offset (meters)
  trueElevation?: number;    // True relative/absolute Z (meters)
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  zoomFactor: number;
  notes?: string;
  timestamp: string;
}

interface SurveyLogManagerProps {
  entries: SurveyRecord[];
  onDeleteEntry: (id: number) => void;
  onClearAll: () => void;
  onSelectEntry?: (entry: SurveyRecord) => void;
}

export const SurveyLogManager: React.FC<SurveyLogManagerProps> = ({
  entries,
  onDeleteEntry,
  onClearAll,
  onSelectEntry,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<SurveyRecord | null>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportTab, setReportTab] = useState<'csv' | 'kml'>('csv');
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  const filteredEntries = entries.filter(
    (e) =>
      e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.featureCode && e.featureCode.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.notes && e.notes.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Generate clean industry-grade CSV Structure
  const generateCSV = (): string => {
    const headers = [
      'Point_ID',
      'Feature_Code',
      'Northing_m',
      'Easting_m',
      'True_Elevation_m',
      'Latitude',
      'Longitude',
      'Time',
      'Azimuth_deg',
      'Pitch_deg',
      'Base_Dist_m',
      'Slope_Dist_m',
      'HI_m',
      'HR_m',
      'Notes',
    ];
    const rows = entries.map((e) => [
      e.id,
      `"${e.featureCode || 'TOPO'}"`,
      (e.northing ?? 0).toFixed(3),
      (e.easting ?? 0).toFixed(3),
      (e.trueElevation ?? e.altitude).toFixed(3),
      e.latitude.toFixed(7),
      e.longitude.toFixed(7),
      `"${e.timestamp}"`,
      e.azimuth.toFixed(2),
      e.pitch.toFixed(2),
      (e.baselineDistance ?? 0).toFixed(2),
      (e.slopeDistance ?? 0).toFixed(2),
      (e.instrumentHeight ?? 1.55).toFixed(2),
      (e.targetHeight ?? 1.60).toFixed(2),
      `"${(e.notes || '').replace(/"/g, '""')}"`,
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  };

  // Generate standard Google Earth KML geometric XML string
  const generateKML = (): string => {
    const placemarks = entries
      .map((e) => {
        const code = e.featureCode || 'TOPO';
        const elevation = (e.trueElevation ?? e.altitude).toFixed(2);
        const northing = (e.northing ?? 0).toFixed(2);
        const easting = (e.easting ?? 0).toFixed(2);
        const hi = (e.instrumentHeight ?? 1.55).toFixed(2);
        const hr = (e.targetHeight ?? 1.60).toFixed(2);

        return `    <Placemark>
      <name>Station #${e.id} [${code}]</name>
      <styleUrl>#style-${code.toLowerCase()}</styleUrl>
      <description><![CDATA[
        <h3>${e.title}</h3>
        <p><b>Feature Code:</b> ${code}</p>
        <p><b>Local Coordinates:</b> N: ${northing}m, E: ${easting}m, Z: ${elevation}m</p>
        <p><b>Aim Telemetry:</b> Azimuth: ${e.azimuth.toFixed(1)}°, Pitch: ${e.pitch.toFixed(1)}°</p>
        <p><b>Baseline:</b> ${(e.baselineDistance ?? 0).toFixed(1)}m (HI: ${hi}m, HR: ${hr}m)</p>
        <p><b>Time:</b> ${e.timestamp}</p>
        <p><b>Notes:</b> ${e.notes || 'None'}</p>
      ]]></description>
      <ExtendedData>
        <Data name="Point_ID"><value>${e.id}</value></Data>
        <Data name="Feature_Code"><value>${code}</value></Data>
        <Data name="Northing_m"><value>${northing}</value></Data>
        <Data name="Easting_m"><value>${easting}</value></Data>
        <Data name="True_Elevation_m"><value>${elevation}</value></Data>
        <Data name="HI_m"><value>${hi}</value></Data>
        <Data name="HR_m"><value>${hr}</value></Data>
      </ExtendedData>
      <Point>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${e.longitude.toFixed(7)},${e.latitude.toFixed(7)},${elevation}</coordinates>
      </Point>
    </Placemark>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>GeoSight Total Station Survey Export</name>
    <description>Total Station survey points with NEZ coordinates and feature code tags.</description>
    
    <!-- Feature Code Styles -->
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
    </Style>

${placemarks}
  </Document>
</kml>`;
  };

  const handleDownload = (format: 'csv' | 'kml') => {
    if (entries.length === 0) return;
    const content = format === 'csv' ? generateCSV() : generateKML();
    const mime = format === 'csv' ? 'text/csv;charset=utf-8;' : 'application/vnd.google-earth.kml+xml;charset=utf-8;';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `geosight_survey_${Date.now()}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopy = (format: 'csv' | 'kml') => {
    const text = format === 'csv' ? generateCSV() : generateKML();
    navigator.clipboard.writeText(text);
    setCopiedFormat(format);
    setTimeout(() => setCopiedFormat(null), 2500);
  };

  const getCodeBadge = (code?: string) => {
    switch (code) {
      case 'BM':
        return 'bg-amber-950/80 text-amber-400 border-amber-600/60';
      case 'BND':
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-600/60';
      case 'UTIL':
        return 'bg-purple-950/80 text-purple-400 border-purple-600/60';
      case 'TOPO':
      default:
        return 'bg-cyan-950/80 text-cyan-400 border-cyan-600/60';
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
      {/* Table header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-amber-500" />
            Survey Marks Database (SQLite & NEZ Grid)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {entries.length} logged field stations with calibrated HI/HR and local coordinate tracking.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsReportModalOpen(true)}
            className="px-3 py-1.5 bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 rounded-lg text-xs font-mono font-medium border border-cyan-700/80 flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            Report Engine (CSV / KML)
          </button>
          <button
            onClick={() => handleDownload('csv')}
            disabled={entries.length === 0}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-mono font-medium border border-slate-700 flex items-center gap-1 transition-colors"
            title="Instant CSV Download"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            CSV
          </button>
          <button
            onClick={() => handleDownload('kml')}
            disabled={entries.length === 0}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-mono font-medium border border-slate-700 flex items-center gap-1 transition-colors"
            title="Google Earth KML Download"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-400" />
            KML
          </button>
          {entries.length > 0 && (
            <button
              onClick={onClearAll}
              className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors"
              title="Clear Database"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
        <input
          type="text"
          placeholder="Filter survey marks by title, feature code (BM/BND/TOPO/UTIL), or notes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60 font-mono"
        />
      </div>

      {/* Desktop Data Table */}
      <div className="hidden md:block rounded-lg border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-mono text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">STATION ID</th>
                <th className="py-2.5 px-3">CODE</th>
                <th className="py-2.5 px-3">NORTHING (N)</th>
                <th className="py-2.5 px-3">EASTING (E)</th>
                <th className="py-2.5 px-3">ELEVATION (Z)</th>
                <th className="py-2.5 px-3">AZIMUTH / PITCH</th>
                <th className="py-2.5 px-3">BASE (HI/HR)</th>
                <th className="py-2.5 px-3 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No survey records logged yet. Aim theodolite reticle and tap "Log Station Point".
                  </td>
                </tr>
              ) : (
                filteredEntries.map((e) => {
                  const code = e.featureCode || 'TOPO';
                  const badgeClass = getCodeBadge(code);
                  return (
                    <tr
                      key={e.id}
                      className="hover:bg-slate-800/30 transition-colors cursor-pointer group"
                      onClick={() => {
                        setSelectedItem(e);
                        onSelectEntry?.(e);
                      }}
                    >
                      <td className="py-2.5 px-3 font-semibold text-amber-400">
                        {e.title}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeClass}`}>
                          {code}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 tabular-nums font-bold text-emerald-400">
                        {(e.northing ?? 0) >= 0 ? '+' : ''}
                        {(e.northing ?? 0).toFixed(2)}m
                      </td>
                      <td className="py-2.5 px-3 tabular-nums font-bold text-sky-400">
                        {(e.easting ?? 0) >= 0 ? '+' : ''}
                        {(e.easting ?? 0).toFixed(2)}m
                      </td>
                      <td className="py-2.5 px-3 tabular-nums font-bold text-amber-300">
                        {(e.trueElevation ?? e.altitude).toFixed(2)}m
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-slate-300">
                        <span className="text-white font-semibold">{e.azimuth.toFixed(1)}°</span>
                        <span className="text-slate-500 mx-1">/</span>
                        <span className="text-emerald-400">{e.pitch >= 0 ? '+' : ''}{e.pitch.toFixed(1)}°</span>
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-slate-400 text-[11px]">
                        <span>{(e.baselineDistance ?? 0).toFixed(1)}m</span>
                        <span className="text-slate-500 text-[9px] block">
                          HI:{(e.instrumentHeight ?? 1.55).toFixed(2)} HR:{(e.targetHeight ?? 1.60).toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                        <button
                          onClick={() => onDeleteEntry(e.id)}
                          className="p-1.5 text-slate-500 hover:text-red-400 rounded transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card List View (< 768px) */}
      <div className="md:hidden space-y-3">
        {filteredEntries.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs border border-slate-800 rounded-lg bg-slate-950/40">
            No survey records logged yet. Aim theodolite reticle and tap "Log Station Point".
          </div>
        ) : (
          filteredEntries.map((e) => {
            const code = e.featureCode || 'TOPO';
            const badgeClass = getCodeBadge(code);
            return (
              <div
                key={e.id}
                onClick={() => {
                  setSelectedItem(e);
                  onSelectEntry?.(e);
                }}
                className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-amber-500/40 transition-colors active:scale-[0.99]"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${badgeClass}`}>
                      {code}
                    </span>
                    <span className="font-mono font-bold text-amber-400 text-xs">{e.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-500">
                      {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onDeleteEntry(e.id);
                      }}
                      className="p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-500 hover:text-red-400 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2.5 font-mono text-[11px]">
                  <div className="p-2 bg-slate-900/80 rounded border border-slate-800/60">
                    <span className="text-[9px] text-slate-500 block">NORTHING (N)</span>
                    <span className="text-emerald-400 font-bold">
                      {(e.northing ?? 0) >= 0 ? '+' : ''}
                      {(e.northing ?? 0).toFixed(1)}m
                    </span>
                  </div>
                  <div className="p-2 bg-slate-900/80 rounded border border-slate-800/60">
                    <span className="text-[9px] text-slate-500 block">EASTING (E)</span>
                    <span className="text-sky-400 font-bold">
                      {(e.easting ?? 0) >= 0 ? '+' : ''}
                      {(e.easting ?? 0).toFixed(1)}m
                    </span>
                  </div>
                  <div className="p-2 bg-slate-900/80 rounded border border-slate-800/60">
                    <span className="text-[9px] text-slate-500 block">TRUE ELEV (Z)</span>
                    <span className="text-amber-400 font-bold">
                      {(e.trueElevation ?? e.altitude).toFixed(1)}m
                    </span>
                  </div>
                </div>

                <div className="mt-2 text-[10px] font-mono text-slate-400 flex items-center justify-between px-1">
                  <span>Az: {e.azimuth.toFixed(1)}° | Pitch: {e.pitch.toFixed(1)}°</span>
                  <span className="text-slate-300">Base: {(e.baselineDistance ?? 0).toFixed(1)}m</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Selected Entry Detail Drawer */}
      {selectedItem && (
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-300 font-semibold">
            <span className="text-amber-400 font-mono">
              {selectedItem.title} [{selectedItem.featureCode || 'TOPO'}] - Station Telemetry Inspector
            </span>
            <button
              onClick={() => setSelectedItem(null)}
              className="text-slate-500 hover:text-slate-300 text-xs font-mono"
            >
              [Close]
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] pt-1">
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">LOCAL NORTHING (N)</span>
              <span className="text-emerald-400 font-bold">
                {(selectedItem.northing ?? 0) >= 0 ? '+' : ''}
                {(selectedItem.northing ?? 0).toFixed(3)} m
              </span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">LOCAL EASTING (E)</span>
              <span className="text-sky-400 font-bold">
                {(selectedItem.easting ?? 0) >= 0 ? '+' : ''}
                {(selectedItem.easting ?? 0).toFixed(3)} m
              </span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">TRUE ELEVATION (Z)</span>
              <span className="text-amber-400 font-bold">
                {(selectedItem.trueElevation ?? selectedItem.altitude).toFixed(3)} m
              </span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">HI / HR CALIBRATION</span>
              <span className="text-white font-bold">
                {(selectedItem.instrumentHeight ?? 1.55).toFixed(2)}m / {(selectedItem.targetHeight ?? 1.60).toFixed(2)}m
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Format Data Report Engine Modal */}
      {isReportModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-mono text-xs">
            {/* Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="font-bold text-white text-sm">Multi-Format Spatial Data Report Engine</h3>
                  <p className="text-[10px] text-slate-400">Generate clean CSV and Google Earth KML geometric structures.</p>
                </div>
              </div>
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs & Controls */}
            <div className="p-3 bg-slate-900/40 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setReportTab('csv')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    reportTab === 'csv'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  CSV Data Table ({entries.length} rows)
                </button>
                <button
                  onClick={() => setReportTab('kml')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    reportTab === 'kml'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Google Earth KML ({entries.length} Placemarks)
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopy(reportTab)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-colors"
                >
                  {copiedFormat === reportTab ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied to Clipboard</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Copy {reportTab.toUpperCase()}</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleDownload(reportTab)}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-black font-bold rounded-lg text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download .{reportTab}
                </button>
              </div>
            </div>

            {/* Code / Report Preview Area */}
            <div className="p-4 flex-1 overflow-auto bg-slate-950 font-mono text-[11px] leading-relaxed text-slate-300">
              <pre className="whitespace-pre overflow-x-auto selection:bg-cyan-900 selection:text-white">
                {reportTab === 'csv' ? generateCSV() : generateKML()}
              </pre>
            </div>

            {/* Footer */}
            <div className="p-3 bg-slate-900/60 border-t border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
              <span>Standard: WGS84 Geodetic + Local NEZ Coordinate Projection</span>
              <span>Point Count: {entries.length} Stations</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
