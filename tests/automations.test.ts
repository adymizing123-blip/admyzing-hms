import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { conditionsMatch, describeTiming, fill, inHours, pickChannel, staffChannel, SAMPLE_VARS, TRIGGERS } from '@/lib/automation-core';
import { parseMeta, parseTwilio, verifyMetaSignature, verifyTwilioSignature } from '@/lib/meta-webhook';
import { sourceFromParams } from '@/lib/visit-source';

const all = { sms: true, whatsapp: true, email: true };
const none = { sms: false, whatsapp: false, email: false };

describe('automation rules', () => {
  it('fills variables and blanks unknown ones', () => {
    expect(fill('Hi {first_name}, see {doctor} at {time}.{video}', { first_name: 'Ali', doctor: 'Dr. Sara', time: '6 PM' })).toBe('Hi Ali, see Dr. Sara at 6 PM.');
  });
  it('every trigger only offers variables that have help text and sample values', () => {
    Object.values(TRIGGERS).forEach((t) => t.vars.forEach((v) => expect(SAMPLE_VARS[v]).toBeDefined()));
  });
  it('opening hours, including past midnight', () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 10, h, m));
    expect(inHours(at(10), 'UTC', '09:00', '21:00')).toBe(true);
    expect(inHours(at(21), 'UTC', '09:00', '21:00')).toBe(false);
    expect(inHours(at(23, 30), 'UTC', '18:00', '02:00')).toBe(true);
    expect(inHours(at(3), 'UTC', '18:00', '02:00')).toBe(false);
    // 04:00 UTC is 09:00 in Karachi (UTC+5)
    expect(inHours(at(4), 'Asia/Karachi', '09:00', '21:00')).toBe(true);
  });
  it('conditions: clinic, sources, first message, after hours', () => {
    expect(conditionsMatch({ branch_id: 'a' }, { branchId: 'b' }).ok).toBe(false);
    expect(conditionsMatch({ branch_id: 'a' }, { branchId: 'a' }).ok).toBe(true);
    expect(conditionsMatch({ exclude_sources: ['whatsapp', 'instagram'] }, { source: 'instagram' }).ok).toBe(false);
    expect(conditionsMatch({ exclude_sources: ['whatsapp'] }, { source: 'website' }).ok).toBe(true);
    expect(conditionsMatch({ sources: ['facebook'] }, { source: null }).ok).toBe(false);
    expect(conditionsMatch({ first_message_only: true }, { first: false }).ok).toBe(false);
    const open = new Date(Date.UTC(2026, 10, 10, 12));
    expect(conditionsMatch({ outside_hours: { start: '09:00', end: '21:00' } }, { now: open, tz: 'UTC' }).ok).toBe(false);
    expect(conditionsMatch({ outside_hours: { start: '09:00', end: '21:00' } }, { now: new Date(Date.UTC(2026, 10, 10, 22)), tz: 'UTC' }).ok).toBe(true);
  });
  it('best available channel: chat reply, then WhatsApp, SMS, email', () => {
    expect(pickChannel('auto', { conversationId: 'c1', phone: '+1' }, all)).toEqual({ channel: 'conversation', to: 'c1' });
    expect(pickChannel('auto', { phone: '+92300' }, all)).toEqual({ channel: 'whatsapp', to: '+92300' });
    expect(pickChannel('auto', { phone: '+92300', email: 'a@b.c' }, { ...none, sms: true })).toEqual({ channel: 'sms', to: '+92300' });
    expect(pickChannel('auto', { phone: '+92300', email: 'a@b.c' }, { ...none, email: true })).toEqual({ channel: 'email', to: 'a@b.c' });
    expect(pickChannel('auto', {}, all).channel).toBeNull();
    expect(pickChannel('email', { phone: '+1' }, all).channel).toBeNull();
    // Instagram lead (no phone) with WhatsApp rule replies in the chat
    expect(pickChannel('whatsapp', { conversationId: 'c9' }, all)).toEqual({ channel: 'conversation', to: 'c9' });
    expect(pickChannel('call' as any, { phone: '+1' }, all).channel).toBeNull();
  });
  it('staff alerts', () => {
    expect(staffChannel('owner@clinic.com', all)).toEqual({ channel: 'email', to: 'owner@clinic.com' });
    expect(staffChannel('+923001234567', { ...none, sms: true })).toEqual({ channel: 'sms', to: '+923001234567' });
    expect(staffChannel('', all).channel).toBeNull();
  });
  it('describes timing', () => {
    expect(describeTiming('appointment_reminder', -1440)).toBe('1 day before the appointment');
    expect(describeTiming('appointment_completed', 120)).toBe('2 hours after the visit');
    expect(describeTiming('appointment_booked', 0)).toBe('Right at the booking');
  });
});

describe('Meta webhooks', () => {
  it('WhatsApp text from a click-to-WhatsApp ad, image, and a status', () => {
    const r = parseMeta({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: 'PN1' },
        contacts: [{ wa_id: '923001112222', profile: { name: 'Ayesha' } }],
        messages: [
          { from: '923001112222', id: 'wamid.A', timestamp: '1762790400', type: 'text', text: { body: 'Hi' }, referral: { source_type: 'ad', headline: 'Laser offer', source_url: 'https://fb.me/x' } },
          { from: '923001112222', id: 'wamid.B', timestamp: '1762790401', type: 'image', image: { id: 'MEDIA1', caption: 'my report' } },
        ],
        statuses: [{ id: 'wamid.OUT', status: 'failed', errors: [{ title: 'Re-engagement message', error_data: { details: 'More than 24 hours' } }] }],
      } }] }],
    });
    expect(r.messages[0]).toMatchObject({ channel: 'whatsapp', accountId: 'PN1', externalId: '+923001112222', name: 'Ayesha', body: 'Hi', direction: 'in', providerId: 'wamid.A' });
    expect(r.messages[0].referral?.headline).toBe('Laser offer');
    expect(r.messages[0].at).toBe(new Date(1762790400 * 1000).toISOString());
    expect(r.messages[1]).toMatchObject({ mediaType: 'image', mediaUrl: 'wa:MEDIA1', body: 'my report' });
    expect(r.statuses[0]).toEqual({ providerId: 'wamid.OUT', status: 'failed', error: 'Re-engagement message: More than 24 hours' });
  });
  it('WhatsApp Business app replies (coexistence echoes) are outgoing', () => {
    const r = parseMeta({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'smb_message_echoes', value: {
      metadata: { phone_number_id: 'PN1' }, message_echoes: [{ from: '15550001', to: '923001112222', id: 'wamid.E', type: 'text', text: { body: 'Yes 6pm' } }] } }] }] });
    expect(r.messages[0]).toMatchObject({ direction: 'out', externalId: '+923001112222', body: 'Yes 6pm' });
  });
  it('Messenger message, page echo and Instagram DM with attachment', () => {
    const fb = parseMeta({ object: 'page', entry: [{ id: 'PAGE1', messaging: [
      { sender: { id: 'PSID1' }, recipient: { id: 'PAGE1' }, timestamp: 1762790400000, message: { mid: 'm1', text: 'Price?', referral: { source: 'ADS', ad_id: '42', ads_context_data: { ad_title: 'Botox Nov' } } } },
      { sender: { id: 'PAGE1' }, recipient: { id: 'PSID1' }, timestamp: 1762790401000, message: { mid: 'm2', text: '$200', is_echo: true } },
      { sender: { id: 'PSID1' }, recipient: { id: 'PAGE1' }, timestamp: 1762790402000, read: { watermark: 1 } },
    ] }] });
    expect(fb.messages).toHaveLength(2);
    expect(fb.messages[0]).toMatchObject({ channel: 'facebook', accountId: 'PAGE1', externalId: 'PSID1', body: 'Price?', direction: 'in' });
    expect(fb.messages[0].referral?.ad_title).toBe('Botox Nov');
    expect(fb.messages[0].at).toBe(new Date(1762790400000).toISOString());
    expect(fb.messages[1]).toMatchObject({ direction: 'out', externalId: 'PSID1' });
    const ig = parseMeta({ object: 'instagram', entry: [{ id: 'IG1', messaging: [
      { sender: { id: 'IGSID' }, recipient: { id: 'IG1' }, timestamp: 1762790400000, message: { mid: 'i1', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] } },
    ] }] });
    expect(ig.messages[0]).toMatchObject({ channel: 'instagram', accountId: 'IG1', externalId: 'IGSID', mediaType: 'image', mediaUrl: 'https://cdn/x.jpg', body: null });
  });
  it('ignores other objects', () => {
    expect(parseMeta({ object: 'user', entry: [] }).messages).toHaveLength(0);
    expect(parseMeta(null).messages).toHaveLength(0);
  });
  it('checks the Meta signature', () => {
    const raw = '{"a":1}';
    const sig = 'sha256=' + createHmac('sha256', 'shh').update(raw).digest('hex');
    expect(verifyMetaSignature(raw, sig, 'shh')).toBe(true);
    expect(verifyMetaSignature(raw + ' ', sig, 'shh')).toBe(false);
    expect(verifyMetaSignature(raw, null, 'shh')).toBe(false);
  });
});

describe('Twilio webhooks', () => {
  it('parses WhatsApp and SMS', () => {
    expect(parseTwilio({ From: 'whatsapp:+923001112222', To: 'whatsapp:+14155238886', Body: 'Hi', ProfileName: 'Ali', MessageSid: 'SM1', NumMedia: '0' }))
      .toMatchObject({ channel: 'whatsapp', accountId: '+14155238886', externalId: '+923001112222', name: 'Ali', body: 'Hi', providerId: 'SM1' });
    expect(parseTwilio({ From: '+15125550141', To: '+15125550100', Body: 'Yes', MessageSid: 'SM2', NumMedia: '1', MediaUrl0: 'https://api.twilio.com/m', MediaContentType0: 'image/jpeg' }))
      .toMatchObject({ channel: 'sms', mediaType: 'image', mediaUrl: 'https://api.twilio.com/m' });
  });
  it('checks the Twilio signature', () => {
    const url = 'https://clinic.com/api/webhooks/twilio';
    const params = { From: '+1', Body: 'Hi', To: '+2' };
    const sig = createHmac('sha1', 'tok').update(url + 'BodyHiFrom+1To+2').digest('base64');
    expect(verifyTwilioSignature(url, params, sig, 'tok')).toBe(true);
    expect(verifyTwilioSignature(url, { ...params, Body: 'Hey' }, sig, 'tok')).toBe(false);
  });
});

describe('website visit source', () => {
  const s = (q: string) => sourceFromParams(new URLSearchParams(q));
  it('maps utm_source and ad click IDs', () => {
    expect(s('utm_source=ig&utm_campaign=laser-nov')).toEqual({ source: 'instagram', detail: 'laser-nov' });
    expect(s('utm_source=Facebook')).toEqual({ source: 'facebook', detail: null });
    expect(s('fbclid=abc')).toEqual({ source: 'facebook', detail: null });
    expect(s('gclid=xyz&utm_campaign=brand')).toEqual({ source: 'google', detail: 'brand' });
    expect(s('utm_source=newsletter')).toEqual({ source: 'other', detail: 'newsletter' });
    expect(s('')).toBeNull();
  });
});
