import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — tiny, cached forever after first visit
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // Supabase — only needed after first interaction, not on initial paint
          if (id.includes('node_modules/@supabase/')) {
            return 'vendor-supabase';
          }
          // Leaflet + react-leaflet — only used on delivery map screen
          if (id.includes('node_modules/leaflet') || id.includes('node_modules/react-leaflet')) {
            return 'vendor-leaflet';
          }
          // Lucide icons — large but tree-shaken; isolate so it caches independently
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          // QR code — admin only, never needed on customer path
          if (id.includes('node_modules/qrcode')) {
            return 'vendor-qrcode';
          }
          // Razorpay loads via script tag at runtime — no bundle entry needed
        },
      },
    },

    // esbuild minifier: fast + produces smaller output than terser for this stack
    minify: 'esbuild',

    // Source maps only in dev — don't ship them to production
    sourcemap: false,

    // Target modern browsers: drops IE/legacy polyfills (~30 KiB saved)
    target: 'es2020',
  },

  optimizeDeps: {
    include: ['react', 'react-dom', '@supabase/supabase-js'],
    // Exclude map libs from pre-bundling — they're only loaded on the delivery screen
    exclude: ['leaflet', 'react-leaflet'],
  },
})
