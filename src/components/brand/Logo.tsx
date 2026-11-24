import Link from 'next/link';

/**
 * ŞantiyeGO marka işareti: çelik I-profil (HEA) kesiti.
 * Genel amaçlı ikon kütüphanesi yerine markaya özel, sade bir işaret.
 */
export function LogoMark({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="4" fill="#E0661B" />
      <path d="M8 8h16v3.5h-6.25v9h6.25V24H8v-3.5h6.25v-9H8z" fill="#fff" />
    </svg>
  );
}

export default function Logo({
  tone = 'dark',
  href = '/',
}: {
  tone?: 'dark' | 'light';
  href?: string;
}) {
  const text = tone === 'light' ? 'text-white' : 'text-navy-900';
  return (
    <Link href={href} className="flex items-center gap-2.5 shrink-0" aria-label="ŞantiyeGO ana sayfa">
      <LogoMark />
      <span className={`text-[19px] font-semibold tracking-tight leading-none ${text}`}>
        Şantiye<span className="text-orange-500">GO</span>
      </span>
    </Link>
  );
}
