
<script setup>
import { ref, onMounted } from 'vue'

const authenticated = ref(false)
const password = ref('')
const message = ref('')
const loading = ref(false)

const levels = ref([])
const tjaFiles = ref([])
const oggFiles = ref([])

const soundFile = ref(null)
const sounds = ref([])
const soundsLoading = ref(false)

let currentAudio = null


async function getCsrfToken() {
  const response = await fetch('/api/csrftoken', {
    credentials: 'same-origin'
  })

  if (!response.ok) {
    throw new Error('Cannot find the CSRF')
  }

  const data = await response.json()
  return data.token
}

async function apiPost(url, body) {
  const token = await getCsrfToken()

  const headers = {
    'X-CSRFToken': token
  }

  if (!(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body
  })
}


async function checkSession() {
  try {
    const response = await fetch('/api/upload-panel/status', {
      credentials: 'same-origin'
    })

    const data = await response.json()
    authenticated.value = data.authenticated === true

    if (authenticated.value) {
      await loadSounds()
    }
  } catch (error) {
    message.value = 'Cannot contact the server.'
    console.error(error)
  }
}

async function login() {
  loading.value = true
  message.value = ''

  try {
    const response = await apiPost(
      '/api/upload-panel/login',
      JSON.stringify({
        password: password.value
      })
    )

    const data = await response.json()

    if (!response.ok || data.status !== 'ok') {
      throw new Error(data.message || 'Incorrect password')
    }

    authenticated.value = true
    password.value = ''

    message.value = 'Connected.'

    await loadSounds()
  } catch (error) {
    message.value = error.message
  } finally {
    loading.value = false
  }
}

async function logout() {
  loading.value = true

  try {
    const response = await apiPost(
      '/api/upload-panel/logout',
      ''
    )

    if (!response.ok) {
      throw new Error('Cannot log out.')
    }

    authenticated.value = false
    sounds.value = []
    levels.value = []
    tjaFiles.value = []
    oggFiles.value = []

    message.value = 'Logged out.'
  } catch (error) {
    message.value = error.message
  } finally {
    loading.value = false
  }
}


function normalizeFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
}

function parseTja(content) {
  content = content.replace(/^\uFEFF/, '')

  const title = content.match(
    /^\s*TITLE\s*:\s*(.*?)\s*$/im
  )

  const subtitle = content.match(
    /^\s*SUBTITLE\s*:\s*(.*?)\s*$/im
  )

  return {
    title: title?.[1]?.trim() || '',
    subtitle: subtitle?.[1]?.trim() || ''
  }
}


async function selectTjaFiles(event) {
  tjaFiles.value = Array.from(event.target.files || [])
  await buildLevelList()
}


async function selectOggFiles(event) {
  oggFiles.value = Array.from(event.target.files || [])
  await buildLevelList()
}


async function buildLevelList() {
  const oggs = new Map()

  for (const file of oggFiles.value) {
    const key = normalizeFilename(file.name)

    if (!oggs.has(key)) {
      oggs.set(key, file)
    }
  }

  const result = []

  for (const tja of tjaFiles.value) {
    const key = normalizeFilename(tja.name)
    const audio = oggs.get(key)

    let metadata = {
      title: '',
      subtitle: ''
    }

    try {
      const buffer = await tja.arrayBuffer()
      let content

      try {
        content = new TextDecoder('utf-8', {
          fatal: true
        }).decode(buffer)
      } catch {
        content = new TextDecoder('shift_jis').decode(buffer)
      }

      metadata = parseTja(content)
    } catch (error) {
      console.error(
        'Error while reading TJA :',
        tja.name,
        error
      )
    }

    result.push({
      id: `${key}-${result.length}`,
      tja,
      audio: audio || null,
      title: metadata.title,
      subtitle: metadata.subtitle,
      status: audio && metadata.title ? 'ready' : 'error'
    })
  }

  levels.value = result
}


function removeLevel(id) {
  levels.value = levels.value.filter(
    level => level.id !== id
  )
}


async function uploadLevels() {
  if (loading.value) return

  const readyLevels = levels.value.filter(
    level => level.status === 'ready'
  )

  if (readyLevels.length === 0) {
    message.value = 'No level to import.'
    return
  }

  loading.value = true

  let uploaded = 0
  const errors = []

  try {
    for (const [index, level] of readyLevels.entries()) {
      message.value =
        `Importing ${index + 1}/${readyLevels.length} : ${level.title}`

      const formData = new FormData()

      formData.append('title', level.title)
      formData.append('subtitle', level.subtitle)
      formData.append('tja', level.tja)
      formData.append('audio', level.audio)

      try {
        const response = await apiPost(
          '/api/upload-panel/songs',
          formData
        )

        const data = await response.json()

        if (!response.ok || data.status !== 'ok') {
          throw new Error(
            data.message || 'Server error'
          )
        }

        uploaded++
      } catch (error) {
        errors.push(
          `${level.title} : ${error.message}`
        )
      }
    }

    if (errors.length === 0) {
      message.value =
        `${uploaded} song(s) imported !`

      levels.value = []
      tjaFiles.value = []
      oggFiles.value = []

      const tjaInput = document.querySelector('#bulk-tja')
      const oggInput = document.querySelector('#bulk-ogg')

      if (tjaInput) tjaInput.value = ''
      if (oggInput) oggInput.value = ''
    } else {
      message.value =
        `${uploaded} imported, ${errors.length} error(s) : ` +
        errors.join(' | ')
    }
  } finally {
    loading.value = false
  }
}


function selectSound(event) {
  soundFile.value = event.target.files?.[0] || null
}

async function loadSounds() {
  soundsLoading.value = true

  try {
    const response = await fetch('/api/sounds', {
      credentials: 'same-origin',
      cache: 'no-store'
    })

    if (!response.ok) {
      throw new Error('Cannot find sounds')
    }

    const data = await response.json()
    sounds.value = data.sounds || []
  } catch (error) {
    console.error(error)
    message.value = error.message
  } finally {
    soundsLoading.value = false
  }
}

async function addSound() {
  if (!soundFile.value) {
    message.value = 'Select a audio.'
    return
  }

  const formData = new FormData()
  formData.append('sound', soundFile.value)

  loading.value = true
  message.value = 'Sending...'

  try {
    const response = await apiPost(
      '/api/upload-panel/sounds',
      formData
    )

    const data = await response.json()

    if (!response.ok || data.status !== 'ok') {
      throw new Error(
        data.message || 'Error while importing'
      )
    }

    message.value = `Sound added : ${data.filename}`

    soundFile.value = null

    const input = document.querySelector('#custom-sound')
    if (input) input.value = ''

    await loadSounds()
  } catch (error) {
    message.value = error.message
    console.error(error)
  } finally {
    loading.value = false
  }
}


function playSound(url) {
  stopSound()

  currentAudio = new Audio(url)

  currentAudio.play().catch(error => {
    console.error('Error while download audio :', error)
    message.value = 'Cannot read audio.'
  })
}

function stopSound() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }
}

onMounted(checkSession)
</script>

<template>
  <main class="upload-panel">


    <header class="panel-header">
      <div>
        <h2>Song Importer</h2>
        <p>Import Taiko Web songs</p>
      </div>

      <button
        v-if="authenticated"
        class="logout-button"
        type="button"
        @click="logout"
        :disabled="loading"
      >
        Logout
      </button>
    </header>


    <section v-if="!authenticated" class="login-area">
      <h3>Admin</h3>

      <form @submit.prevent="login">
        <input
          v-model="password"
          type="password"
          placeholder="admin password"
          autocomplete="current-password"
          required
        >

        <button type="submit" :disabled="loading">
          {{ loading ? 'login...' : 'Login' }}
        </button>
      </form>
    </section>


    <div v-else class="panel-content">


      <section class="upload-section">

        <div class="section-heading">
          <div>
            <h3>Song library</h3>
            <p class="section-description">
              Import your TJA(s) and OGG(s)
            </p>
          </div>
        </div>


        <label>
          Partitions (.tja)

          <input
            id="bulk-tja"
            type="file"
            accept=".tja"
            multiple
            @change="selectTjaFiles"
            :disabled="loading"
          >

          <small>
            {{ tjaFiles.length }} file(s) imported
          </small>
        </label>


        <label>
          Musics (.ogg)

          <input
            id="bulk-ogg"
            type="file"
            accept=".ogg,audio/ogg"
            multiple
            @change="selectOggFiles"
            :disabled="loading"
          >

          <small>
            {{ oggFiles.length }} file(s) imported
          </small>
        </label>


        <div class="bulk-summary">
          <strong>
            {{ levels.length }} song(s) detected
          </strong>

          <span>
            {{ levels.filter(level => level.status === 'ready').length }}
            ready to publish
          </span>

          <span>
            {{ levels.filter(level => level.status !== 'ready').length }}
            not complete
          </span>
        </div>


        <div v-if="levels.length" class="level-list">

          <article
            v-for="(level, index) in levels"
            :key="level.id"
            class="level-item"
          >

            <div class="level-info">

              <div class="level-title">
                <strong>
                  {{ level.title || level.tja.name }}
                </strong>

                <span
                  :class="
                    level.status === 'ready'
                      ? 'status-ready'
                      : 'status-error'
                  "
                >
                  {{ level.status === 'ready' ? 'Ready' : 'Not complete' }}
                </span>
              </div>

              <small>
                {{ level.subtitle || 'No subtitles' }}
              </small>

              <small>
                Partition : {{ level.tja.name }}
              </small>

              <small v-if="level.audio">
                Music : {{ level.audio.name }}
              </small>

              <small v-else class="missing-file">
                No music
              </small>

              <small v-if="!level.title" class="missing-file">
                No TITLE
              </small>

            </div>

            <button
              type="button"
              class="remove-level-button"
              @click="removeLevel(level.id)"
              :disabled="loading"
            >
              Remove
            </button>

          </article>

        </div>

        <div v-else class="empty-sounds">
          Import TJA(s) and OGG(s)
        </div>


        <button
          type="button"
          class="upload-levels-button"
          @click="uploadLevels"
          :disabled="
            loading ||
            !levels.some(level => level.status === 'ready')
          "
        >
          {{
            loading
              ? 'Importing...'
              : 'Importing...'
          }}
        </button>

      </section>

    </div>

    <p
      v-if="message"
      class="panel-message"
      role="status"
    >
      {{ message }}
    </p>

  </main>
</template>

<style scoped>
.upload-panel {
  box-sizing: border-box;
  width: calc(100% - 30px);
  max-width: 760px;
  margin: 30px auto;
  padding: 24px;
  color: #eee;
  background: #211d2a;
  border: 1px solid #393344;
  border-radius: 10px;
  font-family: Arial, sans-serif;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-bottom: 25px;
}

.panel-header h2 {
  margin: 0 0 7px;
}

.panel-header p {
  margin: 0;
  color: #aaa;
}

.upload-section,
.login-area {
  padding: 20px;
  margin-bottom: 18px;
  background: #2b2636;
  border: 1px solid #393344;
  border-radius: 8px;
}

.upload-section h3,
.login-area h3 {
  margin-top: 0;
}

.upload-panel label {
  display: block;
  margin: 15px 0;
  font-size: 14px;
}

.upload-panel input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 7px;
  padding: 11px;
  color: #eee;
  background: #191620;
  border: 1px solid #494254;
  border-radius: 5px;
}

.upload-panel input::file-selector-button {
  margin-right: 10px;
  padding: 7px 10px;
  color: white;
  background: #393344;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.upload-panel small {
  display: block;
  margin-top: 6px;
  color: #aaa;
  overflow-wrap: anywhere;
}

.upload-panel button {
  padding: 11px 18px;
  color: white;
  background: #7250a8;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
}

.upload-panel button:hover {
  background: #8965c1;
}

.upload-panel button:disabled {
  opacity: .5;
  cursor: wait;
}

.logout-button {
  background: #8d3d49 !important;
}

.section-description {
  color: #aaa;
  font-size: 13px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 15px;
}

.section-heading h3 {
  margin-bottom: 5px;
}


.bulk-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px;
  margin: 15px 0;
  background: #191620;
  border: 1px solid #393344;
  border-radius: 6px;
  font-size: 13px;
}

.bulk-summary span {
  color: #aaa;
}

/* LISTE DES NIVEAUX */

.level-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.level-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  background: #191620;
  border: 1px solid #393344;
  border-radius: 6px;
}

.level-info {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.level-info small {
  color: #aaa;
  overflow-wrap: anywhere;
}

.level-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.level-title strong {
  overflow-wrap: anywhere;
}

.status-ready {
  color: #65c99b;
  font-size: 12px;
}

.status-error,
.missing-file {
  color: #e47777 !important;
  font-size: 12px;
}

.remove-level-button {
  flex-shrink: 0;
  background: #8d3d49 !important;
}

.upload-levels-button {
  width: 100%;
  margin-top: 18px;
  background: #397b65 !important;
  font-weight: bold;
}

.upload-levels-button:hover {
  background: #469779 !important;
}

.refresh-button {
  background: #494254 !important;
  white-space: nowrap;
}

.sound-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.sound-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: #191620;
  border: 1px solid #393344;
  border-radius: 6px;
}

.sound-info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.sound-info > div {
  min-width: 0;
}

.sound-info strong {
  display: block;
  overflow-wrap: anywhere;
  font-size: 14px;
}

.sound-info small {
  font-size: 11px;
}

.sound-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  background: #393047;
  border-radius: 6px;
  color: #c7a5ff;
  font-size: 22px;
}

.play-button {
  flex-shrink: 0;
  background: #397b65 !important;
}

.stop-button {
  margin-top: 15px;
  background: #494254 !important;
}

.empty-sounds {
  padding: 20px;
  color: #aaa;
  text-align: center;
  background: #191620;
  border-radius: 5px;
  font-size: 13px;
}

.panel-message {
  padding: 12px;
  background: #302b3b;
  border-radius: 5px;
  overflow-wrap: anywhere;
}

@media (max-width: 550px) {
  .upload-panel {
    padding: 15px;
  }

  .panel-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .sound-item {
    align-items: flex-start;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .level-item {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
