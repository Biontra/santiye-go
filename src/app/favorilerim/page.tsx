'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, Search, ArrowRight, ShieldCheck, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Listing } from '@/types/database';
import ListingCard from '@/components/listings/ListingCard';

export default function FavoritesPage() {
  const router = useRouter();
  const [favorites, setFavorites] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLoggedIn, setUserLoggedIn] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    async function loadFavorites() {
      try {
        setLoading(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setUserLoggedIn(false);
          // İstemci yerel hafıza yedeği kontrolü
          try {
            const raw = localStorage.getItem('santiyego_favorites');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) setFavorites(parsed);
            }
          } catch {}
          setLoading(false);
          return;
        }

        setUserLoggedIn(true);

        // Canlı Supabase favorites tablosundan çek
        const { data: favRows, error: favErr } = await supabase
          .from('favorites')
          .select(`
            listing_id,
            listing:listings(
              *,
              category:categories(name, slug),
              city:cities(name),
              district:districts(name)
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (!favErr && favRows && favRows.length > 0) {
          const loaded: Listing[] = favRows
            .filter((r: any) => r.listing && r.listing.status !== 'deleted')
            .map((r: any) => ({
              ...r.listing,
              city_name: r.listing.city?.name || '',
              district_name: r.listing.district?.name || '',
              category_name: r.listing.category?.name || '',
            }));
          setFavorites(loaded);
        } else {
          // Eğer Supabase'de henüz yoksa yerel hafıza kontrolü
          try {
            const raw = localStorage.getItem('santiyego_favorites');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setFavorites(parsed);
                // Canlı veritabanına otomatik senkronize et
                for (const item of parsed) {
                  if (item.id) {
                    await supabase.from('favorites').upsert({
                      user_id: user.id,
                      listing_id: item.id,
                    });
                  }
                }
              }
            }
          } catch {}
        }
      } catch (err) {
        console.error('Favoriler yüklenirken hata:', err);
      } finally {
        setLoading(false);
      }
    }

    loadFavorites();
  }, []);

  const handleFavoriteToggle = async (listingId: string, isFav: boolean) => {
    setFavorites((prev) => prev.filter((l) => l.id !== listingId));

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        if (!isFav) {
          await supabase
            .from('favorites')
            .delete()
            .eq('user_id', user.id)
            .eq('listing_id', listingId);
        } else {
          await supabase.from('favorites').upsert({
            user_id: user.id,
            listing_id: listingId,
          });
        }
      }

      // Yerel hafızayı da güncelle
      try {
        const raw = localStorage.getItem('santiyego_favorites');
        const list: Listing[] = raw ? JSON.parse(raw) : [];
        const next = list.filter((l) => l.id !== listingId);
        localStorage.setItem('santiyego_favorites', JSON.stringify(next));
      } catch {}
    } catch (err) {
      console.error('Favori silme hatası:', err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="bg-navy-900 rounded-3xl p-6 sm:p-8 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-orange-500 text-white flex items-center justify-center font-black shadow-lg shadow-orange-500/30">
            <Heart className="w-7 h-7 fill-current" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">Favori İlanlarım</h1>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Takip ettiğiniz iş makineleri, yapı malzemeleri ve şantiye ekipmanları
            </p>
          </div>
        </div>

        <Link
          href="/ilanlar"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs shadow-md transition"
        >
          <Search className="w-4 h-4" />
          <span>İlanları Keşfet</span>
        </Link>
      </div>

      {loading ? (
        <div className="min-h-[40vh] flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-500">Favorileriniz yükleniyor...</p>
        </div>
      ) : favorites.length === 0 ? (
        <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-12 text-center space-y-4 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto">
            <Heart className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-black text-navy-900">Henüz Favori İlanınız Yok</h2>
            <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
              İlan detaylarından kalp butonuna basarak beğendiğiniz makineleri ve malzemeleri buraya
              kaydedebilir, hızlıca teklif alabilirsiniz.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href="/ilanlar"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-navy-900 hover:bg-navy-800 text-white font-bold text-sm shadow-md transition"
            >
              <span>İlanları İncele</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
            <span>Toplam {favorites.length} favori kayıt</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {favorites.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isFavorited={true}
                onFavoriteToggle={handleFavoriteToggle}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
