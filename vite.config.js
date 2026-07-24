import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  build: {
    // Raise chunk warning limit slightly (leaflet is unavoidably large)
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        manualChunks: {
          // React core — tiny, cached forever
          'vendor-react': ['react', 'react-dom'],

          // Supabase — only needed after first interaction
          'vendor-supabase': ['@supabase/supabase-js'],

          // Framer Motion — heavy, split out so main bundle stays lean
          'vendor-framer': ['framer-motion'],

          // Leaflet + react-leaflet — only used on map screen
          'vendor-leaflet': ['leaflet', 'react-leaflet'],

          // Lucide icons — tree-shaken by Vite but isolate anyway
          'vendor-icons': ['lucide-react'],

          // QR code — only used in admin
          'vendor-qrcode': ['qrcode'],
        },
      },
    },

    // Minify with esbuild (default, fast + good)
    minify: 'esbuild',

    // Generate source maps only in dev
    sourcemap: false,

    // Target modern browsers (smaller output, no IE polyfills)
    target: 'es2020',
  },

  // Pre-bundle these for faster dev too
  optimizeDeps: {
    include: ['react', 'react-dom', '@supabase/supabase-js'],
    exclude: ['leaflet', 'react-leaflet'],
  },
})
