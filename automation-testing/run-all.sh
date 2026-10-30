#!/usr/bin/env bash
# รันการทดสอบทั้งหมดแล้วสร้างเอกสาร xlsx
# ต้องเปิดไว้ก่อน: backend ทดสอบ :5051 และ frontend ทดสอบ :3001 (ดู README ในโฟลเดอร์นี้)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/automation-testing/results"
mkdir -p "$OUT"

cd "$ROOT/backend"
node --test --test-reporter=tap "tests/unit/*.test.js" > "$OUT/unit.tap" 2>&1
node --test --test-concurrency=1 --test-reporter=tap "tests/e2e/*.e2e.test.js" > "$OUT/e2e.tap" 2>&1

cd "$ROOT/automation-testing"
.venv/Scripts/robot --outputdir results --loglevel INFO tests/ > "$OUT/robot-console.txt" 2>&1

PYTHONIOENCODING=utf-8 .venv/Scripts/python build_report.py
