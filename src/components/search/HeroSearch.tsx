'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import LocationAutocomplete from '@/components/search/LocationAutocomplete';

export default function HeroSearch() {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [radius, setRadius] = useState('25'); // Default 25 km as requested in Prompt 2
  const [locationData, setLocationData] = useState<{
    lat: number;
    lng: number;
    cityId?: number;
    districtId?: number;
    neighborhoodId?: number;
    postalCode?: string;
    label: string;
  } | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();

    const params = new URLSearchParams();
    if (keyword.trim()) params.set('q', keyword.trim());

    if (locationData) {
      params.set('lat', locationData.lat.toFixed(5));
      params.set('lng', locationData.lng.toFixed(5));
      if (radius && radius !== 'all') {
        params.set('radius', radius);
      }
      if (locationData.cityId) params.set('city', String(locationData.cityId));
      if (locationData.districtId) params.set('district', String(locationData.districtId));
      if (locationData.neighborhoodId) params.set('neighborhood', String(locationData.neighborhoodId));
      if (locationData.postalCode) params.set('postal_code', locationData.postalCode);
      if (locationData.label) params.set('location_label', locationData.label);
    }

    router.push(`/ilanlar?${params.toString()}`);
  };

  return (
    <div className="bg-navy-900 text-white py-10 md:py-14 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">
            Şantiyeniz için makine, malzeme ve nakliye
          </h1>
          <p className="text-slate-300 text-sm sm:text-base">
            Yakınınızdaki firmaların ilanlarını görün, fiyat teklifi alın.
          </p>
        </div>

        {/* Big Search Form Box */}
        <form
          onSubmit={handleSearch}
          className="bg-white rounded-xl p-3.5 sm:p-5 text-navy-900"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            {/* Input 1: "Ne arıyorsunuz?" */}
            <div className="md:col-span-5 relative text-left">
              <label className="block text-xs font-semibold text-slate-600 mb-1 pl-1">
                Ne arıyorsunuz?
              </label>
              <div className="relative flex items-center">
                <Search className="w-5 h-5 text-slate-400 absolute left-3.5 pointer-events-none" />
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Örn: ekskavatör, hazır beton, lowbed"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 hover:bg-slate-100/70 focus:bg-white text-navy-900 placeholder:text-slate-400 rounded-xl text-sm font-medium border border-slate-200 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none transition"
                />
              </div>
            </div>

            {/* Input 2: Location Autocomplete */}
            <div className="md:col-span-4 text-left">
              <LocationAutocomplete
                valueLabel={locationData?.label || ''}
                onSelectLocation={(data) => setLocationData(data)}
              />
            </div>

            {/* Button: "HEMEN ARA" */}
            <div className="md:col-span-3">
              <button
                type="submit"
                className="w-full py-3.5 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-base transition-colors flex items-center justify-center gap-2"
              >
                <Search className="w-5 h-5" />
                <span>Ara</span>
              </button>
            </div>
          </div>

          {/* Distance Radius Selector */}
          <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-2 px-1">
            <span className="font-semibold text-slate-700">Mesafe</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: '5 km', val: '5' },
                { label: '10 km', val: '10' },
                { label: '25 km', val: '25' },
                { label: '50 km', val: '50' },
                { label: '100 km', val: '100' },
                { label: 'Tüm Türkiye', val: 'all' },
              ].map((item) => (
                <button
                  key={item.val}
                  type="button"
                  onClick={() => setRadius(item.val)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                    radius === item.val
                      ? 'bg-navy-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </form>

        {/* Sık arananlar */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-300">
          <span className="text-slate-400">Sık arananlar:</span>
          {[
            'Ekskavatör',
            'Vinç',
            'Hazır beton',
            'Lowbed nakliye',
            'İnşaat demiri',
          ].map((tag) => (
            <button
              key={tag}
              onClick={() => {
                setKeyword(tag);
                router.push(`/ilanlar?q=${encodeURIComponent(tag)}`);
              }}
              className="underline underline-offset-4 decoration-slate-500 hover:text-white hover:decoration-white transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
