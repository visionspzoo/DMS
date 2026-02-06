/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark mode colors
        'dark-bg': 'hsl(220, 15%, 8%)',
        'dark-surface': 'hsl(220, 12%, 12%)',
        'dark-surface-variant': 'hsl(220, 10%, 16%)',
        // Light mode colors
        'light-bg': 'hsl(220, 15%, 98%)',
        'light-surface': 'hsl(0, 0%, 100%)',
        'light-surface-variant': 'hsl(220, 10%, 96%)',
        // Brand colors
        'brand-primary': 'hsl(210, 85%, 58%)',
        'brand-primary-hover': 'hsl(210, 85%, 48%)',
        // Status colors
        'status-success': 'hsl(145, 70%, 45%)',
        'status-warning': 'hsl(35, 90%, 55%)',
        'status-error': 'hsl(0, 75%, 60%)',
        // AI processing accent
        'ai-accent': 'hsl(270, 75%, 65%)',
        // Text colors
        'text-primary-dark': 'hsl(220, 10%, 95%)',
        'text-secondary-dark': 'hsl(220, 8%, 70%)',
        'text-primary-light': 'hsl(220, 10%, 10%)',
        'text-secondary-light': 'hsl(220, 8%, 40%)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
