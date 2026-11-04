import { expect, test } from '@playwright/test'

// Needs a project with a SQLite store named "runs" holding the sample data (engine/examples/make_sample.py).
const ASPIRIN = 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N'

test('browse, query, refuse a write, trace', async ({ page }) => {
  await page.goto('/')
  const sidebar = page.locator('aside').first()
  await sidebar.getByRole('button', { name: /^runs\s/ }).first().waitFor()

  await sidebar.getByRole('button', { name: /^runs ~?20$/ }).click()
  await expect(page.getByRole('heading', { name: 'runs' })).toBeVisible()
  await expect(page.getByText('run-000').first()).toBeVisible()

  await page.keyboard.press('ControlOrMeta+3')
  const box = page.getByPlaceholder(/SELECT/)
  await box.fill('SELECT COUNT(*) AS n FROM runs')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByRole('cell', { name: '20' })).toBeVisible()

  await box.fill('DELETE FROM runs')
  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await expect(page.getByText('write_blocked')).toBeVisible()

  await page.getByPlaceholder(/Trace a value/).fill(ASPIRIN)
  await page.getByPlaceholder(/Trace a value/).press('Enter')
  await expect(page.getByRole('region', { name: 'runs' }).getByText('run-000')).toBeVisible()
})
