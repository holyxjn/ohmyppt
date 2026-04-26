import tailwindcss from 'tailwindcss'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#ffffff',
        foreground: '#0a0a0a',
        card: { DEFAULT: '#ffffff', foreground: '#0a0a0a' },
        primary: { DEFAULT: '#171717', foreground: '#fafafa' },
        secondary: { DEFAULT: '#f5f5f5', foreground: '#171717' },
        muted: { DEFAULT: '#f5f5f5', foreground: '#737373' },
        accent: { DEFAULT: '#f5f5f5', foreground: '#171717' },
        destructive: '#ef4444',
        border: '#e5e5e5',
        input: '#e5e5e5',
        ring: '#171717',
      },
      borderRadius: {
        sm: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
      },
    },
  },
  plugins: [],
}
