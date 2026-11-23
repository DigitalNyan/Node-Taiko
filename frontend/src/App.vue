
<script setup>
import { onMounted, ref } from 'vue'
import UploadPanel from './UploadPanel.vue'

const isAdmin = window.location.pathname.replace(/\/$/, '') === '/admin'

const loaded = ref(false)
const loadError = ref('')

function addStyle(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = resolve
    link.onerror = () => reject(new Error('Cannot load ' + href))
    document.head.appendChild(link)
  })
}

function addScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.onload = resolve
    script.onerror = () => reject(new Error('Cannot load ' + src))
    document.body.appendChild(script)
  })
}

onMounted(async () => {
  if (isAdmin) return

  try {
    await addStyle('/src/css/loader.css')

    for (const file of [
      '/src/js/assets.js',
      '/src/js/strings.js',
      '/src/js/pageevents.js',
      '/src/js/loader.js',
      '/src/js/browsersupport.js',
      '/src/js/main.js'
    ]) {
      await addScript(file)
    }

    loaded.value = true
  } catch (error) {
    console.error(error)
    loadError.value = error.message
  }
})
</script>

<template>
  <UploadPanel v-if="isAdmin" />

  <template v-else>
    <div id="assets"></div>
    <div id="screen" class="pattern-bg"></div>

    <div data-nosnippet id="version">
      <a
        id="version-link"
        class="stroke-sub"
        href="https://github.com/bui/taiko-web/"
        target="_blank"
        rel="noopener"
      >
        Node-Taiko by DigitalNyan
      </a>
    </div>

    <div v-if="loadError" class="migration-error">
      <h2>Error while loading</h2>
      <p>{{ loadError }}</p>
      <p>Cannot load the game.</p>
    </div>

    <noscript>
      <div id="unsupportedBrowser">
        <div id="unsupportedWarn">!</div>
        <span>Taiko Web requires JavaScript to be enabled.</span>
      </div>
    </noscript>
  </template>
</template>

<style>
.migration-error {
  position: fixed;
  z-index: 99999;
  inset: 10px 10px auto;
  padding: 18px;
  background: #7c2020;
  color: white;
  font: 14px Arial;
  border-radius: 8px;
}
</style>
