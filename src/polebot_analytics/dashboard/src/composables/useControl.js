import { ref, computed } from 'vue'
import { useRos } from './useRos.js'
import { useBlackBox } from './useBlackBox.js'
import { isEStopActive, setEStop } from './useEStop.js'

// --- Singleton state ---
export { isEStopActive } // Re-export for components that import from useControl
export const maxLinearSpeed = ref(0.5)   // m/s
export const maxAngularSpeed = ref(0.5)  // rad/s
export const logs = ref([])

let eStopTimer = null
let eStopBroadcastInterval = null

export function useControl() {
  const { connected, odom, startVel, stopVel, publishVel } = useRos()

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

    // Synchronisation avec la Black Box (pour l'Operator Panel)
    const { addIncident } = useBlackBox()
    let severity = 'Info'
    if (type === 'error') severity = 'Critical'
    if (type === 'warning') severity = 'Warning'
    
    // Avoid double logging E-Stops (already handled by BlackBox watchers)
    if (!message.includes('Emergency Stop')) {
      addIncident(severity, 'Operation', message)
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
    const newState = !isEStopActive.value
    // Use setEStop() to broadcast the new state to ALL open tabs (dashboard + /teleop)
    setEStop(newState)
    if (newState) {
      stopVel()
      addLog("Emergency Stop activated!", "error")
      // Continuously broadcast v=0/w=0 while E-Stop is active
      eStopBroadcastInterval = setInterval(() => {
        stopVel()
      }, 200)
    } else {
      if (eStopBroadcastInterval) {
        clearInterval(eStopBroadcastInterval)
        eStopBroadcastInterval = null
      }
      addLog("Emergency Stop deactivated!", "success")
    }
  }

  // Wrapper injecting isEStopActive automatically
  function startVelGuarded(linear, angular) {
    if (isEStopActive.value) {
      stopVel()
      return
    }
    startVel(linear, angular)
  }

  function publishVelGuarded(linear, angular) {
    if (isEStopActive.value) {
      stopVel()
      return
    }
    publishVel(linear, angular)
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
    publishVelGuarded,
    stopVel
  }
}
