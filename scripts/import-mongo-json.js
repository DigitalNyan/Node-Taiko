import fs from 'node:fs/promises'
import path from 'node:path'

const input = process.argv[2]
if (!input) {
  console.error('Usage: npm run import:mongo-json -- ./mongo-export')
  process.exit(1)
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (!value || typeof value !== 'object') return value
  if (value.$binary?.base64) return Buffer.from(value.$binary.base64, 'base64').toString('utf8')
  if (value.$oid) return value.$oid
  if (value.$date) return new Date(value.$date).toISOString()
  if (value.$numberInt) return Number(value.$numberInt)
  if (value.$numberLong) return Number(value.$numberLong)
  if (value.$numberDouble) return Number(value.$numberDouble)
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === '_id') continue
    output[key] = normalize(child)
  }
  return output
}

async function loadCollection(dir, name) {
  for (const filename of [`${name}.json`, `${name}.ndjson`, `${name}.jsonl`]) {
    const file = path.join(dir, filename)
    try {
      const raw = (await fs.readFile(file, 'utf8')).trim()
      if (!raw) return []
      try {
        const parsed = JSON.parse(raw)
        return normalize(Array.isArray(parsed) ? parsed : [parsed])
      } catch {
        return raw.split(/\r?\n/).filter(Boolean).map(line => normalize(JSON.parse(line)))
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return null
}

let imported
const stat = await fs.stat(input).catch(() => null)
if (!stat) throw new Error(`Input not found: ${input}`)
if (stat.isFile()) {
  const parsed = JSON.parse(await fs.readFile(input, 'utf8'))
  imported = normalize(parsed)
} else {
  imported = {}
  for (const name of ['users', 'songs', 'scores', 'categories', 'makers', 'song_skins', 'seq']) {
    const value = await loadCollection(input, name)
    if (value !== null) imported[name] = value
  }
}

const dbFile = path.resolve('data/db.json')
const current = JSON.parse(await fs.readFile(dbFile, 'utf8').catch(() => '{}'))
for (const name of ['users', 'songs', 'scores', 'categories', 'makers', 'song_skins']) {
  if (Array.isArray(imported[name])) current[name] = imported[name]
}
if (Array.isArray(imported.seq)) {
  current.seq = Object.fromEntries(imported.seq.map(item => [item.name, Number(item.value) || 0]))
} else if (imported.seq && typeof imported.seq === 'object') {
  current.seq = imported.seq
}
current.seq ||= { songs: Math.max(0, ...(current.songs || []).map(song => Number(song.id) || 0)) }

await fs.mkdir(path.dirname(dbFile), { recursive: true })
await fs.writeFile(dbFile + '.tmp', JSON.stringify(current, null, 2), 'utf8')
await fs.rename(dbFile + '.tmp', dbFile)
console.log('Import terminé dans data/db.json')
for (const name of ['users', 'songs', 'scores', 'categories', 'makers', 'song_skins']) {
  console.log(`${name}: ${(current[name] || []).length}`)
}
console.log('Important : les anciennes sessions Redis ne sont pas importées. Les utilisateurs devront se reconnecter.')
