<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRos } from '../composables/useRos.js'
import { useControl } from '../composables/useControl.js'
import { useAuth } from '../auth/useAuth.js'

const { odom, connected } = useRos()
const {
  isEStopActive, maxLinearSpeed, maxAngularSpeed,
  startEStopPress, cancelEStopPress,
  startVelGuarded, stopVel, toggleEStop
} = useControl()
const { currentUser } = useAuth()

// Only 'admin' role can send commands to the robot
const canControl = computed(() => currentUser.value?.role === 'admin')

const activeDir = ref(null)

function press(dir, lin, ang) {
  if (!connected.value || isEStopActive.value || !canControl.value) return
  activeDir.value = dir
  startVelGuarded(lin, ang)
}

function release() {
  activeDir.value = null
  stopVel()
}

// Keyboard — restricted to admins
function onKeyDown(e) {
  if (!canControl.value) return
  if (e.repeat || e.target.tagName === 'INPUT') return
  const k = e.key.toLowerCase()
  if (['w', 'arrowup'].includes(k))    { e.preventDefault(); press('fwd',  maxLinearSpeed.value,  0) }
  if (['s', 'arrowdown'].includes(k))  { e.preventDefault(); press('bwd', -maxLinearSpeed.value,  0) }
  if (['a', 'arrowleft'].includes(k))  { e.preventDefault(); press('lft',  0,  maxAngularSpeed.value) }
  if (['d', 'arrowright'].includes(k)) { e.preventDefault(); press('rgt',  0, -maxAngularSpeed.value) }
  if (k === ' ')                       { e.preventDefault(); release() }
}
function onKeyUp(e) {
  const k = e.key.toLowerCase()
  if (['w','s','a','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) release()
}

watch([connected, isEStopActive], ([c, e]) => { if (!c || e) release() })

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  release()
})
</script>

<template>
  <div class="page">

    <div class="header">
      <h1>🕹️ Movement Test — Polebot AMR</h1>
      <span class="badge" :class="connected ? 'green' : 'red'">
        {{ connected ? '● ROS2 Connected' : '● ROS2 Offline' }}
      </span>
    </div>

    <!-- E-STOP — admin only -->
    <template v-if="canControl">
    <button
      class="estop"
      :class="{ locked: isEStopActive }"
      @mousedown="startEStopPress"
      @mouseup="cancelEStopPress"
      @mouseleave="cancelEStopPress"
      @touchstart.prevent="startEStopPress"
      @touchend="cancelEStopPress"
    >
      {{ isEStopActive ? '⚠️ EMERGENCY STOP ACTIVE — HOLD TO UNLOCK' : '🛑 HOLD 1s — EMERGENCY STOP' }}
    </button>
    <button v-if="isEStopActive" class="unlock" @click="toggleEStop">
      🔧 Unlock
    </button>
    </template>

    <!-- Read-only notice for operators -->
    <div v-else class="operator-notice">
      👁️ Read-only mode — You do not have permission to control the robot.
    </div>

    <!-- DPAD -->
    <div class="dpad-wrap" :class="{ dimmed: !connected || isEStopActive }">
      <div class="dpad">
        <div></div>
        <button class="btn-dir" :class="{ active: activeDir==='fwd' }"
          @mousedown.prevent="press('fwd', maxLinearSpeed, 0)"
          @mouseup="release" @mouseleave="release"
          @touchstart.prevent="press('fwd', maxLinearSpeed, 0)"
          @touchend="release" @touchcancel="release"
          :disabled="!connected || isEStopActive">
          <span class="arrow">▲</span><br><small>Forward</small>
        </button>
        <div></div>

        <button class="btn-dir" :class="{ active: activeDir==='lft' }"
          @mousedown.prevent="press('lft', 0, maxAngularSpeed)"
          @mouseup="release" @mouseleave="release"
          @touchstart.prevent="press('lft', 0, maxAngularSpeed)"
          @touchend="release" @touchcancel="release"
          :disabled="!connected || isEStopActive">
          <span class="arrow">◀</span><br><small>Left</small>
        </button>
        <button class="btn-stop"
          @mousedown.prevent="release"
          @touchstart.prevent="release">
          <span class="arrow">⏹</span><br><small>Stop</small>
        </button>
        <button class="btn-dir" :class="{ active: activeDir==='rgt' }"
          @mousedown.prevent="press('rgt', 0, -maxAngularSpeed)"
          @mouseup="release" @mouseleave="release"
          @touchstart.prevent="press('rgt', 0, -maxAngularSpeed)"
          @touchend="release" @touchcancel="release"
          :disabled="!connected || isEStopActive">
          <span class="arrow">▶</span><br><small>Right</small>
        </button>

        <div></div>
        <button class="btn-dir" :class="{ active: activeDir==='bwd' }"
          @mousedown.prevent="press('bwd', -maxLinearSpeed, 0)"
          @mouseup="release" @mouseleave="release"
          @touchstart.prevent="press('bwd', -maxLinearSpeed, 0)"
          @touchend="release" @touchcancel="release"
          :disabled="!connected || isEStopActive">
          <span class="arrow">▼</span><br><small>Backward</small>
        </button>
        <div></div>
      </div>

      <div v-if="!connected || isEStopActive" class="overlay">
        <span v-if="!connected">🔌 Connect to ROS 2</span>
        <span v-else>🛑 E-Stop active</span>
      </div>
    </div>

    <!-- SPEEDS — admin only -->
    <div class="sliders" v-if="canControl">
      <div class="slider-row">
        <label>Max linear : <strong>{{ maxLinearSpeed.toFixed(1) }} m/s</strong></label>
        <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxLinearSpeed" />
      </div>
      <div class="slider-row">
        <label>Max angular : <strong>{{ maxAngularSpeed.toFixed(1) }} rad/s</strong></label>
        <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxAngularSpeed" />
      </div>
    </div>

    <!-- FEEDBACK -->
    <div class="feedback">
      <span>Vlin : <strong>{{ odom.linear_speed }} m/s</strong></span>
      <span>Vang : <strong>{{ odom.angular_speed }} rad/s</strong></span>
      <span>X : <strong>{{ odom.x }} m</strong></span>
      <span>Y : <strong>{{ odom.y }} m</strong></span>
    </div>

    <!-- KEYS — admin only -->
    <div class="keys-hint" v-if="canControl">
      <kbd>W</kbd>/<kbd>↑</kbd> Forward &nbsp;
      <kbd>S</kbd>/<kbd>↓</kbd> Backward &nbsp;
      <kbd>A</kbd>/<kbd>←</kbd> Left &nbsp;
      <kbd>D</kbd>/<kbd>→</kbd> Right &nbsp;
      <kbd>Space</kbd> Stop
    </div>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex; flex-direction: column; align-items: center;
  padding: 30px 20px; gap: 20px;
  background: #0d1117; color: #f0f0f0;
  font-family: 'Inter', sans-serif;
}

.header {
  display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
  justify-content: center;
}
h1 { font-size: 22px; font-weight: 700; margin: 0; }

.badge {
  padding: 5px 14px; border-radius: 20px;
  font-size: 12px; font-weight: 600;
}
.badge.green { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
.badge.red   { background: rgba(239,68,68,0.15);  color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

/* Operator read-only notice */
.operator-notice {
  width: 100%; max-width: 520px;
  padding: 14px 20px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-left: 3px solid #f59e0b;
  border-radius: 10px;
  font-size: 13px;
  color: #f59e0b;
  text-align: center;
}

/* ESTOP */
.estop {
  width: 100%; max-width: 520px;
  padding: 18px; font-size: 14px; font-weight: 800;
  border-radius: 10px; cursor: pointer;
  border: 2px solid #ef4444;
  background: rgba(239,68,68,0.12); color: #ef4444;
  transition: all 0.2s;
}
.estop:hover { background: rgba(239,68,68,0.2); }
.estop.locked {
  background: #ef4444; color: #fff;
  animation: pulse-estop 1s infinite alternate;
}
@keyframes pulse-estop {
  from { box-shadow: 0 0 10px rgba(239,68,68,0.5); }
  to   { box-shadow: 0 0 30px rgba(239,68,68,0.9); }
}
.unlock {
  padding: 10px 24px; border-radius: 8px; cursor: pointer;
  background: rgba(16,185,129,0.15); color: #10b981;
  border: 1px solid rgba(16,185,129,0.4); font-weight: 600; font-size: 13px;
}

/* DPAD */
.dpad-wrap { position: relative; }
.dpad-wrap.dimmed .dpad { opacity: 0.2; pointer-events: none; }
.dpad {
  display: grid; grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, minmax(80px, 110px));
  gap: 10px;
  width: 100%; max-width: 410px; margin: 0 auto;
}
.btn-dir, .btn-stop {
  border-radius: 12px; border: 2px solid #2e3a53;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  cursor: pointer; font-size: 13px; font-weight: 600;
  transition: all 0.12s; user-select: none; touch-action: none;
  color: #f0f0f0;
}
.btn-dir { background: #1a2540; }
.btn-dir:hover:not(:disabled) { background: rgba(59,130,246,0.15); border-color: #3b82f6; }
.btn-dir.active { background: rgba(59,130,246,0.3); border-color: #3b82f6; transform: scale(0.95); box-shadow: 0 0 20px rgba(59,130,246,0.4); }
.btn-dir:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-stop { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.4); color: #ef4444; }
.btn-stop:hover { background: rgba(239,68,68,0.2); }
.arrow { font-size: 30px; }

.overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.6); border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: #aaa; backdrop-filter: blur(3px);
}

/* SLIDERS */
.sliders {
  display: flex; flex-direction: column; gap: 12px;
  width: 100%; max-width: 520px;
  background: #161b22; border: 1px solid #2e3a53;
  border-radius: 12px; padding: 16px;
}
.slider-row { display: flex; flex-direction: column; gap: 6px; }
label { font-size: 13px; color: #aaa; }
label strong { color: #3b82f6; }
input[type=range] {
  width: 100%; height: 6px; border-radius: 3px;
  background: rgba(255,255,255,0.08); outline: none; -webkit-appearance: none; cursor: pointer;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 16px; height: 16px;
  border-radius: 50%; background: #3b82f6; cursor: pointer;
  box-shadow: 0 0 6px rgba(59,130,246,0.5);
}

/* FEEDBACK */
.feedback {
  display: flex; gap: 24px; flex-wrap: wrap; justify-content: center;
  background: #161b22; border: 1px solid #2e3a53;
  border-radius: 10px; padding: 12px 20px;
  font-size: 13px; color: #aaa;
}
.feedback strong { color: #f0f0f0; font-family: monospace; }

/* KEY HINTS */
.keys-hint { font-size: 12px; color: #555; text-align: center; }
kbd {
  background: #21262d; border: 1px solid #444;
  border-radius: 4px; padding: 2px 7px;
  font-family: monospace; font-size: 11px; color: #ccc;
}

@media (max-width: 600px) {
  .page { padding: 15px 10px; gap: 15px; }
  .header { display: none; } /* Hide redundant header on mobile */
  .keys-hint { display: none; } /* No keyboard on mobile */
  .dpad { grid-template-rows: repeat(3, 90px); gap: 6px; }
  .btn-dir, .btn-stop { padding: 5px; }
  .arrow { font-size: 24px; }
  .feedback { gap: 12px; padding: 10px; font-size: 11px; }
  .estop { padding: 14px; font-size: 12px; }
}
</style>
