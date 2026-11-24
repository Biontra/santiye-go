import type { Config } from "tailwindcss";

/**
 * ŞantiyeGO tasarım sistemi
 *
 * - navy   : grafit / mürekkep tonları (marka koyu rengi)
 * - orange : iş güvenliği turuncusu, yalnızca vurgu ve birincil eylemler için
 * - slate  : nötr, hafif sıcak gri skala (soğuk mavi-gri yerine)
 * - Köşeler küçük, gölgeler hafif, yazı ağırlıkları ölçülü tutulur.
 */
export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          600: "#3A3F45",
          700: "#2C3035",
          800: "#202327",
          900: "#17191C",
          950: "#0F1113",
        },
        orange: {
          50: "#FFF5EE",
          100: "#FDE7D7",
          200: "#F9CDAE",
          300: "#F3AA78",
          400: "#EC8645",
          500: "#E0661B",
          600: "#C75512",
          700: "#A2440E",
          800: "#7E360D",
          900: "#5F2A0C",
        },
        yellow: {
          400: "#F2C230",
          500: "#E0AC12",
          600: "#B88A0A",
        },
        slate: {
          50: "#F7F7F5",
          100: "#EFEFEC",
          200: "#E2E2DE",
          300: "#CDCDC8",
          400: "#9C9C96",
          500: "#6E6E69",
          600: "#53534F",
          700: "#3D3D3A",
          800: "#2A2A28",
          900: "#1C1C1A",
        },
        surface: {
          50: "#F7F7F5",
          100: "#EFEFEC",
          200: "#E2E2DE",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontWeight: {
        // Aşırı kalın (900) başlıklar yerine ölçülü ağırlıklar
        extrabold: "600",
        black: "700",
      },
      borderRadius: {
        md: "4px",
        lg: "5px",
        xl: "6px",
        "2xl": "8px",
        "3xl": "10px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(23, 25, 28, 0.05)",
        DEFAULT: "0 1px 3px rgba(23, 25, 28, 0.08)",
        md: "0 2px 6px rgba(23, 25, 28, 0.08)",
        lg: "0 4px 14px rgba(23, 25, 28, 0.10)",
        xl: "0 8px 24px rgba(23, 25, 28, 0.12)",
        "2xl": "0 12px 32px rgba(23, 25, 28, 0.16)",
      },
      letterSpacing: {
        tight: "-0.015em",
        tighter: "-0.025em",
      },
    },
  },
  plugins: [],
} satisfies Config;
