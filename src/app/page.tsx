import Link from 'next/link';
import {
  Wrench,
  Boxes,
  Truck,
  Layers,
  ChevronsUp,
  HardHat,
  Hammer,
  ArrowRight,
  Calculator,
} from 'lucide-react';
import HeroSearch from '@/components/search/HeroSearch';
import ListingCard from '@/components/listings/ListingCard';
import { CATEGORIES } from '@/lib/mock-data';
import { getActiveAdsForSlot } from '@/lib/services/ad-service';
import { searchListings } from '@/lib/services/listing-service';

export default async function HomePage() {
  const { listings: showcaseListings } = getActiveAdsForSlot({
    productId: 'showcase_home',
    limit: 3,
  });

  const nearbyRes = await searchListings({ sort: 'distance', limit: 3 });
  const newestRes = await searchListings({ sort: 'newest', limit: 3 });

  const nearbyListings = nearbyRes.listings;
  const newestListings = newestRes.listings;

  const categoryIcons: Record<string, React.ReactNode> = {
    'is-makineleri': <Wrench className="w-6 h-6 text-orange-500" />,
    'yapi-malzemeleri': <Boxes className="w-6 h-6 text-orange-500" />,
    'nakliye': <Truck className="w-6 h-6 text-orange-500" />,
    'iskele-kalip': <Layers className="w-6 h-6 text-orange-500" />,
    'asansor-platform': <ChevronsUp className="w-6 h-6 text-orange-500" />,
    'santiye-ekipmanlari': <HardHat className="w-6 h-6 text-orange-500" />,
    'insaat-hizmetleri': <Hammer className="w-6 h-6 text-orange-500" />,
  };

  const categoryDescriptions: Record<string, string> = {
    'is-makineleri': 'Ekskavatör, JCB, dozer, vinç ve operatörlü kiralama',
    'yapi-malzemeleri': 'Çimento, hazır beton, inşaat demiri, tuğla ve yalıtım',
    'nakliye': 'Hafriyat kamyonu, lowbed ağır nakliye ve vinç taşımacılığı',
    'iskele-kalip': 'Güvenlikli cephe iskelesi, kule iskele, endüstriyel kalıp ve montaj',
    'asansor-platform': 'İnşaat cephe asansörleri, manlift, makaslı ve eklemli platformlar',
    'santiye-ekipmanlari': 'Şantiye konteynerleri, dizel jeneratörler, aydınlatma ve İSG',
    'insaat-hizmetleri': 'Hafriyat, temel kazısı, beton dökümü, mantolama ve mühendislik',
  };

  // Aynı ilan iki bölümde tekrar etmesin: önce yakındakiler, sonra kalan yeni ilanlar
  const seen = new Set<string>();
  const listings = [...nearbyListings, ...newestListings].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  // Vitrin yalnız gerçek (örnek olmayan) sponsorlu ilan varsa gösterilir
  const realShowcase = showcaseListings.filter((item) => !item.is_demo);

  const sectionTitle = 'text-xl sm:text-2xl font-bold text-navy-900';
  const sectionLink = 'text-sm font-semibold text-orange-600 hover:text-orange-700 inline-flex items-center gap-1';

  return (
    <div className="pb-16">
      <HeroSearch />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10 sm:mt-14 space-y-12 sm:space-y-16">
        {/* Kategoriler */}
        <section className="space-y-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className={sectionTitle}>Kategoriler</h2>
            <Link href="/ilanlar" className={sectionLink}>
              Tüm ilanlar
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {CATEGORIES.map((cat) => (
              <Link
                key={cat.id}
                href={`/ilanlar?category=${cat.slug}`}
                className="flex items-start gap-3 bg-white rounded-lg border border-slate-200 p-4 hover:border-orange-400 transition-colors"
              >
                <span className="shrink-0 mt-0.5">
                  {categoryIcons[cat.slug] || <Wrench className="w-6 h-6 text-orange-500" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-navy-900">{cat.name}</span>
                  <span className="block text-sm text-slate-500 mt-0.5 leading-snug">
                    {categoryDescriptions[cat.slug] || 'Şantiye ekipmanı, malzeme ve hizmetler'}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Sponsorlu ilanlar (yalnız gerçek ilan varsa) */}
        {realShowcase.length > 0 && (
          <section className="space-y-5">
            <h2 className={sectionTitle}>Öne çıkan ilanlar</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {realShowcase.map((item) => (
                <ListingCard key={`showcase-${item.id}`} listing={item} />
              ))}
            </div>
          </section>
        )}

        {/* İlanlar */}
        <section className="space-y-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className={sectionTitle}>İlanlar</h2>
            <Link href="/ilanlar?sort=newest" className={sectionLink}>
              Hepsini gör
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {listings.length === 0 ? (
            <div className="bg-white rounded-lg border border-slate-200 p-8 text-center space-y-4">
              <p className="text-base font-semibold text-navy-900">Henüz yayında ilan yok</p>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                İhtiyacınızı yazın, bölgenizdeki firmalar size teklif göndersin. Firmaysanız ilk ilanı siz verin.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  href="/teklif-iste"
                  className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors"
                >
                  Teklif iste
                </Link>
                <Link
                  href="/kayit?role=company"
                  className="px-5 py-2.5 rounded-lg border border-slate-300 hover:border-navy-900 text-navy-900 font-semibold text-sm transition-colors"
                >
                  Firma olarak ilan ver
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {listings.map((item) => (
                <ListingCard key={item.id} listing={item} />
              ))}
            </div>
          )}
        </section>

        {/* Hesaplayıcı */}
        <section className="bg-white rounded-lg border border-slate-200 p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="max-w-2xl space-y-2">
            <h2 className={sectionTitle}>Metraj ve malzeme hesaplayıcı</h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Beton ve mikser sayısını, demir tonajını, duvar malzemesini ve iskele metrajını hesaplayın;
              çıkan listeyle yakındaki firmalardan teklif isteyin.
            </p>
          </div>
          <div className="shrink-0 flex flex-wrap gap-3">
            <Link
              href="/hesaplayici"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-navy-900 hover:bg-navy-800 text-white font-semibold text-sm transition-colors"
            >
              <Calculator className="w-4 h-4" />
              Hesaplayıcıyı aç
            </Link>
            <Link
              href="/teklif-iste"
              className="px-5 py-2.5 rounded-lg border border-slate-300 hover:border-navy-900 text-navy-900 font-semibold text-sm transition-colors"
            >
              Teklif iste
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
