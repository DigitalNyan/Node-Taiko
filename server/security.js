import crypto from 'node:crypto'

export function createCsrfToken() {
  return crypto.randomBytes(32).toString('hex')
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

export function requireLogin(req, res, next) {
  console.log('[AUTH]', {
    sessionID: req.sessionID,
    username: req.session?.username,
    sessionExists: !!req.session
  })

  if (!req.session?.username) {
    return res.status(401).json({
      status: 'error',
      message: 'not_logged_in'
    })
  }

  next()
}

export function requireAdmin(level = 50) {
  return async (req, res, next) => {
    try {
      const { readDB } = await import('./database.js')
      const db = await readDB()
      const user = db.users.find(u => u.username === req.session?.username)
      if (!user || (user.user_level || 0) < level) {
        return res.status(403).json({ status: 'error', message: 'forbidden' })
      }
      req.adminUser = user
      next()
    } catch (error) { next(error) }
  }
}
