import assert from 'node:assert/strict'
import test from 'node:test'
import { ItemCpuLimitError, scanObfuscatedEmail } from './safe-text-scan.ts'

test('extracts a bounded obfuscated email address', () => {
  assert.equal(scanObfuscatedEmail('連絡先 info [at] example.co.jp です', 100), 'info@example.co.jp')
  assert.equal(scanObfuscatedEmail('メールの掲載はありません', 100), null)
})

test('interrupts an item when its text scan exceeds the CPU limit', () => {
  assert.throws(
    () => scanObfuscatedEmail('x'.repeat(5_000_000), 1, 5_000_000),
    (error) => error instanceof ItemCpuLimitError && error.code === 'cpu_budget_exceeded'
  )
})
