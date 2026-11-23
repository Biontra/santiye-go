import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Şantiyeden Şantiyeye | Artan Malzeme & Boş Dönüş Kamyonu Pazarı',
  description:
    'Şantiyelerde artan malzeme ve ekipmanı indirimli alın, boş dönen kamyon ve lowbed araçlarıyla güzergah bazlı ucuz nakliye bulun.',
};

export default function CircularMarketLayout({ children }: { children: React.ReactNode }) {
  return children;
}
