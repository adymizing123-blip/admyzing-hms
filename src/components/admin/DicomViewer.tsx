'use client';
import { useEffect, useRef, useState } from 'react';
import { Contrast, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Spinner, Alert } from '@/components/ui';

/**
 * Lightweight DICOM viewer for uploaded images (X-ray, CT/MR slices, ultrasound frames).
 * Supports uncompressed images (8/16-bit grayscale, 8-bit RGB, multi-frame). Drag = window/level, wheel = zoom.
 * Compressed transfer syntaxes (JPEG, JPEG 2000, RLE) need a full PACS viewer.
 */
const UNCOMPRESSED = ['1.2.840.10008.1.2', '1.2.840.10008.1.2.1'];

export default function DicomViewer({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<any>(null);
  const [frame, setFrame] = useState(0);
  const [wl, setWl] = useState({ c: 0, w: 1 });
  const [zoom, setZoom] = useState(1);
  const [invert, setInvert] = useState(false);
  const [err, setErr] = useState('');
  const drag = useRef<{ x: number; y: number; c: number; w: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const dicomParser = (await import('dicom-parser')).default || (await import('dicom-parser'));
        const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const ds = dicomParser.parseDicom(buf);
        const ts = ds.string('x00020010') || '1.2.840.10008.1.2.1';
        if (!UNCOMPRESSED.includes(ts)) throw new Error(`This image is compressed (transfer syntax ${ts}). Open it in your PACS / radiology viewer.`);
        const rows = ds.uint16('x00280010'), cols = ds.uint16('x00280011');
        const bits = ds.uint16('x00280100'), spp = ds.uint16('x00280002') || 1;
        const signed = ds.uint16('x00280103') === 1;
        const frames = Number(ds.string('x00280008') || 1);
        const el = ds.elements.x7fe00010;
        if (!el) throw new Error('No image data in this file');
        const slope = Number(ds.string('x00281053') || 1), intercept = Number(ds.string('x00281052') || 0);
        const frameLen = rows * cols * spp;
        const getFrame = (n: number) => {
          if (bits === 16) {
            const arr = signed ? new Int16Array(buf.buffer, el.dataOffset + n * frameLen * 2, frameLen) : new Uint16Array(buf.buffer, el.dataOffset + n * frameLen * 2, frameLen);
            return Float32Array.from(arr, (v) => v * slope + intercept);
          }
          return Float32Array.from(new Uint8Array(buf.buffer, el.dataOffset + n * frameLen, frameLen), (v) => v * slope + intercept);
        };
        const first = getFrame(0);
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < first.length; i += 7) { if (first[i] < min) min = first[i]; if (first[i] > max) max = first[i]; }
        const c = Number((ds.string('x00281050') || '').split('\\')[0]) || (min + max) / 2;
        const w = Number((ds.string('x00281051') || '').split('\\')[0]) || Math.max(1, max - min);
        setInvert(ds.string('x00280004') === 'MONOCHROME1');
        setWl({ c, w });
        setImg({
          rows, cols, spp, frames, getFrame,
          tags: {
            Patient: (ds.string('x00100010') || '').replace(/\^/g, ' '), Modality: ds.string('x00080060'), 'Study date': ds.string('x00080020'),
            Description: ds.string('x00081030') || ds.string('x0008103e'), Body: ds.string('x00180015'), Size: `${cols} × ${rows}${frames > 1 ? ` · ${frames} frames` : ''}`,
          },
        });
      } catch (e: any) { setErr(e.message || 'Could not read this DICOM file'); }
    })();
  }, [url]);

  useEffect(() => {
    if (!img || !canvas.current) return;
    const ctx = canvas.current.getContext('2d')!;
    canvas.current.width = img.cols; canvas.current.height = img.rows;
    const px = img.getFrame(frame);
    const out = ctx.createImageData(img.cols, img.rows);
    const lo = wl.c - wl.w / 2;
    for (let i = 0, j = 0; i < img.rows * img.cols; i++, j += 4) {
      if (img.spp === 3) { out.data[j] = px[i * 3]; out.data[j + 1] = px[i * 3 + 1]; out.data[j + 2] = px[i * 3 + 2]; }
      else {
        let v = ((px[i] - lo) / wl.w) * 255;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        if (invert) v = 255 - v;
        out.data[j] = out.data[j + 1] = out.data[j + 2] = v;
      }
      out.data[j + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  }, [img, frame, wl, invert]);

  if (err) return <Alert tone="amber">{err}</Alert>;
  if (!img) return <div className="flex justify-center py-16"><Spinner /></div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.min(6, z * 1.25))}><ZoomIn size={14} /></button>
        <button className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))}><ZoomOut size={14} /></button>
        <button className="btn-secondary btn-sm" onClick={() => setInvert((v) => !v)}><Contrast size={14} /> Invert</button>
        <button className="btn-secondary btn-sm" onClick={() => setZoom(1)}><RotateCcw size={14} /> Reset</button>
        <span className="text-xs text-ink-muted">Drag on the image to change brightness/contrast · W {Math.round(wl.w)} / L {Math.round(wl.c)}</span>
      </div>
      <div className="relative max-h-[65vh] overflow-auto rounded-xl bg-black"
        onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.max(0.25, Math.min(6, z * (e.deltaY < 0 ? 1.1 : 0.9)))); }}>
        <canvas ref={canvas} className="mx-auto block cursor-crosshair touch-none" style={{ width: img.cols * zoom, maxWidth: zoom <= 1 ? '100%' : 'none', imageRendering: 'pixelated' }}
          onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, c: wl.c, w: wl.w }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { if (!drag.current) return; const d = drag.current; setWl({ w: Math.max(1, d.w + (e.clientX - d.x) * (d.w / 200)), c: d.c + (e.clientY - d.y) * (d.w / 200) }); }}
          onPointerUp={() => (drag.current = null)} />
      </div>
      {img.frames > 1 && (
        <label className="flex items-center gap-3 text-sm"><span className="shrink-0">Frame {frame + 1}/{img.frames}</span>
          <input type="range" min={0} max={img.frames - 1} value={frame} onChange={(e) => setFrame(Number(e.target.value))} className="w-full accent-brand-600" /></label>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {Object.entries(img.tags).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-ink-muted">{k}</dt><dd className="font-medium">{String(v)}</dd></div>)}
      </dl>
      <p className="text-[11px] text-ink-muted">For viewing only, not for primary diagnosis. Use your PACS for diagnostic reads.</p>
    </div>
  );
}
