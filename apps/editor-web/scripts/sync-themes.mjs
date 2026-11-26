import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.resolve(root, '../../packages/wechat-theme/dist')
const target = path.join(root, 'assets/themes')
await mkdir(target, { recursive: true })
for (const id of ['tech-blue', 'editorial-red', 'jade-notes']) {
  const css = await readFile(path.join(source, `${id}.css`), 'utf8')
  await writeFile(path.join(target, `${id}.css`), css, 'utf8')
  console.log(`synced assets/themes/${id}.css`)
}
