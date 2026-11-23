
const CustomSounds = {
  sounds: {},

  async load() {
    try {
      const response = await fetch('/api/sounds')

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()

      for (const sound of data.sounds || []) {
        this.sounds[sound.name] = new Audio(sound.url)
      }

      console.log(
        `${Object.keys(this.sounds).length} sons personnalisés chargés`
      )
    } catch (error) {
      console.error('Erreur de chargement des sons :', error)
    }
  },

  play(name) {
    const sound = this.sounds[name]

    if (!sound) {
      console.warn(`Son introuvable : ${name}`)
      return
    }

    sound.currentTime = 0
    sound.play().catch(console.error)
  }
}

window.CustomSounds = CustomSounds

CustomSounds.load()
