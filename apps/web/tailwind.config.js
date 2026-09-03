import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          muted: 'hsl(var(--sidebar-muted))',
          accent: 'hsl(var(--sidebar-accent))',
          border: 'hsl(var(--sidebar-border))',
        },
        risk: {
          low: 'hsl(var(--risk-low))',
          medium: 'hsl(var(--risk-medium))',
          high: 'hsl(var(--risk-high))',
        },
        glass: {
          DEFAULT: 'hsl(var(--glass-bg))',
          border: 'hsl(var(--glass-border))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 10px 32px -14px rgb(79 70 229 / 0.14), 0 2px 8px -4px rgb(15 23 42 / 0.05)',
        'card-hover': '0 16px 40px -16px rgb(79 70 229 / 0.22), 0 6px 16px -8px rgb(15 23 42 / 0.08)',
        sidebar: '0 18px 40px -18px rgb(61 50 140 / 0.45)',
        glow: '0 0 40px -8px hsl(244 54% 52% / 0.45)',
        'glow-sm': '0 0 20px -6px hsl(244 54% 52% / 0.35)',
        'glow-violet': '0 0 40px -8px hsl(262 72% 58% / 0.35)',
        'inner-glow': 'inset 0 1px 0 0 rgb(255 255 255 / 0.08)',
        glass: '0 8px 32px -8px hsl(244 54% 52% / 0.1), inset 0 1px 0 0 hsl(0 0% 100% / 0.06)',
        'glass-hover': '0 0 0 1px hsl(244 54% 52% / 0.25), 0 12px 40px -8px hsl(244 54% 52% / 0.18)',
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'fade-in-up': 'fadeInUp 0.5s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'slide-up-fade': 'slide-up-fade 0.6s ease-out',
        shimmer: 'shimmer 1.8s infinite',
        float: 'float 8s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2.5s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 4s ease-in-out infinite alternate',
        'count-up': 'count-up 0.5s ease-out',
        'spin-slow': 'spin-slow 10s linear infinite',
        'border-glow': 'border-glow-pulse 2.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '33%': { transform: 'translateY(-18px) rotate(2deg)' },
          '66%': { transform: 'translateY(-8px) rotate(-1deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 12px -4px hsl(239 84% 67% / 0.4)' },
          '50%': { boxShadow: '0 0 32px -4px hsl(239 84% 67% / 0.8)' },
        },
        'gradient-shift': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '100% 50%' },
        },
        'count-up': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-up-fade': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        'border-glow-pulse': {
          '0%, 100%': { borderColor: 'hsl(239 84% 67% / 0.2)' },
          '50%': { borderColor: 'hsl(239 84% 67% / 0.6)' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
