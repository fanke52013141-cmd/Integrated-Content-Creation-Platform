import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { detectImageType, readImageDimensions, resolveInside } from '../server/images.mjs'

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const JPEG_1X1 = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64')

test('detectImageType uses file signatures, not extensions', () => {
  assert.equal(detectImageType(PNG_1X1), 'png')
  assert.equal(detectImageType(JPEG_1X1), 'jpg')
  assert.equal(detectImageType(Buffer.from('<svg></svg>')), null)
})

test('readImageDimensions reads PNG and JPEG dimensions', () => {
  assert.deepEqual(readImageDimensions(PNG_1X1), { width: 1, height: 1 })
  assert.deepEqual(readImageDimensions(JPEG_1X1), { width: 1, height: 1 })
})

test('resolveInside blocks traversal and absolute paths', () => {
  assert.equal(resolveInside('poc/fixtures', 'assets/a.png'), path.resolve('poc/fixtures', 'assets/a.png'))
  assert.throws(() => resolveInside('poc/fixtures', '../secret'), /越界/)
  assert.throws(() => resolveInside('poc/fixtures', 'D:\\secret'), /非法素材路径/)
})
