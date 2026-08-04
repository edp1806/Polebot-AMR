<script setup>
import { watch } from 'vue'
import { useInfluxDB } from '../composables/useInfluxDB.js'
import { useBattery } from '../composables/useBattery.js'
import { useControl } from '../composables/useControl.js'

const {
  selectedRobotId, selectedTimeRange, expandedChart,
  showLinearSpeedLine, showAngularSpeedLine, showPosXLine, showPosYLine,
  fetchAndDrawChart, downloadChart, resetChart, changeTimeRange,
  drawExpandedChart, destroyExpandedChart,
  updateSpeedChartVisibility, updatePositionChartVisibility
} = useInfluxDB()

const { battery } = useBattery()
const { addLog } = useControl()

// Watcher: when clicking to expand a chart
watch(expandedChart, (chartType) => {
  if (!chartType) {
    destroyExpandedChart()
    return
  }
  setTimeout(() => drawExpandedChart(chartType), 100)
})

// Watcher: speed filters
watch([showLinearSpeedLine, showAngularSpeedLine], () => updateSpeedChartVisibility())

// Watcher: position filters
watch([showPosXLine, showPosYLine], () => updatePositionChartVisibility())

function handleReset() {
  resetChart(battery, addLog)
}
</script>


<template>
  <div v-if="true" style="padding: 15px; flex: 1; display: flex; flex-direction: column; overflow: auto;">
    
    <!-- Global toolbar -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
      <div style="display:flex; gap:15px; align-items:center;">
        <h2 style="margin:0;">📊 InfluxDB History (Full Session)</h2>
        <select v-model="selectedRobotId" @change="fetchAndDrawChart" style="padding:4px 8px; border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border-color); font-size:12px; cursor:pointer;">
          <option value="polebot_01">polebot_01</option>
        </select>
      </div>
      <button class="btn btn-reset" @click="handleReset" style="padding: 5px 10px; font-size:11px;">
        🔄 Reset
      </button>
      <div style="display:flex; gap:5px;">
        <button class="btn" :class="selectedTimeRange === '-5m' ? 'btn-primary' : ''" @click="changeTimeRange('-5m')" style="padding:4px 8px; font-size:11px;">5m</button>
        <button class="btn" :class="selectedTimeRange === '-30m' ? 'btn-primary' : ''" @click="changeTimeRange('-30m')" style="padding:4px 8px; font-size:11px;">30m</button>
        <button class="btn" :class="selectedTimeRange === '-1h' ? 'btn-primary' : ''" @click="changeTimeRange('-1h')" style="padding:4px 8px; font-size:11px;">1h</button>
        <button class="btn" :class="selectedTimeRange === '-4h' ? 'btn-primary' : ''" @click="changeTimeRange('-4h')" style="padding:4px 8px; font-size:11px;">4h</button>
        <button class="btn" :class="selectedTimeRange === '-24h' ? 'btn-primary' : ''" @click="changeTimeRange('-24h')" style="padding:4px 8px; font-size:11px;">24h</button>
      </div>
    </div>

    <!-- 2x2 Charts grid -->
    <div style="display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); grid-template-rows: 1fr 1fr; gap:12px; flex:1;">
      
      <!-- 1. Battery -->
      <div class="card chart-card" @click="expandedChart = 'battery'" style="display:flex; flex-direction:column; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:13px;">🔋 Battery</h3>
          <div style="display:flex; gap:10px; align-items:center;">
            <button class="btn btn-primary" @click.stop="downloadChart" style="padding: 4px 8px; font-size:10px;">
              💾 Save
            </button> 
            <span style="font-size:10px; color:var(--text-muted);">🔍 Click to enlarge</span>
          </div>
        </div>
        <div style="flex:1; position:relative; min-height: 0;">
          <canvas id="batteryChart"></canvas>
        </div>
      </div>

      <!-- 2. Speeds -->
      <div class="card chart-card" @click="expandedChart = 'speed'" style="display:flex; flex-direction:column; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:13px;">⚡ Speeds</h3>
          <div style="display:flex; gap:8px; align-items:center;" @click.stop>
            <label style="font-size:10px; cursor:pointer; color:var(--text-primary);">
              <input type="checkbox" v-model="showLinearSpeedLine"> Linear
            </label>
            <label style="font-size:10px; cursor:pointer; color:var(--text-primary);">
              <input type="checkbox" v-model="showAngularSpeedLine"> Angular
            </label>
            <button class="btn btn-primary" @click="downloadChart" style="padding: 4px 8px; font-size:10px;">
              💾 Save
            </button> 
            <span style="font-size:10px; color:var(--text-muted);">🔍 Click to enlarge</span>
          </div>
        </div>
        <div style="flex:1; position:relative; min-height: 0;">
          <canvas id="speedChart"></canvas>
        </div>
      </div>

      <!-- 3. Trajectory X/Y -->
      <div class="card chart-card" @click="expandedChart = 'trajectory'" style="display:flex; flex-direction:column; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:13px;">🗺️ Trajectory (X/Y)</h3>
          <div style="display:flex; gap:10px; align-items:center;">
            <button class="btn btn-primary" @click.stop="downloadChart" style="padding: 4px 8px; font-size:10px;">
              💾 Save
            </button> 
            <span style="font-size:10px; color:var(--text-muted);">🔍 Click to enlarge</span>
          </div>
        </div>
        <div style="flex:1; position:relative; min-height: 0;">
          <canvas id="trajectoryChart"></canvas>
        </div>
      </div>

      <!-- 4. Position over time -->
      <div class="card chart-card" @click="expandedChart = 'position'" style="display:flex; flex-direction:column; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:13px;">📍 Position (Time)</h3>
          <div style="display:flex; gap:8px; align-items:center;" @click.stop>
            <label style="font-size:10px; cursor:pointer; color:var(--text-primary);">
              <input type="checkbox" v-model="showPosXLine"> X(m)
            </label>
            <label style="font-size:10px; cursor:pointer; color:var(--text-primary);">
              <input type="checkbox" v-model="showPosYLine"> Y(m)
            </label>
            <button class="btn btn-primary" @click="downloadChart" style="padding: 4px 8px; font-size:10px;">
              💾 Save
            </button> 
            <span style="font-size:10px; color:var(--text-muted);">🔍 Click to enlarge</span>
          </div>
        </div>
        <div style="flex:1; position:relative; min-height: 0;">
          <canvas id="positionChart"></canvas>
        </div>
      </div>
    </div>

    <!-- MODAL: Expanded chart (fullscreen) -->
    <div v-if="expandedChart" 
      @click="expandedChart = null"
      style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:1000; display:flex; align-items:center; justify-content:center; padding:40px;">
      <div class="card" @click.stop style="width:90vw; height:85vh; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h2 style="margin:0;">
            {{ expandedChart === 'battery' ? '🔋 Battery' : expandedChart === 'speed' ? '⚡ Speeds' : expandedChart === 'trajectory' ? '🗺️ Trajectory' : '📍 Position' }}
          </h2>
          <div style="display:flex; gap:10px; align-items:center;">
            <div v-if="expandedChart === 'speed'" style="display:flex; gap:10px;">
              <label style="font-size:12px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showLinearSpeedLine"> ⬆️ Linear
              </label>
              <label style="font-size:12px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showAngularSpeedLine"> 🔄 Angular
              </label>
            </div>
            <div v-if="expandedChart === 'position'" style="display:flex; gap:10px;">
              <label style="font-size:12px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showPosXLine"> 🟢 X(m)
              </label>
              <label style="font-size:12px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showPosYLine"> 🟠 Y(m)
              </label>
            </div>
            <button class="btn btn-danger" @click="expandedChart = null" style="padding:5px 12px;">✕ Close</button>
          </div>
        </div>
        <div style="flex:1; position:relative;">
          <canvas id="expandedChartCanvas"></canvas>
        </div>
      </div>
    </div>
  </div>
</template>
