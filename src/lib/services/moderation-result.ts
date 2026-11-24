export interface ModerationAttempt {
  /** Sunucu ucu (/api/admin/listings/moderate) 2xx döndü mü */
  apiOk: boolean;
  apiError?: string | null;
  /** Doğrudan veritabanı güncellemesinin değiştirdiği satır sayısı */
  updatedRows: number;
  dbError?: string | null;
}

export interface ModerationResult {
  success: boolean;
  error?: string;
}

/** İlan onay/ret işleminin gerçekten uygulanıp uygulanmadığına karar verir. */
export function resolveModerationResult(attempt: ModerationAttempt): ModerationResult {
  if (attempt.apiOk || attempt.updatedRows > 0) {
    return { success: true };
  }
  return { success: false, error: attempt.apiError || attempt.dbError || 'İlan güncellenemedi.' };
}
