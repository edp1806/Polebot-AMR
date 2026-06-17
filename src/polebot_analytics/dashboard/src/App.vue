<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useBattery } from './composables/useBattery.js'
import { useRos } from './composables/useRos.js'
import { useControl } from './composables/useControl.js'
import { useInfluxDB } from './composables/useInfluxDB.js'
import { useMap } from './composables/useMap.js'
import { Point } from '@influxdata/influxdb-client'
import KpiDashboard from './components/KpiDashboard.vue'
import LiveControl from './components/LiveControl.vue'
import AnalyticsHistory from './components/AnalyticsHistory.vue'
import SensorDiagnostics  from './components/SensorDiagnostics.vue'
import OperatorPanel from './components/OperatorPanel.vue'
import NodeGraph from './components/NodeGraph.vue'
import { useAuth } from './auth/useAuth.js'
import QrcodeVue from 'qrcode.vue'

// --- Roles & Authentication ---
const { currentUser, isAuthenticated, login, logout } = useAuth()
const isAdmin = computed(() => currentUser?.value?.role === 'admin')

// --- Login Form ---
const loginForm = ref({ username: '', password: '', error: '' })
const handleLogin = () => {
  loginForm.value.error = ''
  const result = login(loginForm.value.username, loginForm.value.password)
  if (!result.success) {
    loginForm.value.error = result.error
  }
}

const handleLogout = () => {
  logout()
  loginForm.value.username = ''
  loginForm.value.password = ''
  _disconnectRos(addLog)
}

// --- Toasts ---
const toasts = ref([])
const addToast = (message, type = 'info') => {
  const id = Date.now() + Math.random()
  toasts.value.push({ id, message, type })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 4000)
}

// --- Singleton composables ---
const { battery, usageTime, sessionStartTime, resetUsageTime, updateBattery } = useBattery()
const { connected, connecting, odom, connectRos: _connectRos, disconnectRos: _disconnectRos, connectionPing, isLowBandwidthMode, proximityWarning } = useRos()
const { isEStopActive, stopVel, addLog } = useControl()
const { selectedRobotId, openAnalytics, writeApi, saveSessionToInflux } = useInfluxDB()
const { currentScan, drawMap, drawLidar } = useMap()

// --- App.vue local variables ---
const hostIp = window.location.hostname || 'localhost'
const wsUrl = ref(`ws://${hostIp}:9090`)

const isLightTheme = ref(false)
const toggleTheme = () => {
  isLightTheme.value = !isLightTheme.value
}

const showQrModal = ref(false)
const customIp = ref(hostIp === 'localhost' ? '172.16.33.69' : hostIp)
const dashboardUrl = computed(() => `http://${customIp.value}:${window.location.port || '5173'}/teleop`)

const route = useRoute()
const activeTab = computed(() => route.query.tab || 'control')

watch(activeTab, (newTab) => {
  if (newTab === 'analytics') openAnalytics()
}, { immediate: true })

watch(isEStopActive, (val) => {
  if (val) addToast("E-Stop Activated!", "error")
  else addToast("E-Stop Released", "success")
})

watch(proximityWarning, (val) => {
  if (val) addToast("Obstacle Detected - Collision Risk!", "warning")
})

let batteryWarned = false
watch(battery, (val) => {
  if (val < 20 && !batteryWarned) {
    addToast(`Critical battery: ${val.toFixed(1)}%`, "error")
    batteryWarned = true
  } else if (val >= 20) {
    batteryWarned = false
  }
})

// --- ROS Connection: wrappers that inject callbacks ---
function connectRos() {
  _connectRos(wsUrl.value, addLog, drawMap, drawLidar)
}
function disconnectRos() {
  // 1. Save session to InfluxDB (if active duration is greater than 0s)
  if(usageTime.value > 0 && sessionStartTime.value){
    saveSessionToInflux(usageTime.value, sessionStartTime.value);
  }
  // 2. Close ROS 2 connection
  _disconnectRos(addLog);
  // 3. Reset the timer and clear start time in localStorage
  resetUsageTime()
}

// --- setInterval: Battery discharge + InfluxDB sync (once per second) ---
setInterval(() => {
  if (!connected.value) return

  // 1. SIMULATED BATTERY DISCHARGE
  updateBattery(null, true, parseFloat(odom.value.linear_speed), parseFloat(odom.value.angular_speed))

  // 2. SAFETY SHIELD
  if (battery.value < 20 || isEStopActive.value) stopVel()

  // 3. SEND DATA TO INFLUXDB
  try {
    let minDistance = 999.0
    if (currentScan && currentScan.ranges) {
      for (let i = 0; i < currentScan.ranges.length; i++) {
        const d = currentScan.ranges[i]
        if (d !== null && d >= currentScan.range_min && d <= currentScan.range_max) {
          if (d < minDistance) minDistance = d
        }
      }
    }
    if (minDistance === 999.0) minDistance = 10.0

    const robotState = connected.value
      ? (parseFloat(odom.value.linear_speed) !== 0 || parseFloat(odom.value.angular_speed) !== 0 ? 'MOVING' : 'IDLE')
      : 'OFFLINE'

    const point = new Point('telemetry')
      .tag('robot_id', 'polebot_01')
      .tag('state', robotState)
      .floatField('battery_level', battery.value)
      .floatField('linear_speed', parseFloat(odom.value.linear_speed))
      .floatField('angular_speed', parseFloat(odom.value.angular_speed))
      .floatField('position_x', parseFloat(odom.value.x))
      .floatField('position_y', parseFloat(odom.value.y))
      .floatField('orientation_yaw', parseFloat(odom.value.yaw))
      .booleanField('estop_active', isEStopActive.value)
      .floatField('min_obstacle_distance', minDistance)

    writeApi.writePoint(point)
    writeApi.flush()
  } catch (err) {
    console.error("InfluxDB write error:", err)
  }
}, 1000)
</script>

<template>
  <div :data-theme="isLightTheme ? 'light' : 'dark'" class="app-container" style="display:flex; height:100vh; background:var(--bg-main); color:var(--text-primary); font-family:'Inter', sans-serif; overflow: hidden;">
    
    <!-- LOGIN OVERLAY -->
    <div v-if="!isAuthenticated" style="position: absolute; top:0; left:0; width: 100vw; height: 100vh; background: var(--bg-main); display: flex; align-items: center; justify-content: center; z-index: 10000;">
      <div class="card" style="width: 380px; padding: 40px; display: flex; flex-direction: column; gap: 20px; align-items: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="font-size: 40px;">🤖</div>
        <div style="text-align: center;">
          <h2 style="font-size: 22px; color: var(--text-primary); margin: 0;">Polebot AMR</h2>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 5px;">Restricted Access Dashboard</p>
        </div>
        
        <div style="width: 100%; display: flex; flex-direction: column; gap: 12px;">
          <input v-model="loginForm.username" type="text" placeholder="Username" style="width: 100%; padding: 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px;" @keyup.enter="handleLogin" />
          <input v-model="loginForm.password" type="password" placeholder="Password" style="width: 100%; padding: 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 8px;" @keyup.enter="handleLogin" />
        </div>
        
        <p v-if="loginForm.error" style="color: var(--accent-red); font-size: 12px; margin: 0; text-align: center;">{{ loginForm.error }}</p>
        
        <button @click="handleLogin" class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 15px;">Login</button>
      </div>
    </div>

    <!-- QR CODE MODAL -->
    <div v-if="showQrModal" style="position: absolute; top:0; left:0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10001;" @click="showQrModal = false">
      <div class="card" style="padding: 40px; display: flex; flex-direction: column; align-items: center; gap: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.7);" @click.stop>
        <div style="font-size: 30px;">📱</div>
        <h2 style="margin: 0; font-size: 20px; color: var(--text-primary);">Mobile Pairing</h2>
        <p style="font-size: 13px; color: var(--text-muted); text-align: center; max-width: 250px;">Scan this QR code with your mobile device to instantly access the teleoperation remote.</p>
        
        <div style="width: 100%; display: flex; flex-direction: column; gap: 8px; align-items: center;">
          <input v-model="customIp" type="text" placeholder="IP Address" style="width: 200px; padding: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: 6px; text-align: center; font-size: 13px;" />
          <div style="background: #fff; padding: 15px; border-radius: 12px; margin-top: 5px;">
            <qrcode-vue :value="dashboardUrl" :size="200" level="M" />
          </div>
        </div>
        
        <p style="color: var(--accent-blue); font-family: monospace; font-size: 11px; word-break: break-all; text-align: center; max-width: 280px;">{{ dashboardUrl }}</p>
        <button class="btn btn-primary" style="width: 100%; margin-top: 10px;" @click="showQrModal = false">Close</button>
      </div>
    </div>

    <!-- LEFT SIDEBAR -->
    <aside style="width: 260px; background: var(--bg-sidebar); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; z-index: 10;">
      <!-- Brand / Logo -->
      <div style="padding: 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 26px;">🤖</div>
        <div>
          <h1 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.5px;">Polebot AMR</h1>
          <div style="font-size: 11px; color: var(--accent-blue); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Fleet Manager</div>
        </div>
      </div>

      <!-- Navigation -->
      <nav style="padding: 20px 10px; flex: 1;">
        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 12px; padding-left: 10px;">Applications</div>
        
        <router-link :to="{ query: { tab: 'control' } }" class="sidebar-item" :class="{ 'active': activeTab === 'control' }" style="text-decoration:none;">
          <span style="font-size: 16px;">🎮</span> Live Control
        </router-link>

        <router-link :to="{ query: { tab: 'operator' } }" class="sidebar-item" :class="{ 'active': activeTab === 'operator' }" style="text-decoration:none;">
          <span style="font-size: 16px;">🛡️</span> Operator Panel
        </router-link>
        
        <router-link v-if="isAdmin" :to="{ query: { tab: 'analytics' } }" class="sidebar-item" :class="{ 'active': activeTab === 'analytics' }" style="text-decoration:none;">
          <span style="font-size: 16px;">📈</span> Analytics History
        </router-link>

        <router-link v-if="isAdmin" :to="{ query: { tab: 'kpi' } }" class="sidebar-item" :class="{ 'active': activeTab === 'kpi' }" style="text-decoration:none;">
          <span style="font-size: 16px;">📊</span> KPI Dashboard
        </router-link>

        <router-link v-if="isAdmin" :to="{ query: { tab: 'diagnostics' } }" class="sidebar-item" :class="{ 'active': activeTab === 'diagnostics' }" style="text-decoration:none;">
          <span style="font-size: 16px;">🩺</span> Diagnostics
        </router-link>

        <router-link v-if="isAdmin" :to="{ query: { tab: 'architecture' } }" class="sidebar-item" :class="{ 'active': activeTab === 'architecture' }" style="text-decoration:none;">
          <span style="font-size: 16px;">🕸️</span> Architecture
        </router-link>
      </nav>

      <!-- Fleet Selector & Roles -->
      <div style="padding: 15px 10px; border-top: 1px solid var(--border-color); background: var(--bg-sidebar);">
        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 10px; padding-left: 10px; display:flex; justify-content:space-between; align-items:center;">
          <span>Active Fleet</span>
          <span class="badge badge-green pulse" style="font-size:9px; padding:2px 6px;">1 Online</span>
        </div>
        <div class="fleet-item" :class="{ 'selected': selectedRobotId === 'polebot_01' }" @click="selectedRobotId = 'polebot_01'">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="status-dot green pulse"></div>
            <span style="font-size: 13px; font-weight: 500; color:var(--text-primary);">polebot_01</span>
          </div>
          <div style="font-size:11px; font-weight:600; color:var(--accent-green);">{{ Math.round(battery) }}% 🔋</div>
        </div>

        <div class="fleet-item" style="cursor: default; margin-top: 10px; background: rgba(0,0,0,0.1);">
          <div style="display:flex; flex-direction:column; gap:4px;">
            <div style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Logged in as</div>
            <div style="font-size: 13px; font-weight: 600; color: var(--accent-blue);">{{ currentUser?.displayName || 'Unknown' }}</div>
            <div style="font-size: 11px; color: var(--text-primary);">Role: {{ isAdmin ? 'Admin' : 'Operator' }}</div>
          </div>
        </div>

        <button @click="showQrModal = true" class="btn" style="width: 100%; margin-top: 15px; font-size: 12px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); text-align: center; padding: 10px;">
          📱 Pair Mobile Device
        </button>

        <button @click="handleLogout" class="btn" style="width: 100%; margin-top: 10px; font-size: 12px; background: rgba(239, 68, 68, 0.1); color: var(--accent-red); border: 1px solid rgba(239, 68, 68, 0.3); text-align: center; padding: 10px;">
          🔒 Disconnect & Switch User
        </button>
      </div>
    </aside>

    <!-- MAIN CONTENT AREA -->
    <main style="flex: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; background: var(--bg-main);">
      
      <!-- TOP HEADER -->
      <header style="height: 65px; min-height: 65px; padding: 0 25px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); background: var(--bg-header); box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <div style="font-size: 18px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 10px;">
          {{ activeTab === 'control' ? 'Live Control' : activeTab === 'operator' ? 'Operator Panel' : activeTab === 'analytics' ? 'Analytics & Data Historian' : activeTab === 'kpi' ? 'KPI Dashboard' : activeTab === 'architecture' ? 'System Architecture' : 'System Diagnostics' }}
          <span style="color:var(--text-muted); font-size:14px; font-weight:400;">/ {{ selectedRobotId }}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 15px;">
          <button @click="toggleTheme" class="btn" style="padding: 6px 12px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color);">
            {{ isLightTheme ? '🌙 Dark' : '☀️ Light' }}
          </button>
          <input v-model="wsUrl" placeholder="ws://localhost:9090" :disabled="connected" style="background:var(--bg-secondary); border:1px solid var(--border-color); color:var(--text-primary); padding:6px 12px; border-radius:6px; font-size:12px; width:180px;" />
          
          <!-- Latency & Bandwidth Badges (Bonus A) -->
          <div v-if="connected && connectionPing !== null" style="display: flex; align-items: center; gap: 8px;">
            <span class="badge" :class="connectionPing < 30 ? 'badge-green' : connectionPing < 100 ? 'badge-yellow' : 'badge-red'" style="padding: 6px 12px; font-size: 11px;">
              📶 {{ connectionPing }} ms
            </span>
            
            <span v-if="isLowBandwidthMode" class="badge pulse" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); padding: 6px 12px; font-size: 11px; font-weight: 600; border-radius: 6px;" title="SLAM Map rendering is throttled to preserve network performance">
              ⚠️ Low Bandwidth
            </span>
          </div>

          <span class="badge" :class="connected ? 'badge-green pulse' : 'badge-red'" style="padding: 6px 12px; font-size:11px;">
            {{ connected ? '● ROS2 Connected' : '● ROS2 Offline' }}
          </span>
          <button v-if="!connected" @click="connectRos" class="btn btn-primary" :disabled="connecting" style="padding: 6px 16px;">
            {{ connecting ? 'Connecting...' : '▶ Connect' }}
          </button>
          <button v-else @click="disconnectRos" class="btn btn-danger" style="padding: 6px 16px;">⏹ Disconnect</button>
        </div>
      </header>

      <!-- VIEWS -->
      <LiveControl v-show="activeTab === 'control'" />
      <OperatorPanel v-show="activeTab === 'operator'" />
      <AnalyticsHistory v-show="isAdmin && activeTab === 'analytics'" />
      <KpiDashboard v-show="isAdmin && activeTab === 'kpi'" />
      <SensorDiagnostics v-show="isAdmin && activeTab === 'diagnostics'" />
      <NodeGraph v-show="isAdmin && activeTab === 'architecture'" />

      <!-- TOAST CONTAINER -->
      <div style="position: absolute; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 10px; z-index: 9999;">
        <transition-group name="toast">
          <div v-for="t in toasts" :key="t.id" class="toast-item" :class="`toast-${t.type}`">
            {{ t.message }}
          </div>
        </transition-group>
      </div>

    </main>
  </div>
</template>

<style>

.sidebar-item {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 12px 15px; background: transparent; border: none;
  border-radius: 8px; color: var(--text-muted); font-size: 14px;
  font-weight: 500; text-align: left; cursor: pointer; transition: all 0.2s; margin-bottom: 5px;
}
.sidebar-item:hover { background: rgba(255,255,255,0.05); color: var(--text-primary); }
.sidebar-item.active { background: var(--accent-blue); color: #fff; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }

.sidebar-item.maintenance:hover {
  background: rgba(245, 158, 11, 0.1) !important;
  color: var(--accent-yellow) !important;
}
.sidebar-item.maintenance.active {
  background: var(--accent-yellow) !important;
  color: #fff !important;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3) !important;
}

.fleet-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s;
  border: 1px solid transparent; margin-bottom: 4px;
}
.fleet-item:hover { background: rgba(255,255,255,0.05); }
.fleet-item.selected { background: rgba(59, 130, 246, 0.15); border-color: rgba(59, 130, 246, 0.4); }

.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.green { background: var(--accent-green); box-shadow: 0 0 8px var(--accent-green); }
.status-dot.red { background: var(--accent-red); }

.main-grid { 
  display:grid; grid-template-columns:300px 1fr 300px; 
  gap:10px; padding:10px; flex:1; overflow:hidden; 
}
.col { display:flex; flex-direction:column; gap:10px; overflow-y:auto; }
.col-center { display:flex; flex-direction:column; overflow:hidden; }

.card { background:var(--bg-card); border:1px solid var(--border-color); border-radius:12px; padding:14px; }
.chart-card { transition: transform 0.15s, box-shadow 0.15s; }
.chart-card:hover { transform: scale(1.02); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
h2 { font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; }

.ctrl-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; width: 180px; margin: 0 auto; }
.ctrl-btn {
  padding:14px 8px; border-radius:8px; border:1px solid var(--border-color);
  background:var(--bg-secondary); color:var(--text-primary); cursor:pointer; font-size:16px;
  transition:all 0.15s; user-select:none;
}
.ctrl-btn:hover { background:var(--border-color); border-color:var(--accent-blue); }
.ctrl-btn:active { transform:scale(0.95); }
.ctrl-stop { background:rgba(239,68,68,0.1); border-color:rgba(239,68,68,0.3); color:var(--accent-red); }
.ctrl-stop:hover { background:rgba(239,68,68,0.2); }

.btn { padding:7px 14px; border-radius:8px; border:none; font-size:13px; font-weight:500; cursor:pointer; }
.btn-primary { background:var(--accent-blue); color:white; }
.btn-reset { background:var(--accent-yellow); color:white; }
.btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
.btn-danger { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }

.badge { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:20px; font-size:12px; font-weight:500; }
.badge-green { background:rgba(16,185,129,0.15); color:var(--accent-green); border:1px solid rgba(16,185,129,0.3); }
.badge-yellow { background:rgba(245,158,11,0.15); color:var(--accent-yellow); border:1px solid rgba(245,158,11,0.3); }
.badge-red { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }
.pulse { animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

/* Toasts */
.toast-item {
  padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
  box-shadow: 0 4px 15px rgba(0,0,0,0.2); backdrop-filter: blur(5px);
  color: white; min-width: 200px;
}
.toast-info { background: rgba(59, 130, 246, 0.9); border-left: 4px solid var(--accent-blue); }
.toast-success { background: rgba(16, 185, 129, 0.9); border-left: 4px solid var(--accent-green); }
.toast-warning { background: rgba(245, 158, 11, 0.9); border-left: 4px solid var(--accent-yellow); }
.toast-error { background: rgba(239, 68, 68, 0.9); border-left: 4px solid var(--accent-red); }

.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from { opacity: 0; transform: translateX(30px); }
.toast-leave-to { opacity: 0; transform: translateY(-20px); }
</style>
