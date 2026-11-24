import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModerationResult } from '../src/lib/services/moderation-result';

test('sunucu ucu başarılıysa işlem başarılı sayılır', () => {
  assert.deepEqual(resolveModerationResult({ apiOk: true, updatedRows: 0 }), { success: true });
});

test('sunucu ucu başarısız ama doğrudan güncelleme satır değiştirdiyse başarılı sayılır', () => {
  assert.deepEqual(resolveModerationResult({ apiOk: false, apiError: 'x', updatedRows: 1 }), { success: true });
});

test('hiçbir satır değişmediyse başarısızdır ve sunucunun hata metni döner', () => {
  assert.deepEqual(
    resolveModerationResult({ apiOk: false, apiError: 'Bu işlem yalnız yöneticiler içindir.', updatedRows: 0 }),
    { success: false, error: 'Bu işlem yalnız yöneticiler içindir.' }
  );
});

test('hata metni yoksa genel bir açıklama döner', () => {
  const result = resolveModerationResult({ apiOk: false, updatedRows: 0 });
  assert.equal(result.success, false);
  assert.equal(result.error, 'İlan güncellenemedi.');
});

test('veritabanı hatası sunucu hatası yokken gösterilir', () => {
  assert.deepEqual(resolveModerationResult({ apiOk: false, updatedRows: 0, dbError: 'izin yok' }), {
    success: false,
    error: 'izin yok',
  });
});
