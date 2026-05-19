import { ref, computed } from 'vue'
import { useRos } from './useRos.js'

// --- État singleton ---
export const isEStopActive = ref(false)
export const maxLinearSpeed = ref(0.5)   // m/s
export const maxAngularSpeed = ref(0.5)  // rad/s
export const logs = ref([])

let eStopTimer = null

export function useControl() {
  const { connected, odom, startVel, stopVel } = useRos()

  // ⚠️ ROS2 ARCHITECTURE NOTICE:
  // Deducing state solely from speed (odom) is a limited approach.
  // The industrial approach: use Managed Nodes (Lifecycle) or Nav2 action server.
  const robotState = computed(() => {
    if (!connected.value) return 'OFFLINE'
    if (parseFloat(odom.value.linear_speed) !== 0 || parseFloat(odom.value.angular_speed) !== 0) return 'MOVING'
    return 'IDLE'
  })

  // We create a function to get the CSS style based on the state
  function getStateColor(state) {
    switch (state) {
      case 'MOVING': return 'badge-green'
      case 'IDLE': return 'badge-yellow'
      case 'OFFLINE': return 'badge-red'
      default: return ''
    }
  }

  // ----- Système de Logs -----
  function addLog(message, type = 'info') {
    const now = new Date()
    const timeString = now.toLocaleTimeString()
    logs.value.unshift({
      time: timeString,
      message: message,
      type: type
    })
    // On limite le nombre de logs à 20
    if (logs.value.length > 20) {
      logs.value.pop()
    }
  }

  function getLogColor(type) {
    switch (type) {
      case 'error': return 'var(--accent-red)'
      case 'warning': return 'var(--accent-yellow)'
      case 'success': return 'var(--accent-green)'
      default: return 'var(--text-secondary)'
    }
  }

  // ⚠️ AVIS ARCHITECTURE ROS2 (Sécurité) :
  // Un bouton Web est un "Soft E-Stop". Il ne doit JAMAIS remplacer le vrai bouton physique.
  // Sécurité IHM : Long Press (1 seconde) pour éviter les faux contacts sur écran tactile
  function startEStopPress() {
    eStopTimer = setTimeout(() => {
      toggleEStop()
    }, 1000)
  }

  function cancelEStopPress() {
    if (eStopTimer) clearTimeout(eStopTimer)
    eStopTimer = null
  }

  function toggleEStop() {
    isEStopActive.value = !isEStopActive.value
    if (isEStopActive.value) {
      stopVel()
      addLog("Arret d'urgence activé !", "error")
    } else {
      addLog("Arret d'urgence désactivé !", "success")
    }
  }

  // Wrapper qui injecte isEStopActive automatiquement
  function startVelGuarded(linear, angular) {
    startVel(linear, angular, isEStopActive)
  }

  return {
    // State
    isEStopActive,
    maxLinearSpeed,
    maxAngularSpeed,
    logs,
    robotState,
    // Functions
    addLog,
    getLogColor,
    getStateColor,
    startEStopPress,
    cancelEStopPress,
    toggleEStop,
    startVelGuarded,
    stopVel
  }
}
