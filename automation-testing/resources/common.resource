*** Settings ***
Library     Browser    timeout=15s
Library     String

*** Variables ***
${BASE_URL}       http://localhost:3001
${PASSWORD}       123456
${STAFF}          staff@trimco.local
${ADMIN}          admin@trimco.local
${CUSTOMER}       arin@example.com
${HEADLESS}       ${True}

*** Keywords ***
Open App
    New Browser    chromium    headless=${HEADLESS}
    New Context    viewport={'width': 1366, 'height': 820}    locale=th-TH
    New Page    ${BASE_URL}/login

Close App
    Close Browser    ALL

Login As
    [Arguments]    ${email}    ${password}=${PASSWORD}
    Go To    ${BASE_URL}/login
    Fill Text    input[type="email"]    ${email}
    Fill Text    input[type="password"]    ${password}
    Click    button[type="submit"]
    Wait For Condition    Url    not contains    /login

Logout
    Evaluate JavaScript    ${None}    () => localStorage.clear()
    Go To    ${BASE_URL}/login

Register New Customer
    [Documentation]    สมัครลูกค้าใหม่ผ่านหน้าเว็บ คืนอีเมลที่สมัคร
    ${uniq}=    Generate Random String    8    [NUMBERS]
    ${email}=    Set Variable    ui_${uniq}@example.com
    Go To    ${BASE_URL}/register
    Fill Text    input[autocomplete="name"]    ลูกค้า ยูไอ${uniq}
    Fill Text    input[type="email"]    ${email}
    Fill Text    input[autocomplete="tel"]    09${uniq}
    Fill Text    input[autocomplete="new-password"] >> nth=0    ${PASSWORD}
    Fill Text    input[autocomplete="new-password"] >> nth=1    ${PASSWORD}
    Check Checkbox    input[type="checkbox"]
    Click    button[type="submit"]
    Wait For Condition    Url    not contains    /register
    RETURN    ${email}
