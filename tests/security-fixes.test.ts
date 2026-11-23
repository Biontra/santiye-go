/**
 * ŞANTİYE GO – GÜVENLİK DÜZELTMELERİ TESTLERİ
 * Çalıştırma: npx tsx --test tests/security-fixes.test.ts
 * Veritabanı ya da .env gerektirmez; yalnız saf güvenlik mantığını sınar.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createSignedOtpToken, verifySignedOtpToken, getOtpSecret } from '../src/lib/security/otp-token.ts';
import { isCronAuthorized } from '../src/lib/security/cron-auth.ts';
import { verifyTotpCode, generateTotpCode } from '../src/lib/security/totp.ts';
import { isAdminRole, adminRouteDecision } from '../src/lib/security/admin-guard.ts';
import { IyzicoPaymentAdapter } from '../src/lib/payment/iyzico-adapter.ts';

const SECRET = 'test-otp-secret-0123456789';
const PHONE = '+905321234567';
const EMAIL = 'a@b.com';

function decodePayload(token: string): Record<string, unknown> {
  const outer = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
  return JSON.parse(outer.payload);
}

// ---------- Doğrulama kodu (OTP) ----------

test('OTP jetonu kodun anahtarsız özetini içermez (çevrimdışı kırılamaz)', () => {
  const token = createSignedOtpToken(PHONE, EMAIL, '123456', Date.now() + 60000, SECRET);
  const plainHash = crypto.createHash('sha256').update('123456').digest('hex');
  assert.ok(!JSON.stringify(decodePayload(token)).includes(plainHash));
});

test('OTP doğru kodu kabul eder', () => {
  const token = createSignedOtpToken(PHONE, EMAIL, '123456', Date.now() + 60000, SECRET);
  assert.equal(verifySignedOtpToken(token, '123456', PHONE, SECRET).valid, true);
});

test('OTP yanlış kodu reddeder', () => {
  const token = createSignedOtpToken(PHONE, EMAIL, '123456', Date.now() + 60000, SECRET);
  assert.equal(verifySignedOtpToken(token, '654321', PHONE, SECRET).valid, false);
});

test('OTP süresi dolmuş jetonu reddeder', () => {
  const token = createSignedOtpToken(PHONE, EMAIL, '123456', Date.now() - 1, SECRET);
  assert.equal(verifySignedOtpToken(token, '123456', PHONE, SECRET).valid, false);
});

test('OTP başka telefon için kullanılamaz', () => {
  const token = createSignedOtpToken(PHONE, EMAIL, '123456', Date.now() + 60000, SECRET);
  assert.equal(verifySignedOtpToken(token, '123456', '+905559999999', SECRET).valid, false);
});

test('OTP başka anahtarla imzalanmış (sahte) jetonu reddeder', () => {
  const forged = createSignedOtpToken(PHONE, EMAIL, '123456', Date.now() + 60000, 'santiye-go-secret-otp-signing-key');
  assert.equal(verifySignedOtpToken(forged, '123456', PHONE, SECRET).valid, false);
});

test('OTP anahtarı ortamda yoksa koddaki sabit anahtara düşmez, hata verir', () => {
  assert.throws(() => getOtpSecret({}));
  assert.equal(getOtpSecret({ OTP_SIGNING_SECRET: 'x'.repeat(32) }), 'x'.repeat(32));
});

// ---------- Ödeme bildirimi (webhook) ----------

function configuredAdapter(): IyzicoPaymentAdapter {
  process.env.IYZICO_API_KEY = 'real-api-key';
  process.env.IYZICO_SECRET_KEY = 'real-secret-key';
  return new IyzicoPaymentAdapter();
}

const BODY = { status: 'success', paymentId: 'pay-1' };

test('Webhook: rastgele 64 karakterli imza reddedilir', async () => {
  const res = await configuredAdapter().verifyWebhook({ 'x-iyz-signature': 'a'.repeat(64) }, BODY);
  assert.equal(res.isValid, false);
});

test('Webhook: rastgele 44 karakterli imza reddedilir', async () => {
  const res = await configuredAdapter().verifyWebhook({ 'x-iyz-signature': 'b'.repeat(44) }, BODY);
  assert.equal(res.isValid, false);
});

test('Webhook: doğru HMAC imzası kabul edilir', async () => {
  const adapter = configuredAdapter();
  const sig = adapter.generateHmacSignature(JSON.stringify(BODY));
  const res = await adapter.verifyWebhook({ 'x-iyz-signature': sig }, BODY);
  assert.equal(res.isValid, true);
  assert.equal(res.status, 'paid');
});

test('Webhook: imzasız çağrı, anahtarlar ayarlı değilken bile canlıda reddedilir', async () => {
  delete process.env.IYZICO_API_KEY;
  delete process.env.IYZICO_SECRET_KEY;
  const prev = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = 'production';
  try {
    const res = await new IyzicoPaymentAdapter().verifyWebhook({}, BODY);
    assert.equal(res.isValid, false);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  }
});

test('Webhook: anahtarlar ayarlı değilken canlıda imzalı çağrı da reddedilir (herkesin bildiği demo anahtarı)', async () => {
  delete process.env.IYZICO_API_KEY;
  delete process.env.IYZICO_SECRET_KEY;
  const prev = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = 'production';
  try {
    const adapter = new IyzicoPaymentAdapter();
    const sig = adapter.generateHmacSignature(JSON.stringify(BODY));
    const res = await adapter.verifyWebhook({ 'x-iyz-signature': sig }, BODY);
    assert.equal(res.isValid, false);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  }
});

// ---------- Zamanlanmış görev (cron) ----------

test('Cron: gizli anahtar ayarlı değilse kimse yetkili değildir', () => {
  assert.equal(isCronAuthorized(undefined, 'Bearer anything', null), false);
  assert.equal(isCronAuthorized('', null, ''), false);
});

test('Cron: yanlış anahtar reddedilir, doğru anahtar kabul edilir', () => {
  assert.equal(isCronAuthorized('s3cret', 'Bearer wrong', null), false);
  assert.equal(isCronAuthorized('s3cret', null, null), false);
  assert.equal(isCronAuthorized('s3cret', 'Bearer s3cret', null), true);
  assert.equal(isCronAuthorized('s3cret', null, 's3cret'), true);
});

// ---------- Admin 2FA (TOTP) ----------

test('TOTP: gizli anahtarın kendisi kod olarak kabul edilmez', () => {
  assert.equal(verifyTotpCode('my-static-secret', 'my-static-secret'), false);
});

test('TOTP: o anki doğru kod kabul edilir, yanlış kod reddedilir', () => {
  const now = Date.now();
  const good = generateTotpCode('my-static-secret', Math.floor(now / 30000));
  assert.equal(verifyTotpCode(good, 'my-static-secret', now), true);
  const bad = good === '000000' ? '000001' : '000000';
  assert.equal(verifyTotpCode(bad, 'my-static-secret', now), false);
});

// ---------- Admin yetkisi ----------

test('Admin rolü: yalnız admin ve super_admin', () => {
  assert.equal(isAdminRole('admin'), true);
  assert.equal(isAdminRole('super_admin'), true);
  assert.equal(isAdminRole('buyer'), false);
  assert.equal(isAdminRole('company'), false);
  assert.equal(isAdminRole(undefined), false);
  assert.equal(isAdminRole(null), false);
});

test('Admin sayfası: rolü bilinmeyen girişli kullanıcı içeri alınmaz', () => {
  assert.equal(adminRouteDecision(false, undefined), 'login');
  assert.equal(adminRouteDecision(true, undefined), 'forbidden');
  assert.equal(adminRouteDecision(true, 'buyer'), 'forbidden');
  assert.equal(adminRouteDecision(true, 'admin'), 'allow');
});
