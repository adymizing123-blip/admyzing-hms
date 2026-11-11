import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecfdf9', 100: '#d1faef', 200: '#a7f3df', 300: '#6ee7c9', 400: '#34d3ad',
          500: '#10b993', 600: '#059677', 700: '#047862', 800: '#065f4f', 900: '#064e42', 950: '#022c26',
        },
        ink: { DEFAULT: '#0f172a', soft: '#475569', muted: '#94a3b8' },
      },
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(15,23,42,.04), 0 4px 16px rgba(15,23,42,.06)' },
    },
  },
  plugins: [],
} satisfies Config;
