import { WebSocketServer } from 'ws'

const consonants = 'bcdfghjklmnpqrstvwxyz'
const users = new Set()
const waiting = new Map()
const invites = new Map()

function message(type, value) {
  return JSON.stringify(value === undefined ? { type } : { type, value })
}
function send(user, type, value) {
  if (user?.ws?.readyState === 1) user.ws.send(message(type, value))
}
function status() {
  return [...waiting.entries()].map(([id, item]) => ({ id, diff: item.diff }))
}
function notifyReady() {
  const payload = message('users', status())
  for (const user of users) if (user.action === 'ready') user.ws.readyState === 1 && user.ws.send(payload)
}
function inviteCode() {
  let code
  do {
    code = Array.from({ length: 5 }, () => consonants[Math.floor(Math.random() * consonants.length)]).join('')
  } while (invites.has(code))
  return code
}
function linkPlayers(a, b, playerA = 1, playerB = 2) {
  a.other = b; b.other = a
  a.player = playerA; b.player = playerB
  a.action = 'loading'; b.action = 'loading'
  send(a, 'gameload', { diff: b.diff, player: playerA, mods: b.mods, soundEffect: b.soundEffect })
  send(b, 'gameload', { diff: a.diff, player: playerB, mods: a.mods, soundEffect: a.soundEffect })
  send(a, 'name', { name: b.name, don: b.don })
  send(b, 'name', { name: a.name, don: a.don })
}
function endPair(user) {
  const other = user.other
  user.action = 'ready'
  user.session = false
  user.other = null
  send(user, 'gameend')
  send(user, 'users', status())
  if (other) {
    other.action = 'ready'
    other.session = false
    other.other = null
    send(other, 'gameend')
    send(other, 'users', status())
  }
}
function handle(user, packet) {
  if (!packet || typeof packet !== 'object' || typeof packet.type !== 'string') return
  const type = packet.type
  const value = packet.value
  const other = user.other

  if (user.action === 'ready') {
    if (type === 'join' && value && typeof value === 'object') {
      const { id, diff, name, don, mods, soundEffect } = value
      if (!id || !diff) return
      Object.assign(user, { name, don, mods, soundEffect, diff, gameid: String(id) })
      const waitingUser = waiting.get(String(id))
      if (waitingUser && waitingUser.user !== user && waitingUser.user.ws.readyState === 1) {
        waiting.delete(String(id))
        linkPlayers(user, waitingUser.user, 2, 1)
      } else {
        user.action = 'waiting'
        waiting.set(String(id), { user, diff })
        send(user, 'waiting')
      }
      notifyReady()
    } else if (type === 'invite' && value && typeof value === 'object') {
      Object.assign(user, { name: value.name, don: value.don })
      if (value.id == null) {
        const code = inviteCode()
        invites.set(code, user)
        user.action = 'invite'
        user.session = code
        send(user, 'invite', code)
      } else {
        const host = invites.get(String(value.id))
        if (!host || host === user) return send(user, 'gameend')
        invites.delete(String(value.id))
        user.session = String(value.id)
        host.session = String(value.id)
        user.action = 'invite'; host.action = 'invite'
        user.other = host; host.other = user
        user.player = 2; host.player = 1
        send(user, 'session', { player: 2 })
        send(host, 'session', { player: 1 })
        send(user, 'invite')
        send(user, 'name', { name: host.name, don: host.don })
        send(host, 'name', { name: user.name, don: user.don })
      }
    }
    return
  }

  if (user.action === 'waiting') {
    if (type === 'leave') {
      if (user.gameid) waiting.delete(user.gameid)
      user.action = 'ready'; delete user.gameid
      send(user, 'left'); notifyReady()
    }
    return
  }

  if (user.action === 'loading') {
    if (type === 'leave') return endPair(user)
    if (type === 'gamestart' && other) {
      user.loaded = true
      if (other.loaded) {
        user.action = other.action = 'playing'
        user.loaded = other.loaded = false
        send(user, 'gamestart'); send(other, 'gamestart')
      }
    }
    return
  }

  if (user.action === 'playing') {
    if (!other || other.ws.readyState !== 1) return endPair(user)
    if (['note', 'drumroll', 'branch', 'gameresults'].includes(type)) send(other, type, value)
    else if (type === 'songsel') {
      user.action = other.action = 'songsel'
      send(user, 'songsel'); send(other, 'songsel')
      send(user, 'users', []); send(other, 'users', [])
    } else if (type === 'gameend') endPair(user)
    return
  }

  if (user.action === 'invite') {
    if (type === 'leave') {
      if (user.session) invites.delete(user.session)
      if (other) endPair(user)
      else { user.action = 'ready'; user.session = false; send(user, 'left'); notifyReady() }
    } else if (type === 'songsel' && other) {
      user.action = other.action = 'songsel'
      send(user, 'songsel'); send(other, 'songsel')
    }
    return
  }

  if (user.action === 'songsel') {
    if (!other || other.ws.readyState !== 1) return endPair(user)
    if (type === 'songsel' || type === 'catjump') {
      if (value && typeof value === 'object') value.player = user.player
      send(user, type, value); send(other, type, value)
    } else if (type === 'crowns' || type === 'getcrowns') {
      send(other, type, value)
    } else if (type === 'join' && value && typeof value === 'object') {
      if (other.action === 'waiting') {
        user.action = other.action = 'loading'
        send(user, 'gameload', { diff: other.gamediff, mods: other.gamemods, soundEffect: other.gameSoundEffect })
        send(other, 'gameload', { diff: value.diff, mods: value.mods, soundEffect: value.soundEffect })
      } else {
        user.gamediff = value.diff
        user.gamemods = value.mods
        user.gameSoundEffect = value.soundEffect
        user.action = 'waiting'
        send(other, 'users', [{ id: value.id, diff: value.diff }])
      }
    } else if (type === 'gameend') endPair(user)
  }
}

export function attachMultiplayer(server) {
  const wss = new WebSocketServer({ server, path: '/p2' })
  wss.on('connection', ws => {
    const user = { ws, action: 'ready', session: false, name: null, don: null, other: null }
    users.add(user)
    send(user, 'users', status())
    ws.on('message', raw => {
      try { handle(user, JSON.parse(raw.toString())) } catch (error) { console.error('P2 message error:', error) }
    })
    ws.on('close', () => {
      users.delete(user)
      if (user.gameid) waiting.delete(user.gameid)
      if (user.session) invites.delete(user.session)
      if (user.other) {
        const other = user.other
        other.other = null; other.action = 'ready'; other.session = false
        send(other, 'gameend'); send(other, 'users', status())
      }
      notifyReady()
    })
    ws.on('error', error => console.error('P2 websocket:', error.message))
  })
  return wss
}
