// scripts/updateSLA.js
import fetch from 'node-fetch'
import { DateTime } from 'luxon'

const NOTION_TOKEN = process.env.NOTION_TOKEN
const DATABASE_ID = process.env.DATABASE_ID
const TZ = process.env.TZ || 'Europe/Istanbul'

if (!NOTION_TOKEN) throw new Error('NOTION_TOKEN missing')
if (!DATABASE_ID) throw new Error('DATABASE_ID missing')

function computeSLA({ status, dueISO }) {
  if (status === 'Bitti') return null
  if (!dueISO) return 'Riskte'
  const now = DateTime.now().setZone(TZ)
  const due = DateTime.fromISO(dueISO).setZone(TZ)
  if (due < now.startOf('day')) return 'İhlal'
  const hours = due.diff(now, 'hours').hours
  if (hours <= 48) return 'Riskte'
  return 'Zamanında'
}

async function notion(path, method = 'POST', body) {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.json()
}

async function listDatabasePages(databaseId) {
  let hasMore = true
  let start_cursor
  const all = []
  while (hasMore) {
    const payload = {
      page_size: 100,
      start_cursor,
      // Durum != Bitti filtrelemek isterseniz:
      // filter: { property: 'Durum', status: { does_not_equal: 'Bitti' } }
    }
    const data = await notion(`databases/${databaseId}/query`, 'POST', payload)
    all.push(...data.results)
    hasMore = data.has_more
    start_cursor = data.next_cursor
    await new Promise(r => setTimeout(r, 150))
  }
  return all
}

async function updatePageSLA(pageId, slaValue) {
  return notion(`pages/${pageId}`, 'PATCH', {
    properties: {
      'SLA': { select: { name: slaValue } }
    }
  })
}

function prop(page, name) { return page.properties?.[name] }
function getStatus(page) { return prop(page, 'Durum')?.status?.name || null }
function getDue(page) { return prop(page, 'Bitiş')?.date?.start || null }
function getSLA(page) { return prop(page, 'SLA')?.select?.name || null }

async function run() {
  const pages = await listDatabasePages(DATABASE_ID)
  let updated = 0
  for (const p of pages) {
    const status = getStatus(p)
    const dueISO = getDue(p)
    const current = getSLA(p)
    const target = computeSLA({ status, dueISO })
    if (target && target !== current) {
      await updatePageSLA(p.id, target)
      updated++
      await new Promise(r => setTimeout(r, 150))
    }
  }
  console.log(`SLA updated for ${updated} pages`)
}

run().catch(err => { console.error(err); process.exit(1) })
