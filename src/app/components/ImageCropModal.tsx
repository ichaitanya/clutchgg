import { useEffect, useRef, useState, useCallback } from 'react';
import { X, ZoomIn, Check, RotateCcw } from 'lucide-react';

interface ImageCropModalProps {
  /** Object URL or data URL of the image to crop. */
  src: string;
  /** Output aspect ratio (width / height). Banner default is 2:1. */
  aspect?: number;
  /** Output width in px (height derived from aspect). */
  outputWidth?: number;
  onCancel: () => void;
  /** Receives the cropped image as a JPEG blob + an object URL for preview. */
  onCrop: (blob: Blob) => void;
}

// A dependency-free cover/banner cropper: the user pans (drag) and zooms (slider
// or wheel) the source image within a fixed-aspect viewport, then we render the
// visible region to a canvas at the target resolution. Output is a JPEG blob.
export function ImageCropModal({ src, aspect = 2, outputWidth = 1200, onCancel, onCrop }: ImageCropModalProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 }); // px offset of image top-left within viewport
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Measure the viewport and load the image to learn its natural size.
  useEffect(() => {
    const measure = () => {
      const el = viewportRef.current;
      if (!el) return;
      const w = el.clientWidth;
      setViewport({ w, h: w / aspect });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [aspect]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = src;
  }, [src]);

  // Once both viewport and image are known, compute the minimum zoom that still
  // covers the viewport (so there are never empty bars), and center the image.
  useEffect(() => {
    if (!imgDims || viewport.w === 0) return;
    const coverScale = Math.max(viewport.w / imgDims.w, viewport.h / imgDims.h);
    setMinZoom(coverScale);
    setZoom(coverScale);
    // Center: image displayed size at coverScale, then offset to center it.
    const dispW = imgDims.w * coverScale;
    const dispH = imgDims.h * coverScale;
    setOffset({ x: (viewport.w - dispW) / 2, y: (viewport.h - dispH) / 2 });
  }, [imgDims, viewport.w, viewport.h]);

  // Clamp the offset so the image always covers the viewport (no gaps).
  const clampOffset = useCallback((o: { x: number; y: number }, z: number) => {
    if (!imgDims) return o;
    const dispW = imgDims.w * z;
    const dispH = imgDims.h * z;
    const minX = viewport.w - dispW;
    const minY = viewport.h - dispH;
    return {
      x: Math.min(0, Math.max(minX, o.x)),
      y: Math.min(0, Math.max(minY, o.y)),
    };
  }, [imgDims, viewport.w, viewport.h]);

  const onZoomChange = (z: number) => {
    if (!imgDims) return;
    // Keep the viewport center anchored while zooming.
    const cx = viewport.w / 2;
    const cy = viewport.h / 2;
    const imgX = (cx - offset.x) / zoom;
    const imgY = (cy - offset.y) / zoom;
    const newOffset = { x: cx - imgX * z, y: cy - imgY * z };
    setZoom(z);
    setOffset(clampOffset(newOffset, z));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setOffset(clampOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy }, zoom));
  };
  const onPointerUp = () => { drag.current = null; };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(minZoom * 4, Math.max(minZoom, zoom * (e.deltaY < 0 ? 1.08 : 0.92)));
    onZoomChange(next);
  };

  const reset = () => {
    if (!imgDims) return;
    const cover = Math.max(viewport.w / imgDims.w, viewport.h / imgDims.h);
    setZoom(cover);
    const dispW = imgDims.w * cover;
    const dispH = imgDims.h * cover;
    setOffset({ x: (viewport.w - dispW) / 2, y: (viewport.h - dispH) / 2 });
  };

  const handleCrop = async () => {
    const img = imgRef.current;
    if (!img || !imgDims) return;
    setBusy(true);
    try {
      const outW = outputWidth;
      const outH = Math.round(outputWidth / aspect);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas context');
      // Map viewport-space to source-image-space. The visible image region's
      // top-left in source px is (-offset / zoom); its size is viewport / zoom.
      const srcX = -offset.x / zoom;
      const srcY = -offset.y / zoom;
      const srcW = viewport.w / zoom;
      const srcH = viewport.h / zoom;
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
      const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
      if (blob) onCrop(blob);
    } catch (err) {
      console.error('Crop failed', err);
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  // Displayed image size at current zoom (for the <img> transform).
  const dispW = imgDims ? imgDims.w * zoom : 0;
  const dispH = imgDims ? imgDims.h * zoom : 0;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-[#151821] border border-[#2a2d3a] rounded-xl w-full max-w-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <h2 className="text-white font-bold text-lg">Crop Banner</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500">Drag to reposition · scroll or use the slider to zoom. The banner is cropped to a 2:1 ratio.</p>

          {/* Crop viewport */}
          <div
            ref={viewportRef}
            className="relative w-full overflow-hidden rounded-lg bg-[#0d0f16] border border-[#2a2d3a] select-none touch-none cursor-grab active:cursor-grabbing"
            style={{ height: viewport.h || 200 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          >
            {imgDims && (
              <img
                src={src}
                alt="Crop preview"
                draggable={false}
                className="absolute max-w-none pointer-events-none"
                style={{ left: offset.x, top: offset.y, width: dispW, height: dispH }}
              />
            )}
            {/* Center framing guide */}
            <div className="absolute inset-0 pointer-events-none border border-white/10" />
          </div>

          {/* Zoom control */}
          <div className="flex items-center gap-3">
            <ZoomIn className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <input
              type="range"
              min={minZoom}
              max={minZoom * 4}
              step={(minZoom * 3) / 100 || 0.01}
              value={zoom}
              onChange={e => onZoomChange(parseFloat(e.target.value))}
              className="flex-1 accent-[#ff4655]"
            />
            <button
              onClick={reset}
              title="Reset"
              className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#2a2d3a]">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-[#2a2d3a] text-gray-400 text-sm hover:border-gray-500 hover:text-white transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleCrop}
            disabled={busy || !imgDims}
            className="flex-1 py-2.5 rounded-lg bg-[#ff4655] text-white text-sm font-semibold hover:bg-[#ff3344] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> {busy ? 'Cropping…' : 'Apply Crop'}
          </button>
        </div>
      </div>
    </div>
  );
}
