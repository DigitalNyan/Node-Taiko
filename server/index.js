
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import session from 'express-session'
import FileStoreFactory from 'session-file-store'
import { fileURLToPath } from 'node:url'
import { ensureDatabase, readDB, updateDB } from './database.js'
import { createCsrfToken, safeEqual, requireLogin, requireAdmin } from './security.js'
import { attachMultiplayer } from './multiplayer.js'
import multer from 'multer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_DIR = path.join(ROOT, 'data')
const SONGS_DIR = path.join(DATA_DIR, 'songs')
const PUBLIC_DIR = path.join(ROOT, 'public')
const DIST_DIR = path.join(ROOT, 'dist')
// custom sounds
const CUSTOM_SOUNDS_DIR = process.env.CUSTOM_SOUNDS_DIR
  ? path.resolve(process.env.CUSTOM_SOUNDS_DIR)
  : path.join(DATA_DIR, 'custom-sounds')
const CONFIG_FILE = path.join(ROOT, 'config.json')
const PORT = Number(process.env.PORT || 34801)

await ensureDatabase()
await fs.mkdir(SONGS_DIR, { recursive: true })
await fs.mkdir(CUSTOM_SOUNDS_DIR, { recursive: true })

const oldSoundsDir = path.join(PUBLIC_DIR, 'assets', 'audio', 'custom')

try {
  await fs.mkdir(oldSoundsDir, { recursive: true })

  const oldFiles = await fs.readdir(oldSoundsDir)

  for (const file of oldFiles) {
    const source = path.join(oldSoundsDir, file)
    const destination = path.join(CUSTOM_SOUNDS_DIR, file)

    try {
      await fs.access(destination)
    } catch {
      await fs.copyFile(source, destination)
    }
  }
} catch (error) {
  console.error('error :', error)
}
await fs.mkdir(path.join(DATA_DIR, 'sessions'), { recursive: true })

let config = {}

try {
  config = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'))
} catch {
  console.warn('cannot found config.js.')
}

const app = express()
const server = http.createServer(app)
const FileStore = FileStoreFactory(session)

app.set('trust proxy', 1)
app.disable('x-powered-by')

app.use(express.json({ limit: '12mb' }))
app.use(express.urlencoded({ extended: false, limit: '2mb' }))

app.use(session({
  name: 'taiko.sid',

  store: new FileStore({
    path: path.join(DATA_DIR, 'sessions'),
    ttl: 60 * 60 * 24 * 30,
    retries: 5,
    logFn: console.error
  }),

  secret: process.env.SESSION_SECRET ||
    config.SECRET_KEY ||
    'CHANGE-THIS-SECRET-KEY',

  resave: false,
  saveUninitialized: false,
  rolling: true,

  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}))



function apiError(res, message, status = 200) {
  return res.status(status).json({
    status: 'error',
    message
  })
}

function getDon(user) {
  return {
    body_fill: user?.don_body_fill || '#5fb7c1',
    face_fill: user?.don_face_fill || '#ff5724'
  }
}

function publicUser(user) {
  return {
    username: user.username,
    display_name: user.display_name || user.username,
    don: getDon(user),
    user_level: user.user_level || 1
  }
}

function requireCsrf(req, res, next) {
  const token = req.get('X-CSRFToken')

  if (!req.session.csrfToken ||
      !safeEqual(token, req.session.csrfToken)) {
    return apiError(res, 'invalid_csrf', 400)
  }

  next()
}

app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return requireCsrf(req, res, next)
  }

  next()
})

// api

app.get('/api/logout-force', (req, res) => {
  res.clearCookie('taiko.sid', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true'
  })

  if (!req.session) {
    return res.json({ status: 'ok' })
  }

  req.session.destroy(error => {
    if (error) {
      console.error('[LOGOUT FORCE]', error)
      return res.status(500).json({
        status: 'error',
        message: 'logout_failed'
      })
    }

    res.json({
      status: 'ok',
      message: 'Session supprimée'
    })
  })
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    backend: 'node.js',
    database: 'json'
  })
})

app.get('/api/csrftoken', (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = createCsrfToken()
  }

  res.json({
    status: 'ok',
    token: req.session.csrfToken
  })
})

// config
app.get('/api/config', async (req, res, next) => {
  try {
    const db = await readDB()
    const user = db.users.find(
      u => u.username === req.session.username
    )

    const output = {
      songs_baseurl: config.SONGS_BASEURL ||
        `${req.protocol}://${req.get('host')}/songs/`,

      assets_baseurl: config.ASSETS_BASEURL ||
        `${req.protocol}://${req.get('host')}/assets/`,

      email: config.EMAIL || null,
      accounts: config.ACCOUNTS !== false,
      custom_js: config.CUSTOM_JS || '',

      plugins: (config.PLUGINS || []).filter(
        plugin => plugin.url
      ),

      preview_type: config.PREVIEW_TYPE || 'mp3',

      _version: {
        commit: null,
        commit_short: '',
        version: null,
        url: config.URL || 'https://github.com/bui/taiko-web/'
      }
    }

    const credentials = config.GOOGLE_CREDENTIALS || {
      gdrive_enabled: false
    }

    const minLevel = credentials.min_level || 0

    output.google_credentials =
      (user?.user_level || 0) >= minLevel
        ? credentials
        : { gdrive_enabled: false }

    res.json(output)
  } catch (error) {
    next(error)
  }
})

// categories
app.get('/api/categories', async (req, res, next) => {
  try {
    const db = await readDB()

    res.json(
      [...db.categories].sort((a, b) => a.id - b.id)
    )
  } catch (error) {
    next(error)
  }
})

// songs
app.get('/api/songs', async (req, res, next) => {
  try {
    const db = await readDB()

    const makers = new Map(
      db.makers.map(item => [item.id, item])
    )

    const categories = new Map(
      db.categories.map(item => [item.id, item])
    )

    const skins = new Map(
      db.song_skins.map(item => [item.id, item])
    )

    const songs = db.songs
      .filter(song => song.enabled)
      .sort((a, b) => a.id - b.id)
      .map(song => {
        const output = structuredClone(song)

        delete output.enabled
        delete output._id

        const makerId = output.maker_id

        output.maker = makerId
          ? (makers.get(makerId) || null)
          : null

        const category = categories.get(output.category_id)
        output.category = category?.title || null

        const skinId = output.skin_id

        output.song_skin = skinId
          ? (skins.get(skinId) || null)
          : null

        delete output.maker_id
        delete output.skin_id

        return output
      })

    res.json(songs)
  } catch (error) {
    next(error)
  }
})

// preview
app.get('/api/preview', async (req, res, next) => {
  try {
    const id = String(req.query.id || '')

    if (!/^\d{1,9}$/.test(id)) {
      return res.sendStatus(400)
    }

    const db = await readDB()

    const song = db.songs.find(
      item => item.id === Number(id)
    )

    if (!song) {
      return res.sendStatus(404)
    }

    const ext = song.music_type || 'mp3'
    const preview = path.join(
      PUBLIC_DIR,
      'songs',
      id,
      'preview.mp3'
    )

    try {
      await fs.access(preview)
      return res.redirect(`/songs/${id}/preview.mp3`)
    } catch {}

    return res.redirect(
      `${config.SONGS_BASEURL || '/songs/'}${id}/main.${ext}`
    )
  } catch (error) {
    next(error)
  }
})

// auth

// register
app.post('/api/register', async (req, res, next) => {
  try {
    const { username, password } = req.body || {}

    if (
      typeof username !== 'string' ||
      !/^[a-zA-Z0-9_]{3,20}$/.test(username)
    ) {
      return apiError(res, 'invalid_username')
    }

    if (
      typeof password !== 'string' ||
      Buffer.byteLength(password, 'utf8') < 6 ||
      Buffer.byteLength(password, 'utf8') > 5000
    ) {
      return apiError(res, 'invalid_password')
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const sessionId = crypto.randomBytes(24).toString('hex')

    const user = {
      username,
      username_lower: username.toLowerCase(),
      password: passwordHash,
      display_name: username,
      user_level: 1,
      session_id: sessionId,
      created_at: new Date().toISOString()
    }

    const created = await updateDB(db => {
      if (
        db.users.some(
          item => item.username_lower === user.username_lower
        )
      ) {
        return false
      }

      db.users.push(user)
      return true
    })

    if (!created) {
      return apiError(res, 'username_in_use')
    }

    req.session.regenerate(error => {
      if (error) {
        return next(error)
      }

      req.session.username = username
      req.session.session_id = sessionId
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000

      req.session.save(error => {
        if (error) {
          return next(error)
        }

        res.json({
          status: 'ok',
          username,
          display_name: username,
          don: getDon(user)
        })
      })
    })
  } catch (error) {
    next(error)
  }
})

// login
app.post('/api/login', async (req, res, next) => {
  try {
    const { username, password, remember } = req.body || {}

    if (
      typeof username !== 'string' ||
      typeof password !== 'string'
    ) {
      return apiError(res, 'invalid_username_password')
    }

    const db = await readDB()

    const user = db.users.find(
      item => item.username_lower === username.toLowerCase()
    )

    if (
      !user ||
      typeof user.password !== 'string' ||
      !(await bcrypt.compare(password, user.password))
    ) {
      return apiError(res, 'invalid_username_password')
    }

    req.session.regenerate(error => {
      if (error) {
        return next(error)
      }

      req.session.username = user.username
      req.session.session_id = user.session_id

      if (remember) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000
      } else {
        req.session.cookie.expires = false
      }

      req.session.save(error => {
        if (error) {
          return next(error)
        }

        res.json({
          status: 'ok',
          username: user.username,
          display_name: user.display_name || user.username,
          don: getDon(user)
        })
      })
    })
  } catch (error) {
    next(error)
  }
})

// logout
app.post('/api/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie('taiko.sid', { path: '/' })
    return res.json({ status: 'ok' })
  }

  req.session.destroy(error => {
    if (error) {
      console.error('logout error :', error)
      return apiError(res, 'logout_failed', 500)
    }

    res.clearCookie('taiko.sid', { path: '/' })
    res.json({ status: 'ok' })
  })
})

app.get('/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie('taiko.sid', { path: '/' })
    return res.redirect('/')
  }

  req.session.destroy(error => {
    if (error) {
      return res.status(500).send('Erreur while logging out')
    }

    res.clearCookie('taiko.sid', { path: '/' })
    res.redirect('/')
  })
})

app.use(async (req, res, next) => {
  if (!req.session?.username || !req.session?.session_id) {
    return next()
  }

  try {
    const db = await readDB()

    const user = db.users.find(
      item => item.username === req.session.username
    )

    if (!user || user.session_id !== req.session.session_id) {
      return req.session.destroy(error => {
        if (error) {
          console.error('error :', error)
        }

        res.clearCookie('taiko.sid', { path: '/' })
        next()
      })
    }

    next()
  } catch (error) {
    console.error('error :', error)
    next()
  }
})


app.use((req, res, next) => {
  console.log('\nDEBUG')

  console.log('[REQUEST]', {
    method: req.method,
    url: req.originalUrl
  })

  console.log('[COOKIE]', {
    cookieReceived: !!req.headers.cookie,
    taikoCookieReceived: !!req.headers.cookie?.includes('taiko.sid')
  })

  console.log('[SESSION]', {
    sessionID: req.sessionID || null,
    sessionExists: !!req.session,
    username: req.session?.username || null,
    session_id: req.session?.session_id || null
  })

  next()
})

app.get('/api/debug/session', async (req, res) => {
  try {
    const db = await readDB()

    const username = req.session?.username || null

    const user = username
      ? db.users.find(u => u.username === username)
      : null

    res.json({
      debug: true,

      request: {
        url: req.originalUrl,
        cookieReceived: !!req.headers.cookie,
        taikoCookieReceived: !!req.headers.cookie?.includes('taiko.sid')
      },

      session: {
        exists: !!req.session,
        id: req.sessionID || null,
        username,
        session_id: req.session?.session_id || null
      },

      database: {
        userExists: !!user,
        databaseSessionId: user?.session_id || null,
        sessionMatches: !!user &&
          user.session_id === req.session?.session_id
      }
    })
  } catch (error) {
    console.error('[DEBUG SESSION ERROR]', error)

    res.status(500).json({
      error: error.message
    })
  }
})

// account

app.get('/api/account/me', requireLogin, async (req, res, next) => {
  try {
    const db = await readDB()

    const user = db.users.find(
      item => item.username === req.session.username
    )

    if (!user) {
      return apiError(res, 'not_logged_in', 401)
    }

    res.json(publicUser(user))
  } catch (error) {
    next(error)
  }
})

app.post('/api/account/display_name', requireLogin, async (req, res, next) => {
  try {
    const value = typeof req.body.display_name === 'string'
      ? req.body.display_name.trim()
      : ''

    if (value.length > 25) {
      return apiError(res, 'invalid_display_name')
    }

    const displayName = value || req.session.username

    await updateDB(db => {
      const user = db.users.find(
        item => item.username === req.session.username
      )

      if (user) {
        user.display_name = displayName
      }
    })

    res.json({
      status: 'ok',
      display_name: displayName
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/account/don', requireLogin, async (req, res, next) => {
  try {
    const { body_fill, face_fill } = req.body || {}

    if (
      ![body_fill, face_fill].every(
        value => typeof value === 'string' &&
          /^#[0-9a-fA-F]{6}$/.test(value)
      )
    ) {
      return apiError(res, 'invalid_don')
    }

    await updateDB(db => {
      const user = db.users.find(
        item => item.username === req.session.username
      )

      if (user) {
        user.don_body_fill = body_fill
        user.don_face_fill = face_fill
      }
    })

    res.json({
      status: 'ok',
      don: { body_fill, face_fill }
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/account/password', requireLogin, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {}

    const db = await readDB()

    const user = db.users.find(
      item => item.username === req.session.username
    )

    if (
      !user ||
      !(await bcrypt.compare(
        String(current_password || ''),
        user.password
      ))
    ) {
      return apiError(res, 'current_password_invalid')
    }

    if (
      typeof new_password !== 'string' ||
      Buffer.byteLength(new_password) < 6 ||
      Buffer.byteLength(new_password) > 5000
    ) {
      return apiError(res, 'invalid_new_password')
    }

    const passwordHash = await bcrypt.hash(new_password, 12)
    const sessionId = crypto.randomBytes(24).toString('hex')

    await updateDB(data => {
      const target = data.users.find(
        item => item.username === req.session.username
      )

      if (target) {
        target.password = passwordHash
        target.session_id = sessionId
      }
    })

    req.session.session_id = sessionId

    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})

app.post('/api/account/remove', requireLogin, async (req, res, next) => {
  try {
    const db = await readDB()

    const user = db.users.find(
      item => item.username === req.session.username
    )

    if (
      !user ||
      !(await bcrypt.compare(
        String(req.body.password || ''),
        user.password
      ))
    ) {
      return apiError(res, 'verify_password_invalid')
    }

    await updateDB(data => {
      data.users = data.users.filter(
        item => item.username !== req.session.username
      )

      data.scores = data.scores.filter(
        item => item.username !== req.session.username
      )
    })

    req.session.destroy(error => {
      if (error) {
        return apiError(res, 'remove_failed', 500)
      }

      res.clearCookie('taiko.sid')
      res.json({ status: 'ok' })
    })
  } catch (error) {
    next(error)
  }
})

// scores

app.post('/api/scores/save', requireLogin, async (req, res, next) => {
  try {
    const { scores, is_import } = req.body || {}

    if (
      !Array.isArray(scores) ||
      scores.length > 10000 ||
      !scores.every(s =>
        s &&
        typeof s.hash === 'string' &&
        s.hash.length <= 512 &&
        typeof s.score === 'string' &&
        s.score.length <= 2048
      )
    ) {
      return res.status(400).json({
        status: 'error',
        message: 'invalid_scores'
      })
    }

    await updateDB(db => {
      if (is_import) {
        db.scores = db.scores.filter(
          item => item.username !== req.session.username
        )
      }

      for (const score of scores) {
        const existing = db.scores.find(
          item =>
            item.username === req.session.username &&
            item.hash === score.hash
        )

        if (existing) {
          existing.score = score.score
        } else {
          db.scores.push({
            username: req.session.username,
            hash: score.hash,
            score: score.score
          })
        }
      }
    })

    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})

app.get('/api/scores/get', async (req, res, next) => {
  try {
    const db = await readDB()

    if (!req.session?.username || !req.session?.session_id) {
      return res.json({
        status: 'ok',
        scores: [],
        username: null,
        display_name: null,
        don: null
      })
    }

    const user = db.users.find(
      item => item.username === req.session.username
    )

    if (!user || user.session_id !== req.session.session_id) {
      return res.json({
        status: 'ok',
        scores: [],
        username: null,
        display_name: null,
        don: null
      })
    }

    const scores = db.scores
      .filter(item => item.username === user.username)
      .map(({ hash, score }) => ({ hash, score }))

    res.json({
      status: 'ok',
      scores,
      username: user.username,
      display_name: user.display_name || user.username,
      don: getDon(user)
    })
  } catch (error) {
    next(error)
  }
})

// admin

app.get('/api/admin/songs', requireAdmin(50), async (req, res, next) => {
  try {
    const db = await readDB()

    res.json({
      songs: db.songs.slice().sort((a, b) => a.id - b.id)
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/songs/:id', requireAdmin(50), async (req, res, next) => {
  try {
    const db = await readDB()

    const song = db.songs.find(
      item => item.id === Number(req.params.id)
    )

    if (!song) {
      return apiError(res, 'song_not_found', 404)
    }

    res.json({
      song,
      categories: db.categories,
      makers: db.makers,
      song_skins: db.song_skins
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/songs', requireAdmin(100), async (req, res, next) => {
  try {
    const input = req.body || {}

    if (
      typeof input.title !== 'string' ||
      !input.title.trim()
    ) {
      return apiError(res, 'invalid_title', 400)
    }

    const song = {
      id: 0,
      order: 0,
      enabled: input.enabled !== false,
      title: input.title.trim(),
      subtitle: input.subtitle || null,
      title_lang: input.title_lang || {},
      subtitle_lang: input.subtitle_lang || {},
      courses: input.courses || {},
      category_id: input.category_id || null,
      type: ['tja', 'osu'].includes(input.type)
        ? input.type
        : 'tja',
      music_type: ['mp3', 'ogg'].includes(input.music_type)
        ? input.music_type
        : 'mp3',
      offset: Number(input.offset || 0),
      skin_id: input.skin_id || null,
      preview: Number(input.preview || 0),
      volume: Number(input.volume ?? 1),
      maker_id: input.maker_id || null,
      lyrics: Boolean(input.lyrics),
      hash: input.hash || null
    }

    await updateDB(db => {
      db.seq ||= { songs: 0 }

      const maxId = Math.max(
        0,
        ...db.songs.map(item => Number(item.id) || 0),
        Number(db.seq.songs) || 0
      )

      song.id = maxId + 1
      song.order = song.id
      db.seq.songs = song.id

      db.songs.push(song)
    })

    res.status(201).json({
      status: 'ok',
      id: song.id,
      song
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/admin/songs/:id', requireAdmin(50), async (req, res, next) => {
  try {
    let updated

    await updateDB(db => {
      const song = db.songs.find(
        item => item.id === Number(req.params.id)
      )

      if (!song) return

      Object.assign(song, req.body)
      updated = structuredClone(song)
    })

    if (!updated) {
      return apiError(res, 'song_not_found', 404)
    }

    res.json({
      status: 'ok',
      song: updated
    })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/admin/songs/:id', requireAdmin(100), async (req, res, next) => {
  try {
    let removed = false

    await updateDB(db => {
      const before = db.songs.length

      db.songs = db.songs.filter(
        item => item.id !== Number(req.params.id)
      )

      removed = db.songs.length !== before
    })

    if (!removed) {
      return apiError(res, 'song_not_found', 404)
    }

    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})

app.post('/api/admin/users/level', requireAdmin(50), async (req, res, next) => {
  try {
    const { username, level } = req.body || {}

    if (
      typeof username !== 'string' ||
      !Number.isInteger(level)
    ) {
      return apiError(res, 'invalid_data', 400)
    }

    if (
      username === req.adminUser.username ||
      level < 0 ||
      level >= req.adminUser.user_level
    ) {
      return apiError(res, 'invalid_level')
    }

    let found = false

    await updateDB(db => {
      const target = db.users.find(
        item => item.username_lower === username.toLowerCase()
      )

      if (
        target &&
        target.user_level < req.adminUser.user_level
      ) {
        target.user_level = level
        found = true
      }
    })

    if (!found) {
      return apiError(res, 'user_not_found')
    }

    res.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})



const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 3
  }
})

const songUpload = upload.fields([
  { name: 'tja', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
  { name: 'preview', maxCount: 1 }
])

const soundUpload = upload.single('sound')

function requireUploadPanel(req, res, next) {
  if (!req.session?.uploadPanelAuthorized) {
    return apiError(res, 'upload_panel_unauthorized', 401)
  }

  next()
}

app.post('/api/upload-panel/login', (req, res) => {
  const password = req.body?.password
  const expected = process.env.UPLOAD_PANEL_PASSWORD ||
    config.UPLOAD_PANEL_PASSWORD

  if (typeof expected !== 'string' || !expected) {
    return apiError(res, 'upload_panel_password_not_configured', 500)
  }

  if (typeof password !== 'string' || !safeEqual(password, expected)) {
    return apiError(res, 'incorrect_password', 401)
  }

  req.session.uploadPanelAuthorized = true

  req.session.save(error => {
    if (error) return apiError(res, 'session_error', 500)
    res.json({ status: 'ok' })
  })
})

app.get('/api/upload-panel/status', (req, res) => {
  res.json({
    status: 'ok',
    authenticated: Boolean(req.session?.uploadPanelAuthorized)
  })
})

app.post('/api/upload-panel/logout', requireUploadPanel, (req, res) => {
  req.session.uploadPanelAuthorized = false

  req.session.save(error => {
    if (error) return apiError(res, 'session_error', 500)
    res.json({ status: 'ok' })
  })
})

function decodeTjaBuffer(buffer) {
  try {
    return new TextDecoder('utf-8', {
      fatal: true
    }).decode(buffer)
  } catch {
    return new TextDecoder('shift_jis').decode(buffer)
  }
}

function extractTjaMetadata(tja) {
  const courses = {};

  const names = {
    '0': 'easy',
    '1': 'normal',
    '2': 'hard',
    '3': 'oni',
    '4': 'edit',

    easy: 'easy',
    normal: 'normal',
    hard: 'hard',
    oni: 'oni',
    edit: 'edit'
  };

  let title = '';
  let subtitle = '';

  let currentCourse = null;
  let currentLevel = null;

  function saveCourse() {
    if (currentCourse && currentLevel !== null) {
      courses[currentCourse] = currentLevel;
    }
  }

  const lines = tja
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);

  for (const line of lines) {
    const match = line.trim().match(/^([^:]+)\s*:\s*(.*)$/);

    if (!match) continue;

    const key = match[1].trim().toUpperCase();
    const value = match[2].trim();

    if (key === 'TITLE') {
      title = value;
      continue;
    }

    if (key === 'SUBTITLE') {
      subtitle = value;
      continue;
    }

    if (key === 'COURSE') {
      saveCourse();

      currentCourse = names[value.toLowerCase()] || null;
      currentLevel = null;

      continue;
    }

    if (key === 'LEVEL' && currentCourse) {
      const parsed = Number(value);

      currentLevel = Number.isFinite(parsed)
        ? parsed
        : null;
    }
  }

  saveCourse();

  return {
    title,
    subtitle,
    courses
  };
}

// add a song

app.post(
  '/api/upload-panel/songs',
  requireUploadPanel,
  songUpload,
  async (req, res, next) => {
    try {
      const tjaFile = req.files?.tja?.[0];
      const audioFile = req.files?.audio?.[0];
      const previewFile = req.files?.preview?.[0];

      if (!tjaFile || !audioFile) {
        return apiError(res, 'tja_and_audio_required', 400);
      }

      if (
        path.extname(tjaFile.originalname).toLowerCase() !== '.tja'
      ) {
        return apiError(res, 'invalid_tja_file', 400);
      }

      const audioExt = path.extname(audioFile.originalname).toLowerCase();

      if (!['.mp3', '.ogg'].includes(audioExt)) {
        return apiError(res, 'invalid_audio_file', 400);
      }

      if (previewFile) {
        const previewExt = path.extname(previewFile.originalname).toLowerCase();

        if (!['.mp3', '.ogg'].includes(previewExt)) {
          return apiError(res, 'invalid_preview_file', 400);
        }
      }

      const tja = decodeTjaBuffer(tjaFile.buffer);

      const metadata = extractTjaMetadata(tja);

      const title = metadata.title ||
        String(req.body?.title || '').trim();

      const subtitle = metadata.subtitle ||
        String(req.body?.subtitle || '').trim();

      const courses = metadata.courses;

      if (!title || title.length > 150) {
        return apiError(res, 'invalid_title', 400);
      }

      if (Object.keys(courses).length === 0) {
        return apiError(res, 'no_valid_course_found', 400);
      }

      const db = await readDB();

      const id = Math.max(
        0,
        ...db.songs.map(song => Number(song.id) || 0),
        Number(db.seq?.songs) || 0
      ) + 1;

      const songDir = path.join(SONGS_DIR, String(id));

      await fs.mkdir(songDir, { recursive: true });

      const updatedTja = tja.replace(
        /^WAVE\s*:\s*.*$/im,
        `WAVE:main${audioExt}`
      );

      await fs.writeFile(
        path.join(songDir, 'main.tja'),
        updatedTja,
        'utf8'
      );

      await fs.writeFile(
        path.join(songDir, `main${audioExt}`),
        audioFile.buffer
      );

      if (previewFile) {
        const previewExt = path.extname(
          previewFile.originalname
        ).toLowerCase();

        await fs.writeFile(
          path.join(songDir, `preview${previewExt}`),
          previewFile.buffer
        );
      }

      const song = {
        id,
        order: id,
        enabled: true,

        title,
        subtitle,

        title_lang: {},
        subtitle_lang: {},

        courses,

        category_id: null,
        type: 'tja',
        music_type: audioExt.slice(1),

        offset: Number(req.body?.offset || 0),

        skin_id: null,
        preview: 0,
        volume: 1,
        maker_id: null,

        lyrics: false,
        hash: null
      };

      await updateDB(data => {
        data.seq ||= { songs: 0 };

        data.seq.songs = Math.max(
          Number(data.seq.songs) || 0,
          id
        );

        data.songs.push(song);
      });

      res.status(201).json({
        status: 'ok',
        id,
        song
      });

    } catch (error) {
      next(error);
    }
  }
);

app.post(
  '/api/upload-panel/sounds',
  requireUploadPanel,
  soundUpload,
  async (req, res, next) => {
    try {
      const file = req.file

      if (!file) {
        return apiError(res, 'sound_required', 400)
      }

      const ext = path.extname(file.originalname).toLowerCase()

      if (!['.mp3', '.ogg', '.wav'].includes(ext)) {
        return apiError(res, 'invalid_sound_file', 400)
      }

      const originalName = path.basename(file.originalname, ext)
      const safeName = originalName
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60)

      if (!safeName) {
        return apiError(res, 'invalid_sound_name', 400)
      }

      const soundDir = path.join(PUBLIC_DIR, 'assets', 'audio', 'custom')
      await fs.mkdir(soundDir, { recursive: true })

      const filename = `${safeName}${ext}`
      await fs.writeFile(path.join(soundDir, filename), file.buffer)

      res.status(201).json({
        status: 'ok',
        filename,
        url: `/assets/audio/custom/${filename}`
      })
    } catch (error) {
      next(error)
    }
  }
)

app.get('/api/sounds', async (req, res, next) => {
  try {
    const soundDir = path.join(PUBLIC_DIR, 'assets', 'audio', 'custom')
    await fs.mkdir(soundDir, { recursive: true })

    const files = await fs.readdir(soundDir)

    const sounds = files
      .filter(file => /\.(mp3|ogg|wav)$/i.test(file))
      .map(file => ({
        name: file,
        url: `/assets/audio/custom/${encodeURIComponent(file)}`
      }))

    res.json({ status: 'ok', sounds })
  } catch (error) {
    next(error)
  }
})
app.get('/admin', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'))
})


app.get('/privacy', async (req, res) => {
  try {
    const text = await fs.readFile(
      path.join(ROOT, 'public', 'privacy.txt'),
      'utf8'
    )

    res.type('text/plain').send(text)
  } catch {
    res.type('text/plain').send('Privacy policy')
  }
})

app.use('/src', express.static(path.join(PUBLIC_DIR, 'src')))
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')))
app.use('/songs', express.static(SONGS_DIR))

app.use(express.static(DIST_DIR))
app.use(express.static(PUBLIC_DIR))

app.get('*', async (req, res, next) => {
  try {
    await fs.access(path.join(DIST_DIR, 'index.html'))
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  } catch {
    res.status(503).send(
      'frontend not compiled, please run npm run build.'
    )
  }
})

app.use((error, req, res, next) => {
  console.error(error)

  if (res.headersSent) {
    return next(error)
  }

  res.status(500).json({
    status: 'error',
    message: 'internal_server_error'
  })
})



attachMultiplayer(server)

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Node-Taiko : http://localhost:${PORT}`)
  console.log(`API : http://localhost:${PORT}/api/health`)
  console.log('WebSocket : /p2')
})
