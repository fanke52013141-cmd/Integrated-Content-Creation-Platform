export interface DiffLine {
  kind: 'equal' | 'added' | 'removed'
  text: string
}

// 两端收缩后仍要算 LCS 的规模上限：再大就退化成整段替换，避免长文卡住主线程
const MAX_LCS_CELLS = 400_000

const splitLines = (value: string): string[] => value.replace(/\r\n/g, '\n').split('\n')

/**
 * 逐行差异：改稿前后要能一眼看出动了哪几段，而不是靠人重读一遍全文。
 * 行级（不按字切分）是刻意的——中文按字切出来的差异反而看不清改了什么。
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const oldLines = splitLines(before)
  const newLines = splitLines(after)
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head += 1
  let oldTail = oldLines.length - 1
  let newTail = newLines.length - 1
  while (oldTail >= head && newTail >= head && oldLines[oldTail] === newLines[newTail]) { oldTail -= 1; newTail -= 1 }

  const rows: DiffLine[] = []
  for (let index = 0; index < head; index += 1) rows.push({ kind: 'equal', text: oldLines[index] })
  const middleOld = oldLines.slice(head, oldTail + 1)
  const middleNew = newLines.slice(head, newTail + 1)

  if (middleOld.length * middleNew.length > MAX_LCS_CELLS) {
    for (const text of middleOld) rows.push({ kind: 'removed', text })
    for (const text of middleNew) rows.push({ kind: 'added', text })
  } else {
    const table = Array.from({ length: middleOld.length + 1 }, () => new Array<number>(middleNew.length + 1).fill(0))
    for (let i = middleOld.length - 1; i >= 0; i -= 1) {
      for (let j = middleNew.length - 1; j >= 0; j -= 1) {
        table[i][j] = middleOld[i] === middleNew[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < middleOld.length && j < middleNew.length) {
      if (middleOld[i] === middleNew[j]) { rows.push({ kind: 'equal', text: middleOld[i] }); i += 1; j += 1 }
      else if (table[i + 1][j] >= table[i][j + 1]) { rows.push({ kind: 'removed', text: middleOld[i] }); i += 1 }
      else { rows.push({ kind: 'added', text: middleNew[j] }); j += 1 }
    }
    while (i < middleOld.length) { rows.push({ kind: 'removed', text: middleOld[i] }); i += 1 }
    while (j < middleNew.length) { rows.push({ kind: 'added', text: middleNew[j] }); j += 1 }
  }

  for (let index = newTail + 1; index < newLines.length; index += 1) rows.push({ kind: 'equal', text: newLines[index] })
  return rows
}
