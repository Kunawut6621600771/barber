*** Settings ***
Documentation     UI test บนเบราว์เซอร์จริง (Robot Framework + Browser/Playwright)
...               ต้องเปิด frontend :3001 และ backend :5051 (ฐาน barbershop_test) ก่อนรัน
Resource          ../resources/common.resource
Suite Setup       Open App
Suite Teardown    Close App
Test Setup        Logout

*** Test Cases ***
UI-01 หน้าเข้าสู่ระบบแสดงฟอร์มและปุ่มบัญชีทดสอบ
    Go To    ${BASE_URL}/login
    Get Element Count    input[type="email"]    ==    1
    Get Element Count    input[type="password"]    ==    1
    Get Text    button[type="submit"]    contains    เข้าสู่ระบบ

UI-02 รหัสผ่านผิด แสดงข้อความแจ้งเตือนและยังอยู่หน้าเดิม
    Go To    ${BASE_URL}/login
    Fill Text    input[type="email"]    ${STAFF}
    Fill Text    input[type="password"]    wrongpass
    Click    button[type="submit"]
    Wait For Elements State    text=/ไม่ถูกต้อง|ผิด/    visible
    Get Url    contains    /login

UI-03 พนักงานเข้าสู่ระบบแล้วเห็นเมนูจัดการคิว
    Login As    ${STAFF}
    Wait For Elements State    a[href="/app/queue"]    visible
    Get Element Count    a[href="/app/pos"]    ==    0

UI-04 ลูกค้าสมัครสมาชิกใหม่ผ่านหน้าเว็บ แล้วเข้าระบบอัตโนมัติ
    Register New Customer
    Wait For Elements State    a[href="/app/take-queue"]    visible

UI-05 ลูกค้ารับบัตรคิวผ่านหน้าเว็บ ได้เลขคิวและ QR ติดตาม
    Register New Customer
    Go To    ${BASE_URL}/app/take-queue
    Click    .svc-card.selectable >> nth=0
    Click    button.btn.primary.block.lg
    Wait For Elements State    text=รับบัตรคิวสำเร็จ    visible
    Get Text    .ticket-hero .number    matches    ^[A-Z]-\\d{3}$
    Wait For Elements State    img[alt="QR ติดตามคิว"]    visible

UI-06 ลูกค้าเห็นคิวของตัวเองที่หน้า "คิวของฉัน"
    Register New Customer
    Go To    ${BASE_URL}/app/take-queue
    Click    .svc-card.selectable >> nth=0
    Click    button.btn.primary.block.lg
    Wait For Elements State    text=รับบัตรคิวสำเร็จ    visible
    ${no}=    Get Text    .ticket-hero .number
    Click    text=ดูสถานะคิวของฉัน
    Wait For Elements State    text=${no}    visible

UI-07 พนักงานเรียกคิวถัดไปจากหน้าจัดการคิว
    Login As    ${STAFF}
    Go To    ${BASE_URL}/app/queue
    Wait For Elements State    text=เรียกคิวถัดไป    visible
    Click    text=เรียกคิวถัดไป
    Wait For Elements State    text=/เรียกคิว [A-Z]-\\d{3}/    visible

UI-08 ลูกค้าเข้าหน้าของพนักงานไม่ได้ (ถูกพากลับ)
    Login As    ${CUSTOMER}
    Go To    ${BASE_URL}/app/users
    Wait For Condition    Url    not contains    /app/users

UI-09 หน้าที่ถูกลบ (POS) พากลับหน้าหลัก ไม่ค้างหน้าว่าง
    Login As    ${STAFF}
    Go To    ${BASE_URL}/app/pos
    Wait For Condition    Url    not contains    /app/pos

UI-10 ลูกค้าจองล่วงหน้าผ่านหน้าเว็บ
    Register New Customer
    Go To    ${BASE_URL}/app/book
    Wait For Elements State    h1 >> text=/จอง/    visible

UI-11 จอแสดงคิวหน้าร้านเปิดได้โดยไม่ต้องล็อกอิน
    Go To    ${BASE_URL}/board
    Wait For Load State    networkidle
    Get Url    contains    /board

UI-12 เมนู "กะและเงินสด" ถูกลบ และหน้าเดิมพากลับหน้าหลัก
    Login As    ${STAFF}
    Wait For Elements State    a[href="/app/queue"]    visible
    Get Element Count    a[href="/app/shifts"]    ==    0
    Go To    ${BASE_URL}/app/shifts
    Wait For Condition    Url    not contains    /app/shifts

UI-13 แอดมินเปิดหน้าประวัติการโอน เห็นตารางรายการหรือข้อความว่าไม่มีรายการ
    Login As    ${ADMIN}
    Click    a[href="/app/transfers"]
    Wait For Elements State    h1 >> text=ประวัติการโอน    visible
    Wait For Elements State    css=table.data, .empty >> nth=0    visible
