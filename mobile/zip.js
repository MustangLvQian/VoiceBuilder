// Minimal ZIP writer (store method, no compression).
//
// The phone needs to hand 89 recorded WAVs back to the desktop somehow. Zipping
// them into one file is the only practical route: WAVs barely compress, so
// "store" is fine, and it avoids a compression dependency and the async
// CompressionStream API. Pure functions, unit-tested in Node.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  throw new TypeError('zip entry data must be binary')
}

// DOS date/time, the only timestamp format ZIP supports.
function dosDateTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31)
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
  return { time, date: day }
}

export function createZip(entries, now = new Date()) {
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(now)
  const prepared = entries.map((entry) => {
    const name = encoder.encode(entry.name)
    const data = toBytes(entry.data)
    return { name, data, crc: crc32(data), offset: 0 }
  })

  let size = 0
  for (const entry of prepared) size += 30 + entry.name.length + entry.data.length
  const centralSize = prepared.reduce((sum, entry) => sum + 46 + entry.name.length, 0)
  const buffer = new Uint8Array(size + centralSize + 22)
  const view = new DataView(buffer.buffer)
  let offset = 0

  for (const entry of prepared) {
    entry.offset = offset
    view.setUint32(offset, 0x04034b50, true)      // local file header
    view.setUint16(offset + 4, 20, true)          // version needed
    view.setUint16(offset + 6, 0x0800, true)      // general purpose flag: UTF-8 names
    view.setUint16(offset + 8, 0, true)           // method: store
    view.setUint16(offset + 10, time, true)
    view.setUint16(offset + 12, date, true)
    view.setUint32(offset + 14, entry.crc, true)
    view.setUint32(offset + 18, entry.data.length, true)
    view.setUint32(offset + 22, entry.data.length, true)
    view.setUint16(offset + 26, entry.name.length, true)
    view.setUint16(offset + 28, 0, true)          // extra length
    buffer.set(entry.name, offset + 30)
    buffer.set(entry.data, offset + 30 + entry.name.length)
    offset += 30 + entry.name.length + entry.data.length
  }

  const centralStart = offset
  for (const entry of prepared) {
    view.setUint32(offset, 0x02014b50, true)      // central directory header
    view.setUint16(offset + 4, 20, true)          // version made by
    view.setUint16(offset + 6, 20, true)          // version needed
    view.setUint16(offset + 8, 0x0800, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, time, true)
    view.setUint16(offset + 14, date, true)
    view.setUint32(offset + 16, entry.crc, true)
    view.setUint32(offset + 20, entry.data.length, true)
    view.setUint32(offset + 24, entry.data.length, true)
    view.setUint16(offset + 28, entry.name.length, true)
    view.setUint16(offset + 30, 0, true)          // extra
    view.setUint16(offset + 32, 0, true)          // comment
    view.setUint16(offset + 34, 0, true)          // disk number
    view.setUint16(offset + 36, 0, true)          // internal attrs
    view.setUint32(offset + 38, 0, true)          // external attrs
    view.setUint32(offset + 42, entry.offset, true)
    buffer.set(entry.name, offset + 46)
    offset += 46 + entry.name.length
  }

  view.setUint32(offset, 0x06054b50, true)        // end of central directory
  view.setUint16(offset + 4, 0, true)
  view.setUint16(offset + 6, 0, true)
  view.setUint16(offset + 8, prepared.length, true)
  view.setUint16(offset + 10, prepared.length, true)
  view.setUint32(offset + 12, offset - centralStart, true)
  view.setUint32(offset + 16, centralStart, true)
  view.setUint16(offset + 20, 0, true)

  return buffer
}
