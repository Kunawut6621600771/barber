import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    // ให้เปิดผ่าน URL ของ tunnel (ngrok / cloudflared) ได้ — LINE ต้องการ https
    allowedHosts: true,
    proxy: {
      // ยิง /api ไปที่ backend เพื่อเลี่ยงปัญหา CORS ตอน dev
      '/api': {
        target: 'http://localhost:5050',
        changeOrigin: true,
      },
    },
  },
});
