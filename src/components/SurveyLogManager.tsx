import React, { useState } from 'react';
import { Database, Download, Trash2, MapPin, Search, Calendar, ChevronRight } from 'lucide-react';

export interface SurveyRecord {
  id: number;
  title: string;
  azimuth: number;
  pitch: number;
  roll: number;
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

  const filteredEntries = entries.filter(
    (e) =>
      e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.notes && e.notes.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const exportCSV = () => {
    if (entries.length === 0) return;
    const headers = [
      'ID',
      'Title',
      'Azimuth_deg',
      'Pitch_deg',
      'Roll_deg',
      'Latitude',
      'Longitude',
      'Altitude_m',
      'Accuracy_m',
      'Zoom',
      'Timestamp',
      'Notes',
    ];
    const rows = entries.map((e) => [
      e.id,
      `"${e.title}"`,
      e.azimuth.toFixed(2),
      e.pitch.toFixed(2),
      e.roll.toFixed(2),
      e.latitude.toFixed(6),
      e.longitude.toFixed(6),
      e.altitude.toFixed(1),
      e.accuracy.toFixed(1),
      e.zoomFactor.toFixed(1),
      `"${e.timestamp}"`,
      `"${e.notes || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `geosight_survey_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportGeoJSON = () => {
    if (entries.length === 0) return;
    const geojson = {
      type: 'FeatureCollection',
      features: entries.map((e) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [e.longitude, e.latitude, e.altitude],
        },
        properties: {
          id: e.id,
          title: e.title,
          azimuth: e.azimuth,
          pitch: e.pitch,
          roll: e.roll,
          accuracy: e.accuracy,
          zoomFactor: e.zoomFactor,
          notes: e.notes,
          timestamp: e.timestamp,
        },
      })),
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: 'application/geo+json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `geosight_survey_${Date.now()}.geojson`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
      {/* Table header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Database className="w-4 h-4 text-amber-500" />
            Survey Marks Database (SQLite Log)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {entries.length} logged field theodolite stations stored in SQLite schema.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            disabled={entries.length === 0}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-mono font-medium border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            Export CSV
          </button>
          <button
            onClick={exportGeoJSON}
            disabled={entries.length === 0}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-mono font-medium border border-slate-700 flex items-center gap-1.5 transition-colors"
          >
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            Export GeoJSON
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
          placeholder="Filter survey marks by title, notes, or coordinates..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/60 font-mono"
        />
      </div>

      {/* Data Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 font-mono text-[11px] border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">STATION ID</th>
                <th className="py-2.5 px-3">AZIMUTH</th>
                <th className="py-2.5 px-3">PITCH / ROLL</th>
                <th className="py-2.5 px-3">GNSS POSITION</th>
                <th className="py-2.5 px-3">ALTITUDE</th>
                <th className="py-2.5 px-3">TIMESTAMP</th>
                <th className="py-2.5 px-3 text-right">ACTION</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No survey records logged yet. Aim theodolite reticle and tap "Log Survey Station".
                  </td>
                </tr>
              ) : (
                filteredEntries.map((e) => (
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
                    <td className="py-2.5 px-3 tabular-nums font-bold text-slate-100">
                      {e.azimuth.toFixed(1)}°
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-300">
                      <span className="text-emerald-400">{e.pitch >= 0 ? '+' : ''}{e.pitch.toFixed(1)}°</span>
                      <span className="text-slate-500 mx-1.5">/</span>
                      <span className="text-cyan-400">{e.roll.toFixed(1)}°</span>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-400 text-[11px]">
                      {e.latitude.toFixed(5)}°, {e.longitude.toFixed(5)}°
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-slate-300">
                      {e.altitude.toFixed(1)}m
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                      {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-2.5 px-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                      <button
                        onClick={() => onDeleteEntry(e.id)}
                        className="p-1 text-slate-500 hover:text-red-400 rounded transition-colors"
                        title="Delete entry"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Selected Entry Detail drawer / inspection */}
      {selectedItem && (
        <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-300 font-semibold">
            <span className="text-amber-400 font-mono">{selectedItem.title} - Geodetic Station Inspection</span>
            <button
              onClick={() => setSelectedItem(null)}
              className="text-slate-500 hover:text-slate-300 text-xs font-mono"
            >
              [Close]
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] pt-1">
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">AZIMUTH (BEARING)</span>
              <span className="text-amber-400 font-bold">{selectedItem.azimuth.toFixed(2)}°</span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">ELEVATION (PITCH)</span>
              <span className="text-emerald-400 font-bold">{selectedItem.pitch.toFixed(2)}°</span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">HORIZON (ROLL)</span>
              <span className="text-cyan-400 font-bold">{selectedItem.roll.toFixed(2)}°</span>
            </div>
            <div className="p-2 bg-slate-900 rounded border border-slate-800">
              <span className="text-slate-500 block text-[9px]">OPTICAL ZOOM</span>
              <span className="text-white font-bold">{selectedItem.zoomFactor.toFixed(1)}x</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
