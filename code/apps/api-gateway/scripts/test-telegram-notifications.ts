import assert from 'node:assert/strict'
import {
  formatTelegramNotification,
  maskEmail,
  shouldNotifyTelegram,
} from '../lib/telegram-notifications'

assert.equal(maskEmail('sales@verified-agency.com'), 's***s@verified-agency.com')
assert.equal(maskEmail('ab@company.com'), 'a*@company.com')
assert.equal(maskEmail('bad-value'), 'bad-value')

assert.equal(shouldNotifyTelegram('email_sent', { TELEGRAM_NOTIFY_SENT: 'false' }), false)
assert.equal(shouldNotifyTelegram('email_failed', { TELEGRAM_NOTIFY_FAILED: '0' }), false)
assert.equal(shouldNotifyTelegram('sheet_import', { TELEGRAM_NOTIFY_IMPORTS: 'yes' }), true)

const sent = formatTelegramNotification({
  type: 'email_sent',
  to: 'sales@verified-agency.com',
  from: 'hello@vishnulabs.com',
  subject: 'quick question',
  providerMessageId: 'msg_123',
})

assert.match(sent, /Email sent/)
assert.match(sent, /s\*\*\*s@verified-agency\.com/)
assert.doesNotMatch(sent, /sales@verified-agency\.com/)

const importMessage = formatTelegramNotification({
  type: 'sheet_import',
  imported: 12,
  prepared: 18,
  rejected: 4,
  evidenceBacked: 9,
  sheetUrl: 'https://docs.google.com/spreadsheets/d/demo/edit',
})

assert.match(importMessage, /Google Sheet import/)
assert.match(importMessage, /Imported: 12/)
assert.match(importMessage, /Evidence-backed: 9/)

const mapsMessage = formatTelegramNotification({
  type: 'maps_import',
  imported: 7,
  prepared: 12,
  rejected: 5,
  evidenceBacked: 7,
  datasetId: 'dataset_123',
  source: 'apify_google_maps',
})

assert.match(mapsMessage, /Google Maps lead intake/)
assert.match(mapsMessage, /Imported: 7/)
assert.match(mapsMessage, /Dataset: dataset_123/)

const dailyMessage = formatTelegramNotification({
  type: 'daily_outbound',
  imported: 100,
  approved: 12,
  queued: 5,
  estimatedPipelineValueUsd: 425000,
  agencyQueued: 4,
  directQueued: 1,
  sendLimit: 5,
  approveLimit: 25,
  failures: 0,
})

assert.match(dailyMessage, /Pipeline value: \$425,000/)
assert.match(dailyMessage, /Mix: 4 agency \/ 1 direct/)

console.log('telegram notification tests passed')
