import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: 'var(--ink)',
        canvas: 'var(--canvas)',
        paper: 'var(--paper)',
        line: 'var(--line)',
        muted: 'var(--muted)',
        clay: 'var(--clay)',
        amber: 'var(--amber)',
        moss: 'var(--moss)',
      },
      boxShadow: {
        card: '0 18px 50px rgba(30, 27, 23, 0.08)',
        lift: '0 24px 70px rgba(30, 27, 23, 0.14)',
      },
      maxWidth: {
        shell: '1200px',
      },
    },
  },
  plugins: [],
};

export default config;
