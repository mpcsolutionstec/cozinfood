import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const readEnv = (...names) => names.map((name) => process.env[name] || env[name]).find(Boolean);
  const supabaseEnv = [
    ['import.meta.env.VITE_SUPABASE_URL', readEnv('VITE_SUPABASE_URL', 'SUPABASE_URL')],
    [
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY',
      readEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY'),
    ],
    [
      'import.meta.env.VITE_SUPABASE_ANON_KEY',
      readEnv('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'),
    ],
  ].filter(([, value]) => value);

  return {
    plugins: [react()],
    base: process.env.GITHUB_ACTIONS ? '/cozinfood/' : '/',
    define: Object.fromEntries(supabaseEnv.map(([key, value]) => [key, JSON.stringify(value)])),
  };
});
