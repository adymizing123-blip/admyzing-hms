'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FONT_STACK, PAPER_MM, mmToPx, type PadConfig } from '@/lib/rx-pad';

export type PadItem = { medicine_name: string; dosage?: string; frequency?: string; duration?: string; instructions?: string };
export type PadData = {
  doctorName: string;
  clinic: { name: string; address?: string | null; phone?: string | null; timings?: string };
  patient?: { name?: string; age?: string; sex?: string; mrn?: string; date?: string };
  vitals?: Record<string, string>;
  complaints?: string;
  diagnosis?: string;
  items?: PadItem[];
  tests?: string[];
  advice?: string;
  followUp?: string;
  /** free text for the medicines area. When set (even to ''), it replaces the structured items list. */
  rxText?: string;
};

/** When given, text on the pad can be clicked and typed over. */
export type PadEdit = { data: (p: Partial<PadData>) => void; cfg: (p: Partial<PadConfig>) => void };

const VITAL_ROWS: [string, string][] = [['bp', 'BP'], ['pulse', 'Pulse'], ['temp', 'Temp'], ['weight', 'Weight'], ['spo2', 'SpO2']];
const exact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as CSSProperties;

const EDIT_CSS = `[data-ph]:empty::before{content:attr(data-ph);color:#94a3b8;font-weight:400;font-style:italic}
[contenteditable=true]{border-radius:3px;cursor:text;transition:background .15s}
[contenteditable=true]:hover{background:rgba(250,204,21,.18)}
[contenteditable=true]:focus{background:rgba(250,204,21,.28);outline:none}`;

const ruled = (unit = '1.8em', color = '#cbd5e1') =>
  `repeating-linear-gradient(to bottom, transparent 0, transparent calc(${unit} - 1px), ${color} calc(${unit} - 1px), ${color} ${unit})`;

/** Plain text on the printed copy; click-to-type text on the screen copy. */
function Ed({ value, onCommit, ph, multi, style }: { value?: string; onCommit?: (v: string) => void; ph?: string; multi?: boolean; style?: CSSProperties }) {
  if (!onCommit) return <span style={style}>{value}</span>;
  return (
    <span key={value || ''} contentEditable suppressContentEditableWarning spellCheck={false} data-ph={ph}
      style={{ ...style, display: multi ? 'block' : 'inline-block', minWidth: '4em', whiteSpace: multi ? 'pre-wrap' : 'normal' }}
      onKeyDown={(e) => { if (!multi && e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
      onBlur={(e) => onCommit(e.currentTarget.innerText.replace(/\u00a0/g, ' ').replace(/\n+$/, ''))}>{value}</span>
  );
}

function Sec({ title, color, light, children }: { title: string; color: string; light?: boolean; children: ReactNode }) {
  return (
    <div style={{ marginBottom: '1.1em' }}>
      <p style={{ fontSize: '0.72em', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: light ? '#fff' : color, opacity: light ? 0.85 : 1, marginBottom: '0.35em' }}>{title}</p>
      {children}
    </div>
  );
}

/** a written value, or a blank ruled line for the doctor to fill by hand */
function Lines({ text, n = 2, light, ed }: { text?: string; n?: number; light?: boolean; ed?: { set: (v: string) => void; ph: string } }) {
  const line = light ? 'rgba(255,255,255,.45)' : '#94a3b8';
  if (ed) {
    return <Ed multi value={text} onCommit={ed.set} ph={ed.ph}
      style={{ fontSize: '0.9em', lineHeight: '1.5em', minHeight: `${n * 1.5}em`, width: '100%', color: light ? '#fff' : '#0f172a',
        backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.5em - 1px), ${line} calc(1.5em - 1px), ${line} 1.5em)` }} />;
  }
  if (text?.trim()) return <p style={{ fontSize: '0.9em', lineHeight: 1.4, whiteSpace: 'pre-wrap', color: light ? '#fff' : '#0f172a' }}>{text}</p>;
  return <>{Array.from({ length: n }).map((_, i) => <div key={i} style={{ borderBottom: `1px solid ${line}`, height: '1.5em' }} />)}</>;
}

function Vitals({ d, color, light, edit }: { d: PadData; color: string; light?: boolean; edit?: PadEdit }) {
  return (
    <Sec title="Vitals" color={color} light={light}>
      {VITAL_ROWS.map(([k, l]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4em', fontSize: '0.85em', marginBottom: '0.3em', color: light ? '#fff' : '#334155' }}>
          <span style={{ width: '3.6em', flexShrink: 0 }}>{l}</span>
          <span style={{ flex: 1, borderBottom: `1px solid ${light ? 'rgba(255,255,255,.45)' : '#94a3b8'}`, minHeight: '1.3em', fontWeight: 600 }}>
            <Ed value={d.vitals?.[k] || ''} onCommit={edit ? (v) => edit.data({ vitals: { ...(d.vitals || {}), [k]: v } }) : undefined} ph="-" style={{ minWidth: '3em' }} />
          </span>
        </div>
      ))}
    </Sec>
  );
}

function PatientLine({ d, color, edit }: { d: PadData; color: string; edit?: PadEdit }) {
  const p = d.patient || {};
  const setP = (k: 'name' | 'age' | 'sex' | 'date') => (v: string) => edit?.data({ patient: { ...p, [k]: v } });
  const cell = (label: string, k: 'name' | 'age' | 'sex' | 'date', flex = 1, suffix = '') => (
    <div style={{ flex, display: 'flex', alignItems: 'flex-end', gap: '0.35em', borderBottom: `1px solid ${color}55`, minHeight: '1.6em', fontSize: '0.85em' }}>
      <span style={{ color: '#475569' }}>{label}:</span>
      <span style={{ fontWeight: 600, flex: 1 }}><Ed value={p[k] || ''} onCommit={edit ? setP(k) : undefined} ph="type here" />{p[k] ? suffix : ''}</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: '1em', marginBottom: '1em' }}>
      {cell('Patient', 'name', 3, p.mrn ? ` (${p.mrn})` : '')}{cell('Age', 'age')}{cell('Sex', 'sex')}{cell('Date', 'date')}
    </div>
  );
}

function RxBody({ d, cfg, color, edit }: { d: PadData; cfg: PadConfig; color: string; edit?: PadEdit }) {
  const items = (d.items || []).filter((i) => i.medicine_name?.trim());
  const freeText = d.rxText !== undefined;
  const advHead = <p style={{ fontWeight: 700, color, fontSize: '0.75em', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Advice</p>;
  const writeStyle: CSSProperties = { fontSize: '0.95em', lineHeight: '1.8em', flex: 1, minHeight: '16em', backgroundImage: ruled() };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {cfg.show_rx_symbol && <p style={{ fontSize: '2.4em', fontWeight: 700, color, fontFamily: 'Georgia, serif', lineHeight: 1, marginBottom: '0.3em' }}>℞</p>}
      {freeText ? (
        edit ? <Ed multi value={d.rxText} onCommit={(v) => edit.data({ rxText: v })} ph="Write medicines and instructions here. This whole area is for writing." style={writeStyle} />
        : d.rxText?.trim() ? <p style={{ whiteSpace: 'pre-wrap', fontSize: '0.95em', lineHeight: '1.8em', flex: 1 }}>{d.rxText}</p>
        : <div style={{ ...exact, flex: 1, minHeight: '16em', backgroundImage: ruled() }} />
      ) : (
        <ol style={{ listStyle: 'decimal', paddingLeft: '1.4em', margin: 0 }}>
          {items.map((r, i) => (
            <li key={i} style={{ marginBottom: '0.8em', fontSize: '0.95em' }}>
              <span style={{ fontWeight: 700 }}>{r.medicine_name}</span>
              {[r.dosage, r.frequency, r.duration].filter(Boolean).length > 0 && <span style={{ color: '#334155' }}> — {[r.dosage, r.frequency, r.duration].filter(Boolean).join(' · ')}</span>}
              {r.instructions && <div style={{ fontStyle: 'italic', color: '#64748b', fontSize: '0.9em' }}>{r.instructions}</div>}
            </li>
          ))}
        </ol>
      )}
      {edit ? (
        <div style={{ marginTop: '1.2em', fontSize: '0.9em' }}>{advHead}
          <Ed multi value={d.advice} onCommit={(v) => edit.data({ advice: v })} ph="Instructions for the patient (diet, rest, when to come back)"
            style={{ lineHeight: '1.8em', minHeight: '5.4em', backgroundImage: ruled() }} /></div>
      ) : d.advice?.trim() ? (
        <div style={{ marginTop: '1.2em', fontSize: '0.9em' }}>{advHead}<p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{d.advice}</p></div>
      ) : freeText ? (
        <div style={{ marginTop: '1.2em', fontSize: '0.9em' }}>{advHead}<div style={{ ...exact, minHeight: '5.4em', backgroundImage: ruled() }} /></div>
      ) : null}
    </div>
  );
}

function Signature({ d, cfg, edit }: { d: PadData; cfg: PadConfig; edit?: PadEdit }) {
  if (!cfg.show_signature) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '0.78em', color: '#475569', marginTop: '2em', marginBottom: '1.4em' }}>
      <div style={{ width: '40%', borderTop: '1px solid #64748b', paddingTop: '0.3em' }}>Next visit{d.followUp || edit ? ': ' : ''}<Ed value={d.followUp || ''} onCommit={edit ? (v) => edit.data({ followUp: v }) : undefined} ph="date" /></div>
      <div style={{ width: '40%', borderTop: '1px solid #64748b', paddingTop: '0.3em', textAlign: 'right' }}>Signature &amp; stamp</div>
    </div>
  );
}

function DoctorBlock({ d, cfg, color, light, center, edit }: { d: PadData; cfg: PadConfig; color: string; light?: boolean; center?: boolean; edit?: PadEdit }) {
  const t = light ? '#fff' : '#0f172a';
  const set = (k: 'doctor_name' | 'qualifications' | 'speciality') => (edit ? (v: string) => edit.cfg({ [k]: v }) : undefined);
  return (
    <div style={{ textAlign: center ? 'center' : 'left' }}>
      <p style={{ fontSize: '1.7em', fontWeight: 700, color: light ? '#fff' : color, lineHeight: 1.15 }}>
        <Ed value={cfg.doctor_name || d.doctorName} onCommit={set('doctor_name')} ph="Doctor name" /></p>
      {(cfg.qualifications || edit) && <p style={{ fontSize: '0.85em', fontWeight: 600, color: t }}><Ed value={cfg.qualifications} onCommit={set('qualifications')} ph="Qualifications" /></p>}
      {(cfg.speciality || edit) && <p style={{ fontSize: '0.8em', color: t, opacity: 0.85 }}><Ed value={cfg.speciality} onCommit={set('speciality')} ph="Speciality" /></p>}
      {cfg.reg_no && <p style={{ fontSize: '0.75em', color: t, opacity: 0.75 }}>{cfg.reg_no}</p>}
    </div>
  );
}

function ClinicBlock({ d, cfg, color, light, right = true }: { d: PadData; cfg: PadConfig; color: string; light?: boolean; right?: boolean }) {
  const t = light ? '#fff' : '#0f172a';
  return (
    <div style={{ textAlign: right ? 'right' : 'left', display: 'flex', alignItems: 'center', gap: '0.8em', flexDirection: right ? 'row-reverse' : 'row' }}>
      {cfg.logo && <img src={cfg.logo} alt="" style={{ height: '3.4em', width: 'auto', maxWidth: '8em', objectFit: 'contain' }} />}
      <div>
        <p style={{ fontSize: '1.05em', fontWeight: 700, color: light ? '#fff' : color }}>{d.clinic.name}</p>
        {d.clinic.timings && <p style={{ fontSize: '0.75em', color: t, opacity: 0.85 }}>{d.clinic.timings}</p>}
      </div>
    </div>
  );
}

const contactLine = (d: PadData) => [d.clinic.address, d.clinic.phone].filter(Boolean).join('  |  ');

/** The prescription sheet itself, at real paper size. */
export function RxPadSheet({ cfg, data, edit }: { cfg: PadConfig; data: PadData; edit?: PadEdit }) {
  const { w, h } = PAPER_MM[cfg.paper];
  const color = cfg.color;
  const root: CSSProperties = {
    ...exact, width: `${w}mm`, minHeight: `${h}mm`, background: '#fff', color: '#0f172a', boxSizing: 'border-box',
    fontFamily: FONT_STACK[cfg.font], fontSize: cfg.paper === 'A4' ? 13 : 11, position: 'relative', display: 'flex', flexDirection: 'column',
  };
  const wm = cfg.watermark && cfg.logo ? (
    <img src={cfg.logo} alt="" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '55%', opacity: 0.06, pointerEvents: 'none' }} />
  ) : null;
  const footer = (bg: boolean) => (
    <div style={{ ...exact, background: bg ? color : 'transparent', color: bg ? '#fff' : '#475569', padding: '0.8em 2.2em', fontSize: '0.75em', marginTop: 'auto', borderTop: bg ? 'none' : `1px solid ${color}55` }}>
      <p style={{ fontWeight: 700 }}>{contactLine(data)}</p>
      {cfg.footer_note && <p style={{ fontStyle: 'italic', opacity: 0.9 }}>{cfg.footer_note}</p>}
    </div>
  );
  const leftCol = (light = false) => (
    <>
      {cfg.show_vitals && <Vitals d={data} color={color} light={light} edit={edit} />}
      <Sec title="Complaints" color={color} light={light}><Lines text={data.complaints} n={2} light={light} ed={edit ? { set: (v) => edit.data({ complaints: v }), ph: 'type here' } : undefined} /></Sec>
      <Sec title="Diagnosis" color={color} light={light}><Lines text={data.diagnosis} n={3} light={light} ed={edit ? { set: (v) => edit.data({ diagnosis: v }), ph: 'type here' } : undefined} /></Sec>
      <Sec title="Tests" color={color} light={light}><Lines text={(data.tests || []).join(', ')} n={2} light={light} ed={edit ? { set: (v) => edit.data({ tests: v.trim() ? [v] : [] }), ph: 'type here' } : undefined} /></Sec>
    </>
  );

  if (cfg.design === 'side') {
    return (
      <div style={{ ...root, flexDirection: 'row' }}>
        {edit && <style>{EDIT_CSS}</style>}
        {wm}
        <div style={{ ...exact, width: '34%', background: color, color: '#fff', padding: '2em 1.4em' }}>
          <DoctorBlock d={data} cfg={cfg} color={color} light edit={edit} />
          <div style={{ margin: '1.2em 0', borderTop: '1px solid rgba(255,255,255,.4)' }} />
          {leftCol(true)}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '2em 2em 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ marginBottom: '1.4em' }}><ClinicBlock d={data} cfg={cfg} color={color} /></div>
            {cfg.show_patient_line && <PatientLine d={data} color={color} edit={edit} />}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><RxBody d={data} cfg={cfg} color={color} edit={edit} /></div>
            <Signature d={data} cfg={cfg} edit={edit} />
          </div>
          <div style={{ marginTop: 'auto', padding: '0.8em 2em', fontSize: '0.75em', color: '#475569', borderTop: `1px solid ${color}55` }}>
            <p style={{ fontWeight: 700 }}>{contactLine(data)}</p>
            {cfg.footer_note && <p style={{ fontStyle: 'italic' }}>{cfg.footer_note}</p>}
          </div>
        </div>
      </div>
    );
  }

  const header =
    cfg.design === 'modern' ? (
      <div style={{ ...exact, background: color, padding: '1.6em 2.2em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1em' }}>
        <DoctorBlock d={data} cfg={cfg} color={color} light edit={edit} /><ClinicBlock d={data} cfg={cfg} color={color} light />
      </div>
    ) : cfg.design === 'minimal' ? (
      <div style={{ padding: '2em 2.2em 0', textAlign: 'center' }}>
        <DoctorBlock d={data} cfg={cfg} color={color} center edit={edit} />
        <p style={{ fontSize: '0.8em', color: '#475569', marginTop: '0.4em' }}>{[data.clinic.name, data.clinic.timings].filter(Boolean).join('  ·  ')}</p>
        <div style={{ borderTop: `1px solid ${color}`, marginTop: '1em' }} />
      </div>
    ) : (
      <div style={{ padding: '2em 2.2em 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1em' }}>
          <DoctorBlock d={data} cfg={cfg} color={color} edit={edit} /><ClinicBlock d={data} cfg={cfg} color={color} />
        </div>
        <div style={{ ...exact, borderTop: `3px solid ${color}`, marginTop: '1em' }} />
      </div>
    );

  return (
    <div style={root}>
      {edit && <style>{EDIT_CSS}</style>}
      {wm}
      {header}
      <div style={{ padding: '1.2em 2.2em 0', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {cfg.show_patient_line && <PatientLine d={data} color={color} edit={edit} />}
        <div style={{ display: 'flex', gap: '1.4em', flex: 1 }}>
          <div style={{ width: '28%', borderRight: '1px solid #cbd5e1', paddingRight: '1em' }}>{leftCol(false)}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><RxBody d={data} cfg={cfg} color={color} edit={edit} /></div>
        </div>
        <Signature d={data} cfg={cfg} edit={edit} />
      </div>
      {footer(cfg.design !== 'minimal')}
    </div>
  );
}

/** Scaled to fit its container on screen. */
export function RxPadPreview({ cfg, data, edit }: { cfg: PadConfig; data: PadData; edit?: PadEdit }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(0);
  const pageW = mmToPx(PAPER_MM[cfg.paper].w);

  useEffect(() => {
    const fit = () => {
      if (!box.current || !inner.current) return;
      const s = Math.min(1, box.current.clientWidth / pageW);
      setScale(s);
      setHeight(inner.current.offsetHeight * s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (box.current) ro.observe(box.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [pageW]);

  return (
    <div ref={box} className="w-full overflow-hidden rounded-xl bg-slate-200/60 p-0 ring-1 ring-slate-200" style={{ height: height || undefined }}>
      <div ref={inner} style={{ width: pageW, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <RxPadSheet cfg={cfg} data={data} edit={edit} />
      </div>
    </div>
  );
}

/** Screen preview + a full-size copy that is the only thing printed. */
export function RxPadPrintable({ cfg, data, edit }: { cfg: PadConfig; data: PadData; edit?: PadEdit }) {
  return (
    <>
      <div className="no-print"><RxPadPreview cfg={cfg} data={data} edit={edit} /></div>
      <div className="print-area hidden print:block">
        <style>{`@page { size: ${cfg.paper}; margin: 0; }`}</style>
        <RxPadSheet cfg={cfg} data={data} />
      </div>
    </>
  );
}
