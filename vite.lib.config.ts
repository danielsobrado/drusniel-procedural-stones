import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'package-dist',
    emptyOutDir: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/library/index.ts', import.meta.url)),
        three: fileURLToPath(new URL('./src/library/three/index.ts', import.meta.url)),
        presets: fileURLToPath(new URL('./src/library/presets.ts', import.meta.url))
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rolldownOptions: {
      external: ['three']
    }
  }
});
