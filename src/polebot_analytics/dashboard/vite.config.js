import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Plugin: affiche l'URL de la page de test téléop dans le terminal
function teleopUrlPlugin() {
  return {
    name: 'teleop-url',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer.address()
        const port = typeof addr === 'object' ? addr.port : 5173
        const host = 'localhost'
        setTimeout(() => {
          console.log(`\n  \x1b[33m🕹️  Téléopération (test) :\x1b[0m  \x1b[36mhttp://${host}:${port}/teleop\x1b[0m\n`)
        }, 100)
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), teleopUrlPlugin()],
  optimizeDeps: {
    include: ['roslib'],
  },
})

