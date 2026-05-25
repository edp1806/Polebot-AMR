<script setup>
import { onMounted, ref } from 'vue'
import { useRos } from '../composables/useRos.js'
import { useControl } from '../composables/useControl.js'
import { useBattery } from '../composables/useBattery.js'
import { useInfluxDB } from '../composables/useInfluxDB.js'
import { Point } from '@influxdata/influxdb-client'
import { useMap } from '../composables/useMap.js'
import { mapCanvasRef } from '../composables/useMap.js'

const { odom, sensors, mapInfo, sendNavGoal, cancelNavGoal, sendExplorationEnable, saveMap, clearMapSession } = useRos()
const { battery } = useBattery()
const {
  isEStopActive, maxLinearSpeed, maxAngularSpeed, logs,
  robotState, getStateColor, getLogColor,
  startEStopPress, cancelEStopPress,
  startVelGuarded, stopVel, addLog
} = useControl()
const { writeApi, selectedRobotId } = useInfluxDB()
const { mapZoom, renderCanvas, canvasToWorld, setGoal, clearGoal } = useMap()

const mapCanvas = ref(null)

const cameraTopic = ref('/depth_camera/rgb/image_raw')
const hostIp = window.location.hostname || 'localhost'

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
</script>

<template>
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
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-muted)">LIDAR</span>
            <span :style="{
              color: sensors.lidar === 'OK' ? 'var(--accent-green)' :
                     sensors.lidar === 'WARN' ? 'var(--accent-yellow)' :
                     (sensors.lidar === 'ERROR' || sensors.lidar === 'STALE') ? 'var(--accent-red)' :
                     'var(--text-secondary)'
            }">{{ sensors.lidar }}</span>
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

          <!-- Canvas de la carte avec zoom -->
          <div style="flex:1; width:100%; border-radius:8px; background:var(--bg-secondary); overflow:hidden; position:relative;">
            <canvas 
              ref="mapCanvas"
              :style="{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%) scale(' + mapZoom + ')',
                transformOrigin: 'center center'
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
            ▶️ Start Mission
          </button>
          
          <button v-else class="btn" style="padding: 12px; font-weight: bold; width: 100%; background: rgba(239,68,68,0.2); border: 1px solid var(--accent-red); color: var(--accent-red);" @click="endMissionTracker()">
            ⏹️ End Mission (Save Cycle Time)
          </button>
        </div>
      </div>

      <!-- Manual Control -->
      <div class="card">
        <button 
          @mousedown="startEStopPress" 
          @mouseup="cancelEStopPress" 
          @mouseleave="cancelEStopPress"
          @touchstart="startEStopPress" 
          @touchend="cancelEStopPress"
          class="btn" 
          :style="{ 
            width: '100%', 
            marginBottom: '15px', 
            padding: '12px', 
            fontWeight: 'bold',
            background: isEStopActive ? 'var(--accent-red)' : 'rgba(239,68,68,0.15)',
            color: isEStopActive ? '#fff' : 'var(--accent-red)',
            border: '2px solid var(--accent-red)'
          }">
          {{ isEStopActive ? "⚠️ EMERGENCY STOP LOCKED" : "🛑 HOLD 1s FOR EMERGENCY STOP" }}
        </button>
        <h2>Manual Control</h2>
        <div class="ctrl-grid">
          <div></div>
          <button class="ctrl-btn" @mousedown.prevent="startVelGuarded(maxLinearSpeed, 0)" @touchstart.prevent="startVelGuarded(maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▲</button>
          <div></div>
          <button class="ctrl-btn" @mousedown.prevent="startVelGuarded(0, maxAngularSpeed)" @touchstart.prevent="startVelGuarded(0, maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">◀</button>
          <button class="ctrl-btn ctrl-stop" @mousedown.prevent="stopVel" @touchstart.prevent="stopVel">⏹</button>
          <button class="ctrl-btn" @mousedown.prevent="startVelGuarded(0, -maxAngularSpeed)" @touchstart.prevent="startVelGuarded(0, -maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▶</button>
          <div></div>
          <button class="ctrl-btn" @mousedown.prevent="startVelGuarded(-maxLinearSpeed, 0)" @touchstart.prevent="startVelGuarded(-maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▼</button>
          <div></div>
        </div>

        <div style="text-align:center; font-size:11px; color:var(--text-muted); margin-top:8px">
          Press and hold to steer
        </div>

        <div style="margin-bottom: 15px; font-size: 12px; color: var(--text-muted);">
          <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
            <span>Max Speed (Linear): {{ maxLinearSpeed }} m/s</span>
          </div>
          <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxLinearSpeed" style="width:100%;">
          
          <div style="display:flex; justify-content:space-between; margin-bottom:5px; margin-top:10px;">
            <span>Max Speed (Angular): {{ maxAngularSpeed }} rad/s</span>
          </div>
          <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxAngularSpeed" style="width:100%;">
        </div>
      </div>

      <div class="card">
          <h2>Logs</h2>
          <div style="display:flex; flex-direction:column; gap:8px; max-height:200px;
          overflow-y:auto; padding-right:12px;">
            <div v-for="(log, index) in logs"
            :key="log.time + index"
            :style="{color: getLogColor(log.type)}">
            <span style="color:var(--text-muted)">[{{ log.time }}]</span>
            {{ log.message }}
            </div>
        </div>
      </div>
    </div>
  </div>
</template>
