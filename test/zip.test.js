// Tests for mobile/zip.js. The real proof is that Python's zipfile (and Android,
// and Explorer) accept the archive, which the build script also checks; these
// tests pin the byte-level structure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createZip, crc32 } from '../mobile/zip.js'

const enc = (s) => new TextEncoder().encode(s)
const view = (buf) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

test('crc32 matches the canonical check value', () => {
  // 0xCBF43926 is the standard CRC-32 of "123456789".
  assert.equal(crc32(enc('123456789')), 0xcbf43926)
  assert.equal(crc32(new Uint8Array(0)), 0)
})

test('createZip lays out one stored entry', () => {
  const zip = createZip([{ name: 'a.wav', data: enc('hello') }], new Date(2024, 0, 2, 3, 4, 6))
  const dv = view(zip)
  assert.equal(dv.getUint32(0, true), 0x04034b50, 'local header signature')
  assert.equal(dv.getUint16(8, true), 0, 'stored, not deflated')
  assert.equal(dv.getUint32(14, true), crc32(enc('hello')))
  assert.equal(dv.getUint32(18, true), 5)
  assert.equal(dv.getUint16(26, true), 5, 'name length')
  assert.deepEqual(Array.from(zip.slice(30, 35)), Array.from(enc('a.wav')))
  assert.deepEqual(Array.from(zip.slice(35, 40)), Array.from(enc('hello')))
  // End of central directory is the last 22 bytes.
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50)
  assert.equal(dv.getUint16(zip.length - 22 + 10, true), 1, 'one entry')
})

test('createZip records each entry once in the central directory', () => {
  const zip = createZip([
    { name: 'one.wav', data: enc('1') },
    { name: 'two.wav', data: enc('22') },
    { name: 'three.wav', data: enc('333') },
  ])
  const dv = view(zip)
  const eocd = zip.length - 22
  assert.equal(dv.getUint16(eocd + 8, true), 3)
  assert.equal(dv.getUint16(eocd + 10, true), 3)
  const centralStart = dv.getUint32(eocd + 16, true)
  assert.equal(dv.getUint32(centralStart, true), 0x02014b50)
})

test('createZip accepts ArrayBuffer and typed-array views', () => {
  const raw = new Uint8Array([1, 2, 3, 4]).buffer
  const zip = createZip([
    { name: 'buf.wav', data: raw },
    { name: 'view.wav', data: new Uint16Array([1, 2]) },
  ])
  assert.equal(view(zip).getUint16(zip.length - 22 + 10, true), 2)
})

test('createZip rejects non-binary entries', () => {
  assert.throws(() => createZip([{ name: 'x', data: 'not bytes' }]), TypeError)
})
