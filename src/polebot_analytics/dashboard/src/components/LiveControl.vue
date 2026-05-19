<script setup>
import { onMounted, ref } from 'vue'
import { useRos } from '../composables/useRos.js'
import { useControl } from '../composables/useControl.js'
import { useBattery } from '../composables/useBattery.js'
import { useMap } from '../composables/useMap.js'
import { mapCanvasRef } from '../composables/useMap.js'

const { odom, sensors, mapInfo } = useRos()
const { battery } = useBattery()
const {
  isEStopActive, maxLinearSpeed, maxAngularSpeed, logs,
  robotState, getStateColor, getLogColor,
  startEStopPress, cancelEStopPress,
  startVelGuarded, stopVel
} = useControl()
const { mapZoom, renderCanvas } = useMap()

const mapCanvas = ref(null)

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

        <div class="card" style="margin-top: 10px;">
          <h2>Robot Camera</h2>
          <img id="cameraStream" src="http://localhost:8080/stream?topic=/depth_camera/rgb/image_raw" 
               style="width: 100%; border-radius: 8px; background: #000;" alt="ROS2 Camera Stream" />
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
    </div>

    <!-- Colonne CENTRE (La Carte) -->
    <div class="col-center">
      <div class="card" style="flex:1; display:flex; flex-direction:column; min-height:400px;">
          <h2>Live Map (SLAM)</h2>
          <div style="font-size:10px; color:var(--text-muted); margin-bottom:8px">
            {{ mapInfo }}
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

    <!-- Colonne DROITE (Contrôles et Logs) -->
    <div class="col">
      
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
          <button class="ctrl-btn" @mousedown="startVelGuarded(maxLinearSpeed, 0)" @touchstart="startVelGuarded(maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▲</button>
          <div></div>
          <button class="ctrl-btn" @mousedown="startVelGuarded(0, maxAngularSpeed)" @touchstart="startVelGuarded(0, maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">◀</button>
          <button class="ctrl-btn ctrl-stop" @click="stopVel">⏹</button>
          <button class="ctrl-btn" @mousedown="startVelGuarded(0, -maxAngularSpeed)" @touchstart="startVelGuarded(0, -maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▶</button>
          <div></div>
          <button class="ctrl-btn" @mousedown="startVelGuarded(-maxLinearSpeed, 0)" @touchstart="startVelGuarded(-maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▼</button>
          <div></div>
        </div>

        <div style="text-align:center; font-size:11px; color:var(--text-muted); margin-top:8px">
          Maintenez cliqué pour piloter
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
