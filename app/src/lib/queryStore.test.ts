import { addHistory, exportStore, importStore, load, removeSaved, renameSaved, saveQuery } from './queryStore'

beforeEach(() => localStorage.clear())

test('history keeps the newest 50 entries, newest first, without consecutive duplicates', () => {
  for (let i = 0; i < 60; i++) addHistory('p', 's', { text: `SELECT ${i}`, rows: 1, error: null })
  addHistory('p', 's', { text: 'SELECT 59', rows: 1, error: null })
  const h = load('p', 's').history
  expect(h).toHaveLength(50)
  expect(h[0].text).toBe('SELECT 59')
  expect(h[0].at).toBeGreaterThan(0)
  expect(load('p', 'other').history).toEqual([])
})

test('saved queries can be added, renamed, removed, exported and imported', () => {
  saveQuery('p', 's', 'failed runs', "SELECT * FROM runs WHERE gate_status = 'failed'")
  saveQuery('p', 's', 'failed runs', 'SELECT 2') // same name replaces
  expect(load('p', 's').saved).toEqual([{ name: 'failed runs', text: 'SELECT 2' }])
  renameSaved('p', 's', 'failed runs', 'bad runs')
  expect(load('p', 's').saved[0].name).toBe('bad runs')
  const json = exportStore('p', 's')
  removeSaved('p', 's', 'bad runs')
  expect(load('p', 's').saved).toEqual([])
  importStore('p', 's', json)
  expect(load('p', 's').saved[0].name).toBe('bad runs')
  expect(() => importStore('p', 's', 'not json')).toThrow()
})
