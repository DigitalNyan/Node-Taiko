import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data')
const DB_FILE = path.join(DATA_DIR, 'db.json')
let writeQueue = Promise.resolve()

const initialDatabase = {
  users: [], songs: [], scores: [], categories: [], makers: [],
  song_skins: [], seq: { songs: 0 }
}

export async function ensureDatabase() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  try {
    JSON.parse(await fs.readFile(DB_FILE, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const backup = DB_FILE + '.corrupt-' + Date.now()
      await fs.rename(DB_FILE, backup).catch(() => {})
      console.error('invalid json :', backup)
    }
    await fs.writeFile(DB_FILE, JSON.stringify(initialDatabase, null, 2))
  }
}

export async function readDB() {
  await ensureDatabase()
  return JSON.parse(await fs.readFile(DB_FILE, 'utf8'))
}

export async function updateDB(mutator) {
  const operation = writeQueue.then(async () => {
    const db = await readDB()
    const result = await mutator(db)
    const temp = DB_FILE + '.tmp'
    await fs.writeFile(temp, JSON.stringify(db, null, 2), 'utf8')
    await fs.rename(temp, DB_FILE)
    return result
  })
  writeQueue = operation.catch(() => {})
  return operation
}

export async function collection(name) {
  const db = await readDB()
  return Array.isArray(db[name]) ? db[name] : []
}
