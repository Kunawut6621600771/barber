/**
 * ตำแหน่งช่องของ rich menu ใช้ร่วมกันระหว่างสคริปต์วาดรูป (line-richmenu-image.js)
 * และสคริปต์อัปโหลด (line-richmenu.js) เพื่อให้ช่องในรูปตรงกับพื้นที่กดเสมอ
 *
 *   ┌──────────┬──────────┬──────────┐
 *   │ คิวของฉัน │ รายการคิว │ ติดต่อร้าน │
 *   ├──────────┴──────────┼──────────┤
 *   │                     │ แต้มสะสม  │
 *   │   จองคิวและบริการ    ├──────────┤
 *   │                     │ สมัครสมาชิก│
 *   └─────────────────────┴──────────┘
 */
export const W = 2500;
export const H = 1686;

const CW = Math.floor(W / 3); // 833
const CH = Math.floor(H / 2); // 843
const HH = Math.floor((H - CH) / 2); // 421 ช่องเตี้ยด้านขวาล่าง

export const CELLS = {
  myQueue: { x: 0, y: 0, width: CW, height: CH },
  shopQueue: { x: CW, y: 0, width: CW, height: CH },
  contact: { x: CW * 2, y: 0, width: W - CW * 2, height: CH },
  book: { x: 0, y: CH, width: CW * 2, height: H - CH },
  points: { x: CW * 2, y: CH, width: W - CW * 2, height: HH },
  register: { x: CW * 2, y: CH + HH, width: W - CW * 2, height: H - CH - HH },
};
