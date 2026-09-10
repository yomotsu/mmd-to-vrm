import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/mmd-to-vrm/',
  plugins: [tailwindcss()],
});
