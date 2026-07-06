/**
 * useEStop.js — Global singleton E-Stop state
 *
 * Uses the BroadcastChannel API to synchronize the E-Stop state across
 * ALL browser tabs/windows (dashboard + /teleop page).
 * When any tab activates/deactivates E-Stop, all other tabs are notified instantly.
 * Fallback: localStorage polling every 500ms for maximum reliability.
 */
import { ref } from 'vue'

export const isEStopActive = ref(
  localStorage.getItem('polebot_estop') === 'true'
)

// BroadcastChannel: cross-tab communication (same origin only)
const estopChannel = new BroadcastChannel('polebot_estop_channel')

// Listen for E-Stop state changes broadcast from OTHER tabs
estopChannel.onmessage = (event) => {
  if (event.data?.type === 'ESTOP_CHANGE') {
    isEStopActive.value = Boolean(event.data.active)
    localStorage.setItem('polebot_estop', event.data.active)
  }
}

// Fallback 1: Listen to native storage events (cross-tab, triggered by other windows)
window.addEventListener('storage', (event) => {
  if (event.key === 'polebot_estop') {
    const newVal = event.newValue === 'true'
    if (isEStopActive.value !== newVal) {
      isEStopActive.value = newVal
    }
  }
})

// Fallback 2: Poll localStorage every 500ms to catch any missed updates
setInterval(() => {
  const storedVal = localStorage.getItem('polebot_estop') === 'true'
  if (isEStopActive.value !== storedVal) {
    isEStopActive.value = storedVal
  }
}, 500)

/**
 * Set the E-Stop state and broadcast to all other tabs.
 * Always use this function instead of setting isEStopActive.value directly.
 */
export function setEStop(active) {
  const val = Boolean(active)
  isEStopActive.value = val
  localStorage.setItem('polebot_estop', val)
  // Notify all other open tabs
  estopChannel.postMessage({ type: 'ESTOP_CHANGE', active: val })
}
