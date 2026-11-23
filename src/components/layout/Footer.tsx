import Link from 'next/link';
import { HardHat } from 'lucide-react';

const categoryLinks = [
  { href: '/ilanlar?category=is-makineleri', label: 'İş makineleri' },
  { href: '/ilanlar?category=yapi-malzemeleri', label: 'Yapı malzemeleri' },
  { href: '/ilanlar?category=nakliye', label: 'Nakliye' },
  { href: '/hesaplayici', label: 'Metraj hesaplayıcı' },
  { href: '/teklif-iste', label: 'Teklif iste' },
];

const legalLinks = [
  { href: '/uyelik-sozlesmesi', label: 'Üyelik sözleşmesi' },
  { href: '/mesafeli-satis-sozlesmesi', label: 'Mesafeli satış sözleşmesi' },
  { href: '/iade-ve-iptal-kosullari', label: 'İade ve iptal koşulları' },
  { href: '/reklam-kosullari', label: 'Reklam koşulları' },
  { href: '/kvkk', label: 'KVKK aydınlatma metni' },
  { href: '/gizlilik', label: 'Gizlilik ve çerez politikası' },
];

export default function Footer() {
  return (
    <footer className="bg-navy-950 text-slate-300 pt-12 pb-24 md:pb-10 mt-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 pb-10">
          <div className="space-y-3 md:col-span-2 max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-lg bg-orange-500 flex items-center justify-center text-white">
                <HardHat className="w-5 h-5" />
              </span>
              <span className="text-lg font-bold text-white tracking-tight">
                Şantiye<span className="text-orange-500">GO</span>
              </span>
            </div>
            <p className="text-sm text-slate-400 leading-relaxed">
              İş makinesi kiralama, yapı malzemesi ve nakliye ilanlarını bir araya getiren pazar yeri.
            </p>
            <p className="text-sm">
              <a href="mailto:destek@santiyego.com" className="hover:text-white underline underline-offset-4">
                destek@santiyego.com
              </a>
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Site</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              {categoryLinks.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-white transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-3">Yasal</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              {legalLinks.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="hover:text-white transition-colors">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/*
          YAPILACAK (yasal zorunluluk): Şirket kurulunca ticari unvan, MERSİS / vergi no,
          merkez adres ve KEP adresi buraya gerçek bilgilerle eklenmeli. Köşeli parantezli
          yer tutucular yayında göründüğü için kaldırıldı.
        */}
        <div className="pt-6 border-t border-navy-800 text-xs text-slate-400">
          © {new Date().getFullYear()} ŞantiyeGO
        </div>
      </div>
    </footer>
  );
}
