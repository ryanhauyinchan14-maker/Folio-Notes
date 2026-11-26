import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'vendor-notes';
          if (id.includes('pdf-lib')) return 'vendor-pdflib';
          if (id.includes('katex')) return 'vendor-katex';
          if (id.includes('@google/genai')) return 'vendor-genai';
          if (id.includes('@paper-design/shaders')) return 'vendor-shaders';
          if (id.includes('jszip') || id.includes('dexie')) return 'vendor-storage';
          if (id.includes('react-dom') || id.includes('\\react\\') || id.includes('/react/')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
