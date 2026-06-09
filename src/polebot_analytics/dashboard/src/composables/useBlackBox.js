import { ref, watch } from 'vue'
import { connected } from './useRos.js'
import { isEStopActive } from './useControl.js'
import { proximityWarning } from './useRos.js'
import { useBattery } from './useBattery.js'

// Singleton state
export const blackBoxLogs = ref(JSON.parse(localStorage.getItem('polebot_blackbox_logs') || '[]'))

// Multi-tab synchronization (updates the dashboard if modified from /teleop)
window.addEventListener('storage', (e) => {
  if (e.key === 'polebot_blackbox_logs' && e.newValue) {
    blackBoxLogs.value = JSON.parse(e.newValue)
  }
})

let initialized = false

export function useBlackBox() {
  function addIncident(severity, type, description) {
    const now = new Date()
    const timestamp = now.toLocaleTimeString() + ' ' + now.toLocaleDateString()
    
    const newLog = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5),
      timestamp,
      severity, // 'Critical' | 'Warning' | 'Info'
      type,
      description
    }
    
    blackBoxLogs.value.unshift(newLog)
    
    // Keep only last 100 entries
    if (blackBoxLogs.value.length > 100) {
      blackBoxLogs.value.pop()
    }
    
    localStorage.setItem('polebot_blackbox_logs', JSON.stringify(blackBoxLogs.value))
  }

  function clearBlackBox() {
    blackBoxLogs.value = []
    localStorage.setItem('polebot_blackbox_logs', '[]')
    addIncident('Info', 'Log Cleared', 'Incident Black Box logs cleared by operator.')
  }

  function exportBlackBoxAsJSON() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(blackBoxLogs.value, null, 2))
    const downloadAnchor = document.createElement('a')
    downloadAnchor.setAttribute("href", dataStr)
    downloadAnchor.setAttribute("download", `polebot_blackbox_${Date.now()}.json`)
    document.body.appendChild(downloadAnchor)
    downloadAnchor.click()
    downloadAnchor.remove()
  }

  // Set up watchers for automatic logging of incidents (runs once globally)
  if (!initialized) {
    initialized = true
    const { battery } = useBattery()

    // 1. Watch Connection status
    watch(connected, (newVal) => {
      if (newVal) {
        addIncident('Info', 'Connection Established', 'Successfully connected to ROS2 websocket bridge.')
      } else {
        addIncident('Critical', 'Connection Drop', 'Lost connection to ROS2 websocket bridge.')
      }
    }, { immediate: false })

    // 2. Watch E-Stop status
    watch(isEStopActive, (newVal) => {
      if (newVal) {
        addIncident('Critical', 'E-STOP Active', 'Emergency Stop activated by operator.')
      } else {
        addIncident('Info', 'E-STOP Released', 'Emergency Stop released.')
      }
    }, { immediate: false })

    // 3. Watch Proximity status (Lidar warning)
    watch(proximityWarning, (newVal) => {
      if (newVal) {
        addIncident('Warning', 'Collision Risk', 'Obstacle detected under 0.5m limit by Lidar!')
      }
    }, { immediate: false })

    // 4. Watch Battery status
    let lowBatteryLogged = false
    watch(battery, (newVal) => {
      if (newVal < 20) {
        if (!lowBatteryLogged) {
          addIncident('Warning', 'Low Battery', `Battery level dropped below 20% (${Math.round(newVal)}%). Please dock the robot.`)
          lowBatteryLogged = true
        }
      } else {
        lowBatteryLogged = false
      }
    }, { immediate: false })
  }

  return {
    blackBoxLogs,
    addIncident,
    clearBlackBox,
    exportBlackBoxAsJSON
  }
}
