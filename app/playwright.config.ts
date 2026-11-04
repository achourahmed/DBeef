import { defineConfig } from '@playwright/test'

// Smoke test against a running stack (docker compose up, or engine + npm run dev). Not part of `npm test`.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: process.env.DBEEF_UI ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  reporter: 'list',
})
