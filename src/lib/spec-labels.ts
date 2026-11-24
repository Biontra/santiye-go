/** Teknik özellik anahtarlarının Türkçe görünen adları. */
const SPEC_LABELS: Record<string, string> = {
  axle_count: 'Aks sayısı',
  boom_length: 'Bom uzunluğu',
  brand: 'Marka',
  capacity: 'Kapasite',
  condition: 'Durum',
  construction_service_branch: 'Hizmet dalı',
  crew_size_people: 'Ekip (kişi)',
  density: 'Yoğunluk',
  diameter: 'Çap',
  dimensions: 'Ölçüler',
  equipment_type: 'Ekipman tipi',
  fuel: 'Yakıt',
  has_license_document: 'Yetki belgesi',
  has_official_authorization: 'Resmi yetki',
  has_periodic_inspection: 'Periyodik muayene',
  has_tse_standard: 'TSE standardı',
  installation_included: 'Montaj dahil',
  is_explosion_proof: 'Ex-proof',
  lift_operator_included: 'Operatör dahil',
  lift_system_type: 'Sistem tipi',
  lifting_capacity_kg: 'Kaldırma kapasitesi (kg)',
  mast: 'Direk',
  model: 'Model',
  origin: 'Menşei',
  packaging: 'Ambalaj',
  power: 'Güç',
  power_output_kva: 'Güç (kVA)',
  scaffold_system_type: 'İskele sistemi',
  slump: 'Slump',
  soundproof: 'Ses yalıtımlı',
  standard: 'Standart',
  strength: 'Dayanım sınıfı',
  surface_area_m2: 'Alan (m²)',
  team_experience_years: 'Ekip tecrübesi (yıl)',
  thickness: 'Kalınlık',
  tonnage: 'Tonaj',
  weight: 'Ağırlık',
  working_height_m: 'Çalışma yüksekliği (m)',
  working_hours: 'Çalışma saati',
  year: 'Model yılı',
};

export function specLabel(key: string): string {
  if (SPEC_LABELS[key]) return SPEC_LABELS[key];
  const text = key.replace(/_/g, ' ').trim();
  return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
}

export function specValue(val: unknown): string {
  if (val === true) return 'Var';
  if (val === false) return 'Yok';
  return String(val ?? '-');
}
