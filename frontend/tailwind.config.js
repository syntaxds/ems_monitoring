/** @type {import('tailwindcss').Config} */
// Mirrors the design prototype's inline Tailwind config (index v2.html).
// Colors map onto the CSS-variable token layer defined in index.css, so the
// same utility classes drive both light and dark themes.
module.exports = {
  content: ['./src/**/*.{js,jsx}', './public/index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        surface3: 'var(--surface-3)',
        line: 'var(--border)',
        line2: 'var(--border-strong)',
        ink: 'var(--text)',
        ink2: 'var(--text-2)',
        ink3: 'var(--text-3)',
        accent: 'var(--accent)',
        accent2: 'var(--accent-2)',
        ok: 'var(--success)',
        warn: 'var(--warning)',
        bad: 'var(--danger)',
        info: 'var(--info)',
      },
      borderRadius: {
        card: 'var(--radius)',
        btn: 'var(--radius-sm)',
      },
    },
  },
  plugins: [],
};
