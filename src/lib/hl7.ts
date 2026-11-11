/** Minimal HL7 v2 ORU^R01 parser for lab results (no external dependency). */
export type HL7Result = { code: string; name: string; value: string; units: string; range: string; flag: 'normal' | 'high' | 'low' | 'critical' | null; status: string };
export type HL7Order = { orderNo: string; fillerNo: string; results: HL7Result[] };
export type HL7Message = { controlId: string; type: string; mrn: string; patientName: string; orders: HL7Order[] };

export function mapFlag(f?: string): HL7Result['flag'] {
  const v = (f || '').trim().toUpperCase();
  if (!v) return null;
  if (['HH', 'LL', 'AA', 'CRIT', 'C'].includes(v)) return 'critical';
  if (['H', '>', 'HU'].includes(v)) return 'high';
  if (['L', '<', 'LU'].includes(v)) return 'low';
  if (v === 'N') return 'normal';
  if (v === 'A') return 'high';
  return null;
}

export function parseHL7(raw: string): HL7Message {
  const segments = raw.replace(/\r\n|\n/g, '\r').split('\r').map((s) => s.trim()).filter(Boolean);
  const msh = segments.find((s) => s.startsWith('MSH'));
  if (!msh) throw new Error('Not an HL7 message (no MSH segment)');
  const fs = msh[3] || '|';
  const cs = (msh.split(fs)[1] || '^~\\&')[0] || '^';
  const f = (seg: string) => seg.split(fs);
  // MSH counts the field separator itself as MSH-1, so MSH-n is index n-1
  const mshF = f(msh);
  const msg: HL7Message = { controlId: mshF[9] || '', type: mshF[8] || '', mrn: '', patientName: '', orders: [] };
  let current: HL7Order | null = null;
  for (const seg of segments) {
    const p = f(seg);
    if (p[0] === 'PID') {
      msg.mrn = (p[3] || '').split('~')[0].split(cs)[0];
      msg.patientName = (p[5] || '').split(cs).slice(0, 2).reverse().join(' ').trim();
    } else if (p[0] === 'OBR') {
      current = { orderNo: (p[2] || '').split(cs)[0], fillerNo: (p[3] || '').split(cs)[0], results: [] };
      msg.orders.push(current);
    } else if (p[0] === 'OBX') {
      if (!current) { current = { orderNo: '', fillerNo: '', results: [] }; msg.orders.push(current); }
      const id = (p[3] || '').split(cs);
      current.results.push({
        code: id[0] || '', name: id[1] || id[0] || '',
        value: (p[5] || '').split(cs)[0],
        units: (p[6] || '').split(cs)[0],
        range: p[7] || '',
        flag: mapFlag((p[8] || '').split('~')[0]),
        status: p[11] || 'F',
      });
    }
  }
  if (!msg.orders.length) throw new Error('No OBR/OBX results found');
  return msg;
}

/** Simple CSV alternative: order_no,test_code,result,flag */
export function parseResultsCSV(raw: string): HL7Message {
  const rows = raw.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (rows[0]?.toLowerCase().startsWith('order')) rows.shift();
  const orders: Record<string, HL7Order> = {};
  for (const r of rows) {
    const [orderNo, code, value, flag] = r.split(',').map((x) => x?.trim() || '');
    if (!orderNo || !code) continue;
    (orders[orderNo] ||= { orderNo, fillerNo: '', results: [] }).results.push({ code, name: code, value, units: '', range: '', flag: mapFlag(flag) ?? (flag ? (flag.toLowerCase() as any) : null), status: 'F' });
  }
  return { controlId: '', type: 'CSV', mrn: '', patientName: '', orders: Object.values(orders) };
}

export function hl7Ack(controlId: string, ok: boolean, text = '') {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `MSH|^~\\&|CAREPLUS|HOSPITAL|||${ts}||ACK|${controlId || ts}|P|2.5\rMSA|${ok ? 'AA' : 'AE'}|${controlId}|${text}`;
}
