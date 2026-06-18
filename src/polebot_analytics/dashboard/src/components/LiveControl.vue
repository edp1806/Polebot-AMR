<script setup>
import { onMounted, onUnmounted, ref, watch, computed } from 'vue'
import { useRos } from '../composables/useRos.js'
import { useControl } from '../composables/useControl.js'
import { useBattery } from '../composables/useBattery.js'
import { useInfluxDB } from '../composables/useInfluxDB.js'
import { Point } from '@influxdata/influxdb-client'
import { useMap, activeGoal, mapCanvasRef } from '../composables/useMap.js'
import { useBlackBox } from '../composables/useBlackBox.js'

const { connected, odom, sensors, mapInfo, sendNavGoal, cancelNavGoal, sendExplorationEnable, saveMap, clearMapSession, proximityWarning, minDetectedRange } = useRos()
const { battery } = useBattery()
const {
  isEStopActive, maxLinearSpeed, maxAngularSpeed, logs,
  robotState, getStateColor, getLogColor,
  startEStopPress, cancelEStopPress,
  toggleEStop, addLog
} = useControl()
const { writeApi, selectedRobotId } = useInfluxDB()
const { mapZoom, renderCanvas, canvasToWorld, setGoal, clearGoal } = useMap()
const { blackBoxLogs, addIncident, clearBlackBox, exportBlackBoxAsJSON } = useBlackBox()
const logTab = ref('system')
const isLidarEquipped = ref(true) // Physical robot configuration: set to false for versions without Lidar

const distanceToGoal = computed(() => {
  if(!activeGoal.value) return null
  const rx = parseFloat(odom.value.x)
  const ry = parseFloat(odom.value.y)
  const dx = activeGoal.value.x - rx
  const dy = activeGoal.value.y - ry
  return Math.sqrt(dx*dx + dy*dy)
})

const linearSpeedPercent = computed(() => {
  return Math.min(100, (Math.abs(parseFloat(odom.value.linear_speed)) / maxLinearSpeed.value) * 100)
})
const angularSpeedPercent = computed(() => {
  return Math.min(100, (Math.abs(parseFloat(odom.value.angular_speed)) / maxAngularSpeed.value) * 100)
})


const mapCanvas = ref(null)

const cameraTopic = ref('/depth_camera/rgb/image_raw')
const hostIp = window.location.hostname || 'localhost'

const screenAlert = ref(null) // {title,message,type}
let lastProximityAlertTime = 0

function triggerScreenAlert(title,message,type){
  if ( type === 'proximity'){
    const now = Date.now();
    if(now - lastProximityAlertTime < 8000) return
    lastProximityAlertTime = now
  }
  screenAlert.value = {title, message, type}
  addLog(`🚨 [${type.toUpperCase()}] ${title}: ${message}`, type === 'estop' ? 'error' : 'warning')
  setTimeout(() => {
    if (screenAlert.value && screenAlert.value.title === title) {
      screenAlert.value = null
    }
  }, 5000)
}

watch(isEStopActive, (newVal) => {
  if(newVal){
    triggerScreenAlert(
      "EMERGENCY STOP ACTIVE",
      "Software emergency stop engaged. Robot is immobilized.",
      "estop"
    )
  }
})

watch(proximityWarning, (newVal) => {
  if (newVal && isLidarEquipped.value){
    triggerScreenAlert(
      "COLLISION WARNING",
      `Obstacle detected very close (${minDetectedRange.value.toFixed(2)}m). Speed reduction required.`,
      "proximity"
    )
  }
})

// --- Mission Cycle Tracker ---
const missionStartTime = ref(null)
const missionCycleTime = ref('00:00')
let missionTimer = null

function startMissionTracker() {
  missionStartTime.value = Date.now()
  addLog("🏁 Mission manuelle démarrée !", 'success')
  
  missionTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - missionStartTime.value) / 1000)
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    missionCycleTime.value = `${m}:${s}`
  }, 1000)
}

function endMissionTracker() {
  if (!missionStartTime.value) return
  clearInterval(missionTimer)
  
  const finalTime = missionCycleTime.value
  addLog(`✅ Mission terminée. Cycle Time : ${finalTime}`, 'success')
  
  if (writeApi) {
    const parts = finalTime.split(':')
    const seconds = parseInt(parts[0]) * 60 + parseInt(parts[1])
    
    const point = new Point('mission_performance')
      .tag('robot', selectedRobotId.value)
      .floatField('cycle_time_s', seconds)
      
    writeApi.writePoint(point)
    writeApi.flush()
  }
  
  missionStartTime.value = null
  missionCycleTime.value = '00:00'
}

// Handle click on SLAM map to trigger autonomous navigation 
function handleMapClick(event){
  const canvas = mapCanvas.value
  if (!canvas) return
  
  const rect = canvas.getBoundingClientRect()
  const clickX = (event.clientX - rect.left) * (canvas.width / rect.width)
  const clickY = (event.clientY - rect.top) * (canvas.height / rect.height)
  const {wx, wy} = canvasToWorld(clickX, clickY)

  setGoal(wx, wy)
  sendNavGoal(wx, wy)
  addLog(`🎯 New autonomous mission: X=${wx.toFixed(2)}, Y=${wy.toFixed(2)}`, 'info')
  addIncident('Info', 'Goal Dispatched', `New navigation target set to X=${wx.toFixed(2)}, Y=${wy.toFixed(2)}`)
}


function handleCancelGoal(){
  clearGoal()
  cancelNavGoal()
  addIncident('Warning', 'Goal Cancelled', 'Navigation mission cancelled by operator.')
  triggerScreenAlert(
    "MISSION CANCELLED",
    "Autonomous navigation cancelled. Target and trajectory reset.",
    "cancel"
  )
}

// ----- THE GAME LOOP -----
let isLoopRunning = false
function startRenderLoop() {
  if (odom.value) {
    renderCanvas(odom.value)
  }
  requestAnimationFrame(startRenderLoop)
}

onMounted(() => {
  mapCanvasRef.value = mapCanvas.value
  if (!isLoopRunning) {
    isLoopRunning = true
    requestAnimationFrame(startRenderLoop)
  }
})

onUnmounted(() => {
})
</script>

<template>
  <div class="live-control-container">
    <!-- Visual HUD Screen Alert Overlay (Fermeture au clic ou après 5s) -->
    <div v-if="screenAlert" class="hud-overlay" @click.stop="screenAlert = null">
      <div class="hud-card" :class="{ 'estop-card': screenAlert.type === 'estop', 'proximity-card': screenAlert.type === 'proximity', 'cancel-card': screenAlert.type === 'cancel' }">
        <div class="hud-header">
          <span class="hud-icon">🚨</span>
          <h2>{{ screenAlert.title }}</h2>
        </div>
        <div class="hud-body">
          <p>{{ screenAlert.message }}</p>
        </div>
        <div class="hud-footer">
          <span>Click to close or wait 5s...</span>
        </div>
        <!-- Barre de chargement qui rétrécit -->
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
      </div>
    </div>

    <!-- Visual Alarm Banner Overlay -->
    <div v-if="isEStopActive || (proximityWarning && isLidarEquipped)" class="alarm-banner" :class="{ 'estop-alarm': isEStopActive, 'proximity-alarm': !isEStopActive }">
      <div class="alarm-content">
        <span class="alarm-icon">🚨</span>
        <div class="alarm-text">
          <span class="alarm-title">{{ isEStopActive ? "EMERGENCY STOP LOCKED" : "COLLISION WARNING" }}</span>
          <span class="alarm-subtitle">
            {{ isEStopActive ? "Software E-Stop engaged. Robot is immobilized." : `Obstacle detected at ${minDetectedRange.toFixed(2)}m! (Threshold: 0.50m)` }}
          </span>
        </div>
      </div>
      <div class="alarm-actions">
        <button v-if="isEStopActive" class="btn btn-resolve" @click.stop="toggleEStop">
          🔧 Resolve E-Stop
        </button>
      </div>
    </div>

    <!-- 3. CONTROL TAB: MAIN GRID -->
    <div class="main-grid">
    <!-- LEFT Column (Live data) -->
    <div class="col">
      <div class="card">
        <h2>Position & Speeds</h2>
        
        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
          <div>
            <div style="font-size:10px; color:var(--text-muted)">POSITION X</div>
            <div style="font-size:24px; font-family:monospace; color:var(--accent-blue)">{{ odom.x }} m</div>
          </div>
          <div>
            <div style="font-size:10px; color:var(--text-muted)">POSITION Y</div>
            <div style="font-size:24px; font-family:monospace; color:var(--accent-green)">{{ odom.y }} m</div>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between;">
          <div>
            <div style="font-size:10px; color:var(--text-muted)">LINEAR SPEED</div>
            <div style="font-size:20px; font-family:monospace; color:var(--text-primary)">{{ odom.linear_speed }} m/s</div>
          </div>
          <div>
            <div style="font-size:10px; color:var(--text-muted)">ANGULAR SPEED</div>
            <div style="font-size:20px; font-family:monospace; color:var(--text-primary)">{{ odom.angular_speed }} rad/s</div>
          </div>
        </div>
      </div>

      <!-- BONUS 3: DYNAMIC NAVIGATION METRICS -->
      <div class="card nav-metrics-card">
        <h2>📍 Navigation Metrics</h2>

        <!-- Distance to Goal -->
        <div v-if="distanceToGoal !== null" class="metric-row">
          <span class="metric-label">Remaining Distance</span>
          <span class="metric-value" :style="{ color: distanceToGoal < 0.5 ? 'var(--accent-green)' : 'var(--accent-blue)' }">
            {{ distanceToGoal.toFixed(2) }} m
          </span>
        </div>
        <div v-else class="metric-row">
          <span class="metric-label">Remaining Distance</span>
          <span class="metric-value" style="color: var(--text-muted)">No target</span>
        </div>

        <!-- Linear Speed Gauge -->
        <div class="gauge-block">
          <div class="gauge-header">
            <span class="metric-label">Linear Speed</span>
            <span class="metric-value">{{ odom.linear_speed }} m/s</span>
          </div>
          <div class="gauge-bar-bg">
            <div class="gauge-bar-fill linear-fill" :style="{ width: linearSpeedPercent + '%' }"></div>
          </div>
        </div>

        <!-- Angular Speed Gauge -->
        <div class="gauge-block">
          <div class="gauge-header">
            <span class="metric-label">Angular Speed</span>
            <span class="metric-value">{{ odom.angular_speed }} rad/s</span>
          </div>
          <div class="gauge-bar-bg">
            <div class="gauge-bar-fill angular-fill" :style="{ width: angularSpeedPercent + '%' }"></div>
          </div>
        </div>

        <!-- Closest Obstacle -->
        <div v-if="isLidarEquipped" class="metric-row" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-color);">
          <span class="metric-label">🛡️ Nearest Obstacle</span>
          <span class="metric-value" :style="{ color: minDetectedRange < 0.5 ? 'var(--accent-red)' : minDetectedRange < 1.0 ? 'var(--accent-yellow)' : 'var(--accent-green)' }">
            {{ minDetectedRange < 100 ? minDetectedRange.toFixed(2) + ' m' : '—' }}
          </span>
        </div>
      </div>

      <!-- CARD: SYSTEM STATUS -->
      <div class="card">
        <h2>System Status</h2>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; 
        border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:12px;">
          <span style="font-size:12px; color:var(--text-muted)">ROBOT STATE</span>
          <span :class="['badge', getStateColor(robotState)]">{{ robotState }}</span>
        </div>

        <div style="display:flex; flex-direction: column; gap:8px; font-size:12px;">
          <!-- LIDAR -->
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:6px;">
              <input type="checkbox" v-model="isLidarEquipped" style="cursor:pointer; width:12px; height:12px; margin:0;" title="Toggle LIDAR Equipment Status">
              <span style="color:var(--text-muted)">LIDAR</span>
            </div>
            <span :style="{
              color: !isLidarEquipped ? 'var(--text-secondary)' :
                     sensors.lidar === 'OK' ? 'var(--accent-green)' :
                     sensors.lidar === 'WARN' ? 'var(--accent-yellow)' :
                     (sensors.lidar === 'ERROR' || sensors.lidar === 'STALE') ? 'var(--accent-red)' :
                     'var(--text-secondary)'
            }">{{ isLidarEquipped ? sensors.lidar : 'N/A' }}</span>
          </div>
          <!-- CAMERA -->
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-muted)">CAMERA</span>
            <span :style="{
              color: sensors.camera === 'OK' ? 'var(--accent-green)' :
                     sensors.camera === 'WARN' ? 'var(--accent-yellow)' :
                     (sensors.camera === 'ERROR' || sensors.camera === 'STALE') ? 'var(--accent-red)' :
                     'var(--text-secondary)'
            }">{{ sensors.camera }}</span>
          </div>
          <!-- MAP -->
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-muted)">MAP</span>
            <span :style="{
              color: sensors.map === 'OK' ? 'var(--accent-green)' :
                     sensors.map === 'WARN' ? 'var(--accent-yellow)' :
                     (sensors.map === 'ERROR' || sensors.map === 'STALE') ? 'var(--accent-red)' :
                     'var(--text-secondary)'
            }">{{ sensors.map }}</span>
          </div>
        </div>
      </div>

      <!-- CARD: LIVE MAP STATUS & CANCEL GOAL -->
      <div class="card map-control-card" style="margin-top: 5px; margin-bottom: 5px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h2 style="margin:0;">Live Map (SLAM)</h2>
            <div style="font-size:10.5px; color:var(--text-muted); margin-top: 4px; font-family: monospace;">
              {{ mapInfo }}
            </div>
          </div>
          <!-- Bouton d'annulation de but (Bonus 1) -->
          <button 
            @click="handleCancelGoal" 
            class="btn map-cancel-btn"
          >
            ❌ Cancel Goal
          </button>
        </div>
      </div>



    </div>

    <!-- CENTER COLUMN (The Map) -->
    <div class="col-center">
      <div class="card" style="flex:1; display:flex; flex-direction:column; min-height:400px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <h2 style="margin:0;">Live Map (SLAM)</h2>
              <div style="font-size:10px; color:var(--text-muted);">
                {{ mapInfo }}
              </div>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:16px; font-size:11px; color:var(--text-muted); margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span>Zoom: {{ Math.round(mapZoom * 100) }}%</span>
              <input type="range" min="0.2" max="3" step="0.1" v-model="mapZoom" style="width:100px;">              
            </div>
          </div>

          <!-- Map Canvas with zoom -->
          <div style="flex:1; width:100%; border-radius:8px; background:var(--bg-secondary); overflow:hidden; position:relative;">
            <canvas 
              ref="mapCanvas"
              @click="handleMapClick"
              :style="{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%) scale(' + mapZoom + ')',
                transformOrigin: 'center center',
                cursor: 'crosshair'
              }"
            ></canvas>
          </div>

          
          <div style="display:flex; gap:16px; margin-top:12px; font-size:11px; color:var(--text-muted); justify-content:center">
            <span>🔵 Robot</span>
            <span>⬜ Empty</span>
            <span>🔴 Obstacle</span>
          </div>
      </div>
    </div>

    <!-- RIGHT COLUMN (Controls and Logs) -->
    <div class="col">
      
      <!-- MISSION CYCLE TRACKER -->
      <div class="card" style="margin-bottom: 15px; border-left: 4px solid var(--accent-green);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="margin:0;">⏱️ Cycle Tracker</h2>
          <span style="font-family: monospace; font-size: 18px; font-weight:bold; color: var(--accent-green);">
            {{ missionCycleTime }}
          </span>
        </div>
        <p style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px; margin-top: -5px;">
          Manual mission time recording
        </p>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button v-if="!missionStartTime" class="btn btn-primary" style="padding: 12px; font-weight: bold; width: 100%; background: var(--accent-green);" @click="startMissionTracker()">
            ▶️ Start Timer
          </button>
          
          <button v-else class="btn" style="padding: 12px; font-weight: bold; width: 100%; background: rgba(239,68,68,0.2); border: 1px solid var(--accent-red); color: var(--accent-red);" @click="endMissionTracker()">
            ⏹️ End Timer (Save Cycle Time)
          </button>
        </div>
      </div>

      <!-- Safety Control (E-Stop Only) -->
      <div class="card" style="border-color: var(--accent-red);">
        <h2>Safety Controls</h2>
        <button 
          @mousedown="startEStopPress" 
          @mouseup="cancelEStopPress" 
          @mouseleave="cancelEStopPress"
          @touchstart="startEStopPress" 
          @touchend="cancelEStopPress"
          class="btn" 
          :style="{ 
            width: '100%', 
            padding: '16px', 
            fontWeight: 'bold',
            fontSize: '14px',
            background: isEStopActive ? 'var(--accent-red)' : 'rgba(239,68,68,0.15)',
            color: isEStopActive ? '#fff' : 'var(--accent-red)',
            border: '2px solid var(--accent-red)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isEStopActive ? '0 0 15px rgba(239, 68, 68, 0.4)' : 'none'
          }">
          {{ isEStopActive ? "⚠️ EMERGENCY STOP LOCKED" : "🛑 HOLD 1s FOR EMERGENCY STOP" }}
        </button>
      </div>

      <!-- LIVE CAMERA FEED -->
      <div class="card" style="margin-top: 15px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="margin:0;">📷 Live Camera</h2>
          <input type="text" v-model="cameraTopic" placeholder="/depth_camera/rgb/image_raw" style="width: 170px; font-size: 10px; padding: 4px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 4px;">
        </div>
        <div style="background: #000; border-radius: 6px; overflow: hidden; min-height: 160px; display: flex; align-items: center; justify-content: center; position: relative;">
          <div style="color: var(--text-muted); font-size: 11px; position: absolute; text-align: center; padding: 10px;">
            Waiting for camera feed...<br>
            <code style="font-size: 9px;">ros2 run web_video_server web_video_server</code>
          </div>
          <img :src="`http://${hostIp}:8080/stream?topic=${cameraTopic}`" style="width: 100%; position: relative; z-index: 1; display: none;" onload="this.style.display='block'" onerror="this.style.display='none'" />
        </div>
      </div>

    </div>
  </div>
</div>
</template>

<style scoped>
.live-control-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.alarm-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 16px 24px;
  border-radius: 12px;
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  animation: pulse-border-estop 1.5s infinite alternate ease-in-out;
  transition: all 0.3s ease;
}

.estop-alarm {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.45);
  animation-name: pulse-border-estop;
}

.proximity-alarm {
  background: rgba(245, 158, 11, 0.2);
  border: 1px solid rgba(245, 158, 11, 0.45);
  animation-name: pulse-border-proximity;
}

.alarm-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.alarm-icon {
  font-size: 28px;
  animation: shake 0.5s infinite;
}

.alarm-text {
  display: flex;
  flex-direction: column;
}

.alarm-title {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #fff;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
}

.alarm-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 2px;
}

.alarm-actions {
  display: flex;
  gap: 10px;
}

.btn-mute {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-mute:hover {
  background: rgba(255, 255, 255, 0.2);
}

.btn-resolve {
  background: rgba(239, 68, 68, 0.6);
  color: #fff;
  border: 1px solid rgba(239, 68, 68, 0.8);
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-resolve:hover {
  background: rgba(239, 68, 68, 0.8);
}

.log-item.log-error { border-left-color: var(--accent-red); background: rgba(239, 68, 68, 0.05); }

@keyframes pulse-border-estop {
  0% {
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.3), 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  }
  100% {
    box-shadow: 0 0 20px rgba(239, 68, 68, 0.65), 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  }
}

@keyframes pulse-border-proximity {
  0% {
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.3), 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  }
  100% {
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.65), 0 8px 32px 0 rgba(0, 0, 0, 0.3);
  }
}

@keyframes shake {
  0% { transform: translate(1px, 1px) rotate(0deg); }
  10% { transform: translate(-1px, -2px) rotate(-1deg); }
  20% { transform: translate(-3px, 0px) rotate(1deg); }
  30% { transform: translate(0px, 2px) rotate(0deg); }
  40% { transform: translate(1px, -1px) rotate(1deg); }
  55% { transform: translate(-1px, 2px) rotate(-1deg); }
  70% { transform: translate(-3px, 1px) rotate(0deg); }
  85% { transform: translate(1px, 1px) rotate(-1deg); }
  100% { transform: translate(1px, -2px) rotate(0deg); }
}

/* Fond flouté couvrant tout l'écran */
.hud-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(10, 10, 15, 0.75);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  z-index: 99999;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  animation: fade-in 0.25s ease-out;
}

/* Carte centrale glassmorphism */
.hud-card {
  width: 460px;
  background: rgba(23, 23, 35, 0.9);
  border-radius: 16px;
  padding: 32px;
  text-align: center;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
  position: relative;
  overflow: hidden;
  animation: scale-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.estop-card {
  border-color: rgba(239, 68, 68, 0.6);
  box-shadow: 0 0 40px rgba(239, 68, 68, 0.35), 0 24px 64px rgba(0, 0, 0, 0.7);
}

.proximity-card {
  border-color: rgba(245, 158, 11, 0.6);
  box-shadow: 0 0 40px rgba(245, 158, 11, 0.35), 0 24px 64px rgba(0, 0, 0, 0.7);
}

.hud-icon {
  font-size: 52px;
  display: block;
  margin-bottom: 16px;
  animation: bounce 0.6s infinite alternate ease-in-out;
}

.hud-card h2 {
  font-size: 22px;
  font-weight: 800;
  margin-bottom: 16px;
  color: #fff;
  letter-spacing: 1px;
}

.hud-body p {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.6;
  margin-bottom: 24px;
}

.hud-footer {
  font-size: 11px;
  color: var(--text-muted);
}

/* Barre de progression défilante (5 secondes) */
.progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
}

.progress-fill {
  height: 100%;
  width: 100%;
  background: var(--accent-red);
  animation: shrink-bar 5s linear forwards;
}

.proximity-card .progress-fill {
  background: var(--accent-yellow);
}

/* À insérer dans ta balise <style scoped> (par exemple sous les règles .proximity-card) */

.cancel-card {
  border-color: rgba(59, 130, 246, 0.6); /* Bordure bleue */
  box-shadow: 0 0 40px rgba(59, 130, 246, 0.35), 0 24px 64px rgba(0, 0, 0, 0.7); /* Lueur bleue */
}

.cancel-card .progress-fill {
  background: var(--accent-blue); /* Barre de chargement bleue */
}

/* Encadré identique aux autres cartes de la colonne */
.map-control-card {
  border: 1px solid var(--border-color) !important;
  background: var(--bg-card) !important;
  box-shadow: none !important;
}

/* Bouton bleu identique aux accents de la colonne */
.map-cancel-btn {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: bold;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.45);
  color: var(--accent-blue);
  cursor: pointer;
  transition: all 0.2s ease;
}

.map-cancel-btn:hover {
  background: rgba(59, 130, 246, 0.25);
  border-color: var(--accent-blue);
  box-shadow: 0 0 10px rgba(59, 130, 246, 0.3);
  transform: translateY(-1px);
}

.map-cancel-btn:active {
  transform: translateY(0);
}

/* Bonus 3: Navigation Metrics Panel */
.nav-metrics-card {
  border-left: 4px solid var(--accent-blue) !important;
}

.metric-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.metric-label {
  font-size: 11px;
  color: var(--text-muted);
}

.metric-value {
  font-size: 14px;
  font-family: monospace;
  font-weight: 700;
  color: var(--accent-blue);
}

.gauge-block {
  margin-bottom: 10px;
}

.gauge-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.gauge-bar-bg {
  height: 8px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.gauge-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.linear-fill {
  background: linear-gradient(90deg, var(--accent-blue), var(--accent-green));
}

.angular-fill {
  background: linear-gradient(90deg, var(--accent-yellow), #f97316);
}

/* Animations */
@keyframes shrink-bar {
  from { width: 100%; }
  to { width: 0%; }
}

@keyframes scale-up {
  from { transform: scale(0.85); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes bounce {
  from { transform: translateY(0); }
  to { transform: translateY(-8px); }
}

</style>
