/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        wiki: {
          bg: '#1e1e2e',
          sidebar: '#181825',
          surface: '#24273a',
          border: '#313244',
          text: '#cdd6f4',
          muted: '#6c7086',
          accent: '#89b4fa',
          link: '#89dceb',
          green: '#a6e3a1',
          red: '#f38ba8',
          yellow: '#f9e2af',
          purple: '#cba6f7',
          orange: '#fab387',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      typography: (theme) => ({
        wiki: {
          css: {
            color: theme('colors.wiki.text'),
            a: { color: theme('colors.wiki.link') },
            h1: { color: theme('colors.wiki.text') },
            h2: { color: theme('colors.wiki.text') },
            h3: { color: theme('colors.wiki.text') },
            strong: { color: theme('colors.wiki.text') },
            code: {
              color: theme('colors.wiki.purple'),
              backgroundColor: theme('colors.wiki.surface'),
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            blockquote: {
              color: theme('colors.wiki.muted'),
              borderLeftColor: theme('colors.wiki.accent'),
            },
            hr: { borderColor: theme('colors.wiki.border') },
            th: { color: theme('colors.wiki.text') },
          },
        },
      }),
    },
  },
  plugins: [],
}
