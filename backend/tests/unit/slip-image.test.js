import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSlipImage } from '../../src/utils/slip.js';

// หัวไฟล์จริงของแต่ละชนิด ต่อท้ายด้วยข้อมูลให้ยาวพอ
const pad = Buffer.alloc(120, 1);
const b64 = (hex) => Buffer.concat([Buffer.from(hex, 'hex'), pad]).toString('base64');
const PNG = b64('89504e470d0a1a0a');
const JPG = b64('ffd8ffe000104a464946');
const WEBP = b64('524946462400000057454250');

test('UT-SL-01 รูป PNG / JPEG / WEBP อ่าน mime จาก magic bytes ได้ถูก', () => {
  assert.equal(decodeSlipImage(`data:image/png;base64,${PNG}`).mime, 'image/png');
  assert.equal(decodeSlipImage(JPG).mime, 'image/jpeg');                    // base64 ล้วนไม่มี prefix
  assert.equal(decodeSlipImage(`data:image/webp;base64,${WEBP}`).mime, 'image/webp');
});

test('UT-SL-02 ไม่เชื่อ mime ที่ client บอก: แอบอ้างเป็น png แต่เนื้อเป็น jpeg -> jpeg', () => {
  assert.equal(decodeSlipImage(`data:image/png;base64,${JPG}`).mime, 'image/jpeg');
});

test('UT-SL-03 SVG / ข้อความ / ค่าว่าง / ไฟล์เล็กผิดปกติ -> null (ไม่เก็บ)', () => {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>${'x'.repeat(80)}</svg>`).toString('base64');
  assert.equal(decodeSlipImage(`data:image/svg+xml;base64,${svg}`), null);
  assert.equal(decodeSlipImage(''), null);
  assert.equal(decodeSlipImage(undefined), null);
  assert.equal(decodeSlipImage({ image: PNG }), null);
  assert.equal(decodeSlipImage(Buffer.from('89504e47', 'hex').toString('base64')), null);
});
