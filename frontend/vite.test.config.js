// frontend สำหรับ UI test — พอร์ต 3001 ชี้ไป backend ทดสอบ (5051 / ฐาน barbershop_test)
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

export default mergeConfig(base, defineConfig({
  server: {
    port: 3001,
    proxy: { '/api': { target: 'http://localhost:5051', changeOrigin: true } },
  },
}));
