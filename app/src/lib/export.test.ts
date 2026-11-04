import { toCSV, toMarkdown } from './export'

const result = {
  columns: ['id', 'note', 'meta'],
  rows: [[1, 'say "hi", twice', { a: 1 }], [2, null, 'x|y']],
  truncated: false, offset: 0, total: null,
}

test('CSV quotes commas and quotes, serialises objects, leaves null empty', () => {
  expect(toCSV(result)).toBe('id,note,meta\r\n1,"say ""hi"", twice","{""a"":1}"\r\n2,,x|y')
})

test('Markdown escapes pipes', () => {
  expect(toMarkdown(result).split('\n')[3]).toBe('| 2 |  | x\\|y |')
})
