import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Cormorant Garamond', 'Georgia', 'serif'],
        ui: ['Syne', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        void: '#020408',
        glass: {
          DEFAULT: 'rgba(255,255,255,0.04)',
          light: 'rgba(255,255,255,0.08)',
          border: 'rgba(255,255,255,0.10)',
          bright: 'rgba(255,255,255,0.18)',
        },
        cyan: {
          400: '#e63946',
          500: '#c1121f',
          glow: 'rgba(230,57,70,0.3)',
        },
        gold: {
          300: '#fde68a',
          400: '#fbbf24',
          500: '#f59e0b',
          glow: 'rgba(251,191,36,0.4)',
        },
        emerald: {
          glass: 'rgba(16,185,129,0.15)',
        },
      },
      backdropBlur: {
        glass: '24px',
        heavy: '48px',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'caustic': 'caustic 8s ease-in-out infinite',
        'card-deal': 'cardDeal 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards',
        'chip-slide': 'chipSlide 0.3s ease-out forwards',
        'fade-up': 'fadeUp 0.6s ease-out forwards',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        pulseGlow: {
          '0%,100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        caustic: {
          '0%,100%': { transform: 'scale(1) rotate(0deg)', opacity: '0.3' },
          '33%': { transform: 'scale(1.1) rotate(2deg)', opacity: '0.5' },
          '66%': { transform: 'scale(0.95) rotate(-1deg)', opacity: '0.35' },
        },
        cardDeal: {
          '0%': { transform: 'translateY(-40px) rotate(-5deg)', opacity: '0' },
          '100%': { transform: 'translateY(0) rotate(0deg)', opacity: '1' },
        },
        chipSlide: {
          '0%': { transform: 'translateX(-20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
