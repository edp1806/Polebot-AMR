import { ref, computed } from 'vue'
import { useRos } from './useRos.js'

// --- Singleton state ---
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

  // ----- Log System -----
  function addLog(message, type = 'info') {
    const now = new Date()
    const timeString = now.toLocaleTimeString()
    logs.value.unshift({
      time: timeString,
      message: message,
      type: type
    })
    // Limit log count to 20
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

  // ⚠️ ROS2 ARCHITECTURE NOTE (Safety):
  // A Web button is a "Soft E-Stop". It must NEVER replace a real physical E-stop button.
  // HMI Safety: Long Press (1 second) to avoid accidental triggers on touchscreens
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
      addLog("Emergency Stop activated!", "error")
    } else {
      addLog("Emergency Stop deactivated!", "success")
    }
  }

  // Wrapper injecting isEStopActive automatically
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
