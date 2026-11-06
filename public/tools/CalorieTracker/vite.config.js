import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  // Development server configuration
  server: {
    port: 3000,
    host: true, // Allow external connections
    open: true, // Open browser automatically
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), '../../shared'],
    },
  },
  
  // Build configuration
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  
  // Enable ES modules
  esbuild: {
    target: 'es2020'
  },
  
  // Optimize dependencies
  optimizeDeps: {
    include: []
  }
});