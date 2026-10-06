import React, { useState } from 'react';
import { FLUTTER_FILES, FlutterFile } from '../data/flutterCode';
import { Copy, Check, Download, FileCode, Layers, ShieldCheck, Terminal } from 'lucide-react';

export const FlutterCodeViewer: React.FC = () => {
  const [selectedFileId, setSelectedFileId] = useState<string>('sensor_service');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const currentFile = FLUTTER_FILES.find((f) => f.id === selectedFileId) || FLUTTER_FILES[0];

  const handleCopy = (file: FlutterFile) => {
    navigator.clipboard.writeText(file.code);
    setCopiedId(file.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleDownload = (file: FlutterFile) => {
    const blob = new Blob([file.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadAll = () => {
    FLUTTER_FILES.forEach((file) => {
      handleDownload(file);
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex flex-col">
      {/* Top File Selection Bar */}
      <div className="bg-slate-950 border-b border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* File tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {FLUTTER_FILES.map((file) => {
            const isActive = file.id === selectedFileId;
            return (
              <button
                key={file.id}
                onClick={() => setSelectedFileId(file.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                  isActive
                    ? 'bg-amber-500/15 border border-amber-500/50 text-amber-300'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <FileCode className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                <span>{file.filename}</span>
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleCopy(currentFile)}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-colors"
          >
            {copiedId === currentFile.id ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copied to Clipboard!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy {currentFile.filename}
              </>
            )}
          </button>
          <button
            onClick={() => handleDownload(currentFile)}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors"
            title={`Download ${currentFile.filename}`}
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* File meta description info banner */}
      <div className="px-5 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-slate-400 font-mono">
          <span className="text-amber-400 font-semibold">{currentFile.filepath}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400 text-[11px]">{currentFile.description}</span>
        </div>
        <span className="text-[11px] font-mono text-slate-500">
          {currentFile.code.split('\n').length} lines
        </span>
      </div>

      {/* Code Viewer Area with line numbering */}
      <div className="relative overflow-x-auto max-h-[640px] bg-slate-950 text-slate-200 font-mono text-xs p-4 selection:bg-amber-500/30 selection:text-amber-200">
        <pre className="leading-relaxed">
          <code>
            {currentFile.code.split('\n').map((line, idx) => (
              <div key={idx} className="table-row hover:bg-slate-900/60">
                <span className="table-cell select-none text-right pr-4 text-slate-600 w-10 text-[11px]">
                  {idx + 1}
                </span>
                <span className="table-cell whitespace-pre">{line}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>

      {/* Architecture & Engineering Guide Footer */}
      <div className="bg-slate-950 border-t border-slate-800 p-4 text-xs text-slate-400 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-1">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-500" />
            1. Sensor Fusion Pipeline
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Uses 3D orthogonal coordinate transformation $E = M \times G$, $N = G \times E$. Pitch & Roll are computed via $\arctan2$, then tilt-compensated azimuth is extracted in horizontal plane.
          </p>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            2. 60 FPS RepaintBoundary
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            `CameraOverlayView` isolates paint passes from the heavy camera texture tree. Paints, colors, and text spans are strictly cached to eliminate runtime GC thrashing.
          </p>
        </div>

        <div className="space-y-1">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            3. SQLite Logging
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Includes atomic transaction batching, foreign key enforcement, WAL mode PRAGMA, and timestamp indexes for instantaneous query times across thousands of survey marks.
          </p>
        </div>
      </div>
    </div>
  );
};
