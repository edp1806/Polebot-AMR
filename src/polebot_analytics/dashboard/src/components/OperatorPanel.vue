<script setup>
import { ref, computed } from 'vue'
import { useRos } from '../composables/useRos.js'
import { useControl } from '../composables/useControl.js'
import { useBattery } from '../composables/useBattery.js'
import { useBlackBox } from '../composables/useBlackBox.js'

const { connected, odom, sensors, proximityWarning, minDetectedRange, connectionPing, cancelNavGoal } = useRos()
const { isEStopActive, maxLinearSpeed, maxAngularSpeed, robotState, startEStopPress, cancelEStopPress, toggleEStop, stopVel } = useControl()
const { battery, estimatedAutonomy, dischargeRate } = useBattery()
const { blackBoxLogs, clearBlackBox, exportBlackBoxAsJSON } = useBlackBox()

// Init watchers
useBlackBox()

const batteryColor = computed(() => battery.value > 50 ? '#10b981' : battery.value > 20 ? '#f59e0b' : '#ef4444')

const severityClass = (s) => ({ 'Critical': 'sev-critical', 'Warning': 'sev-warning', 'Info': 'sev-info' }[s] || 'sev-info')

const recentAlarms = computed(() =>
  blackBoxLogs.value.filter(l => l.severity === 'Critical' || l.severity === 'Warning').slice(0, 5)
)
</script>

<template>
  <div class="op-root">

    <!-- ALARM BANNER -->
    <div v-if="proximityWarning || isEStopActive" class="alarm-banner">
      <span>🚨</span>
      <span v-if="isEStopActive">EMERGENCY STOP ACTIVE — Robot immobilized</span>
      <span v-else-if="proximityWarning">COLLISION RISK — Obstacle at {{ minDetectedRange.toFixed(2) }} m</span>
    </div>

    <div class="op-grid">

      <!-- ===== COL 1: SYSTEM STATUS ===== -->
      <div class="col">

        <div class="card">
          <div class="card-title"><span>🖥️</span> System Status</div>

          <div class="si"><span class="sl">ROS 2 Connection</span>
            <span class="sb" :class="connected ? 'ok' : 'err'">{{ connected ? '● Connected' : '● Offline' }}</span></div>

          <div class="si" v-if="connectionPing !== null"><span class="sl">Latency</span>
            <span class="sb" :class="connectionPing < 50 ? 'ok' : connectionPing < 150 ? 'warn' : 'err'">{{ connectionPing }} ms</span></div>

          <div class="si"><span class="sl">Robot State</span>
            <span class="sb" :class="robotState === 'MOVING' ? 'ok' : robotState === 'IDLE' ? 'warn' : 'err'">{{ robotState }}</span></div>

          <div class="si"><span class="sl">Emergency Stop</span>
            <span class="sb" :class="isEStopActive ? 'err' : 'ok'">{{ isEStopActive ? '⚠️ ACTIVE' : '✓ Inactive' }}</span></div>

          <div class="divider"></div>
          <div class="card-sub">Sensors</div>

          <div class="si"><span class="sl">🔴 Lidar</span>
            <span class="sb" :class="sensors.lidar === 'OK' ? 'ok' : sensors.lidar === 'WAITING' ? 'warn' : 'err'">{{ sensors.lidar }}</span></div>
          <div class="si"><span class="sl">📷 Camera</span>
            <span class="sb" :class="sensors.camera === 'OK' ? 'ok' : sensors.camera === 'WAITING' ? 'warn' : 'err'">{{ sensors.camera }}</span></div>
          <div class="si"><span class="sl">🗺️ SLAM</span>
            <span class="sb" :class="sensors.map === 'OK' ? 'ok' : sensors.map === 'WAITING' ? 'warn' : 'err'">{{ sensors.map }}</span></div>

          <div class="divider"></div>
          <div class="card-sub">Telemetry</div>

          <div class="mg">
            <div class="m"><div class="ml">Position X</div><div class="mv">{{ odom.x }} m</div></div>
            <div class="m"><div class="ml">Position Y</div><div class="mv">{{ odom.y }} m</div></div>
            <div class="m"><div class="ml">Linear Speed</div><div class="mv">{{ odom.linear_speed }} m/s</div></div>
            <div class="m"><div class="ml">Angular Speed</div><div class="mv">{{ odom.angular_speed }} rad/s</div></div>
          </div>
        </div>

        <!-- Battery -->
        <div class="card">
          <div class="card-title"><span>🔋</span> Battery</div>
          <div class="bat-wrap">
            <div class="bat-bar"><div class="bat-fill" :style="{ width: battery + '%', background: batteryColor }"></div></div>
            <span class="bat-pct" :style="{ color: batteryColor }">{{ Math.round(battery) }}%</span>
          </div>
          <div class="mg" style="margin-top:10px;">
            <div class="m"><div class="ml">Est. Autonomy</div><div class="mv">{{ estimatedAutonomy }}</div></div>
            <div class="m"><div class="ml">Discharge</div><div class="mv">{{ dischargeRate.toFixed(3) }} %/min</div></div>
          </div>
          <div v-if="battery < 20" class="inline-warn">⚠️ Critical Battery — Return to base recommended</div>
        </div>

        <!-- Proximity -->
        <div class="card" :class="{ 'card-alert': proximityWarning }">
          <div class="card-title"><span>📡</span> Obstacle Proximity</div>
          <div v-if="proximityWarning" class="prox-warn">
            🚨 Obstacle at <strong>{{ minDetectedRange.toFixed(2) }} m</strong>
          </div>
          <div v-else class="prox-ok">✓ Clear Zone</div>
          <div class="m" style="margin-top:8px;">
            <div class="ml">Min. distance detected</div>
            <div class="mv" :style="{ color: proximityWarning ? '#ef4444' : '#10b981' }">
              {{ minDetectedRange < 999 ? minDetectedRange.toFixed(2) + ' m' : '—' }}
            </div>
          </div>
        </div>
      </div>

      <!-- ===== COL 2: ALARMS ===== -->
      <div class="col alarm-col">
        <div class="card" style="flex:1; display:flex; flex-direction:column; min-height:0;">
          <div class="card-title" style="justify-content:space-between;">
            <div><span>🚨</span> Alarm Log</div>
            <div style="display:flex;gap:6px;">
              <button class="mini-btn" @click="exportBlackBoxAsJSON">⬇ Export</button>
              <button class="mini-btn danger" @click="clearBlackBox">🗑 Clear</button>
            </div>
          </div>

          <div v-if="recentAlarms.length > 0" class="recent-alarms">
            <div class="card-sub" style="margin-bottom:6px;">Recent unresolved alarms</div>
            <div v-for="a in recentAlarms" :key="a.id" class="alarm-card" :class="a.severity.toLowerCase()">
              <div class="alarm-top">
                <span class="asev" :class="severityClass(a.severity)">{{ a.severity.toUpperCase() }}</span>
                <span class="atype">{{ a.type }}</span>
                <span class="atime">{{ a.timestamp }}</span>
              </div>
              <div class="adesc">{{ a.description }}</div>
            </div>
          </div>
          <div v-else class="no-alarm">✓ No active alarms</div>

          <div class="divider"></div>
          <div class="card-sub" style="margin-bottom:6px;">History ({{ blackBoxLogs.length }} entries)</div>

          <div class="log-scroll">
            <div v-if="blackBoxLogs.length === 0" class="log-empty">No incident recorded</div>
            <div v-for="log in blackBoxLogs" :key="log.id" class="log-row">
              <span class="lsev" :class="severityClass(log.severity)">{{ log.severity[0] }}</span>
              <span class="ltime">{{ log.timestamp }}</span>
              <span class="ltype">{{ log.type }}</span>
              <span class="lmsg">{{ log.description }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ===== COL 3: CONTROLS ===== -->
      <div class="col">

        <!-- E-STOP -->
        <div class="card card-estop">
          <div class="card-title"><span>🛑</span> Safety</div>
          <button class="estop-btn" :class="{ locked: isEStopActive }"
            @mousedown="startEStopPress" @mouseup="cancelEStopPress" @mouseleave="cancelEStopPress"
            @touchstart.prevent="startEStopPress" @touchend="cancelEStopPress">
            {{ isEStopActive ? '⚠️ EMERGENCY STOP ACTIVE' : '🛑 HOLD 1s — EMERGENCY STOP' }}
          </button>
          <button v-if="isEStopActive" class="resolve-btn" style="margin-top:10px;" @click="toggleEStop">
            🔧 Unlock emergency stop
          </button>
          <p class="safety-note">This button is a software stop. It does not replace the robot's physical E-Stop button.</p>
        </div>

        <!-- Nav controls -->
        <div class="card">
          <div class="card-title"><span>🧭</span> Navigation Control</div>
          <button class="op-btn danger" @click="cancelNavGoal" :disabled="!connected">✕ Cancel Navigation</button>
          <button class="op-btn secondary" style="margin-top:8px;" @click="stopVel" :disabled="!connected">⏹ Immediate Motor Stop</button>
        </div>

        <!-- Speed limits -->
        <div class="card">
          <div class="card-title"><span>⚙️</span> Speed Limits</div>
          <div class="sl-block">
            <div class="sl-hdr"><span>Max Linear Speed</span><span class="sl-val">{{ maxLinearSpeed.toFixed(1) }} m/s</span></div>
            <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxLinearSpeed" class="rng" />
          </div>
          <div class="sl-block" style="margin-top:14px;">
            <div class="sl-hdr"><span>Max Angular Speed</span><span class="sl-val">{{ maxAngularSpeed.toFixed(1) }} rad/s</span></div>
            <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxAngularSpeed" class="rng" />
          </div>
          <div v-if="maxLinearSpeed > 1.0 || maxAngularSpeed > 1.0" class="inline-warn" style="margin-top:10px;">
            ⚠️ High speed selected
          </div>
        </div>

        <!-- Teleop link -->
        <div class="card warning-card">
          <div style="font-size:12px; font-weight:600; color:var(--accent-yellow); margin-bottom:8px;">
            ⚠️ Movement Test
          </div>
          <a href="/teleop" target="_blank" class="teleop-link">
            Open Teleoperation Dashboard ↗
          </a>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.op-root {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  padding: 12px; gap: 10px;
  overflow: hidden; box-sizing: border-box;
}

.alarm-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px; border-radius: 8px;
  background: rgba(239,68,68,0.15);
  border: 1px solid rgba(239,68,68,0.5);
  border-left: 5px solid #ef4444;
  color: #ef4444; font-weight: 700; font-size: 13px;
  animation: blink 1s infinite alternate;
}
@keyframes blink { from { box-shadow: 0 0 6px rgba(239,68,68,0.3); } to { box-shadow: 0 0 20px rgba(239,68,68,0.6); } }

.op-grid {
  display: grid; grid-template-columns: 260px 1fr 260px;
  gap: 10px; flex: 1; overflow: hidden;
}
.col { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
.alarm-col { overflow: hidden; }

.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px; padding: 14px;
}
.card-alert { border-color: rgba(239,68,68,0.4); }
.card-estop { border-color: rgba(239,68,68,0.3); }

.card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 10px; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;
}
.card-sub { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.8px; margin: 8px 0 4px; }
.divider { border: none; border-top: 1px solid var(--border-color); margin: 10px 0; }

/* STATUS ITEMS */
.si { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px; }
.sl { color: var(--text-muted); }
.sb { padding: 2px 9px; border-radius: 20px; font-size: 11px; font-weight: 700; }
.sb.ok   { background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); }
.sb.warn { background: rgba(245,158,11,0.15);  color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); }
.sb.err  { background: rgba(239,68,68,0.15);   color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }

.mg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.m { display: flex; flex-direction: column; }
.ml { font-size: 10px; color: var(--text-muted); }
.mv { font-size: 14px; font-weight: 700; color: #fff; font-family: monospace; }

.bat-wrap { display: flex; align-items: center; gap: 10px; }
.bat-bar { flex: 1; height: 12px; background: rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; }
.bat-fill { height: 100%; border-radius: 6px; transition: width 0.5s, background 0.3s; }
.bat-pct { font-size: 18px; font-weight: 800; font-family: monospace; min-width: 48px; text-align: right; }

.inline-warn { padding: 7px 10px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; font-size: 11px; color: #ef4444; }
.prox-warn { font-size: 13px; font-weight: 700; color: #ef4444; padding: 8px; background: rgba(239,68,68,0.1); border-radius: 6px; }
.prox-ok { font-size: 12px; color: #10b981; }

/* ALARM LOG */
.recent-alarms { margin-bottom: 8px; }
.alarm-card { padding: 8px 10px; border-radius: 8px; margin-bottom: 6px; border-left: 3px solid transparent; }
.alarm-card.critical { background: rgba(239,68,68,0.1); border-color: #ef4444; }
.alarm-card.warning  { background: rgba(245,158,11,0.08); border-color: #f59e0b; }
.alarm-top { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; flex-wrap: wrap; }
.asev { font-size: 10px; font-weight: 800; padding: 1px 7px; border-radius: 10px; }
.sev-critical { background: rgba(239,68,68,0.2); color: #ef4444; }
.sev-warning  { background: rgba(245,158,11,0.2); color: #f59e0b; }
.sev-info     { background: rgba(59,130,246,0.2);  color: #3b82f6; }
.atype { font-size: 12px; font-weight: 600; color: #fff; flex: 1; }
.atime { font-size: 10px; color: var(--text-muted); }
.adesc { font-size: 11px; color: var(--text-muted); }
.no-alarm { font-size: 12px; color: #10b981; padding: 8px 0; }

.log-scroll { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.log-empty { font-size: 12px; color: var(--text-muted); }
.log-row {
  display: grid; grid-template-columns: 16px 110px 120px 1fr;
  gap: 6px; align-items: start; padding: 4px 6px;
  border-radius: 4px; font-size: 11px;
}
.log-row:hover { background: rgba(255,255,255,0.03); }
.lsev { width: 14px; height: 14px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; flex-shrink: 0; }
.ltime { color: var(--text-muted); font-family: monospace; font-size: 10px; }
.ltype { font-weight: 600; color: var(--text-primary); }
.lmsg { color: var(--text-muted); }

.mini-btn { padding: 4px 10px; font-size: 11px; border-radius: 6px; cursor: pointer; background: rgba(255,255,255,0.06); border: 1px solid var(--border-color); color: var(--text-muted); transition: all 0.15s; }
.mini-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
.mini-btn.danger:hover { background: rgba(239,68,68,0.15); color: #ef4444; border-color: rgba(239,68,68,0.3); }

/* ESTOP */
.estop-btn {
  width: 100%; padding: 18px; font-weight: 800; font-size: 13px;
  border-radius: 8px; cursor: pointer; border: 2px solid #ef4444;
  background: rgba(239,68,68,0.12); color: #ef4444; transition: all 0.2s;
}
.estop-btn:hover { background: rgba(239,68,68,0.22); }
.estop-btn.locked { background: #ef4444; color: #fff; animation: ep 1s infinite alternate; }
@keyframes ep { from { box-shadow: 0 0 10px rgba(239,68,68,0.4); } to { box-shadow: 0 0 25px rgba(239,68,68,0.8); } }

.resolve-btn { width: 100%; padding: 10px; border-radius: 8px; cursor: pointer; background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.3); font-weight: 600; font-size: 12px; }
.safety-note { margin-top: 10px; font-size: 10px; color: var(--text-muted); padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; line-height: 1.4; }

.op-btn { width: 100%; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; border: none; transition: all 0.2s; }
.op-btn.danger    { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
.op-btn.danger:hover:not(:disabled)    { background: rgba(239,68,68,0.25); }
.op-btn.secondary { background: rgba(255,255,255,0.06); color: var(--text-muted); border: 1px solid var(--border-color); }
.op-btn.secondary:hover:not(:disabled) { background: rgba(255,255,255,0.1); color: #fff; }
.op-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.sl-block { display: flex; flex-direction: column; gap: 5px; }
.sl-hdr { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); }
.sl-val { color: var(--accent-blue); font-weight: 700; font-family: monospace; }
.rng { width: 100%; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; outline: none; -webkit-appearance: none; cursor: pointer; }
.rng::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--accent-blue); cursor: pointer; }

.teleop-link {
  display: inline-block; padding: 9px 20px;
  background: rgba(245,158,11,0.12);
  border: 1px solid rgba(245,158,11,0.35);
  color: var(--accent-yellow); border-radius: 8px;
  font-size: 12px; font-weight: 600; text-decoration: none;
  transition: all 0.2s;
}
.teleop-link:hover { background: rgba(245,158,11,0.22); }
</style>
