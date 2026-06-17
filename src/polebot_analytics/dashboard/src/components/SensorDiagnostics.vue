<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRos, topicRates} from '../composables/useRos.js'
import { useBlackBox } from '../composables/useBlackBox.js' 
import NodeGraph from './NodeGraph.vue'

const { connected} = useRos()
const {blackBoxLogs} = useBlackBox()



// Style utility function
function getStatusBadgeClass(status){
  switch (status){
    case 'OK' : return 'badge-green'
    case 'STALE' : return 'badge-yellow'
    case 'ERROR' : return 'badge-red'
    default: return 'badge-red'
  }
}
</script>

<template>
  <div class="diagnostics-container" style="padding: 25px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; height: 100%;">
     <!-- Diagnostics & Alarms Grid -->
      <div style="display: grid; grid-template-columns: 1fr; gap: 20px;">
        <!-- Topics Table -->
        <div class="card">
          <h2 style="margin-top: 0; margin-bottom: 20px; font-size: 16px; border-bottom: 1px solid var(--border-color); 
          padding-bottom: 10px;">📡 ROS2 Sensor Topics Monitor</h2>
          <div v-if="!connected" style="text-align: center; color: var(--text-muted); padding: 40px 0;">
            ❌ Connect the robot to start diagnostics
          </div>
          <table v-else style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-muted); font-size: 12px;">
                <th style="padding: 12px 8px;">Topic</th>
                <th style="padding: 12px 8px;">Type</th>
                <th style="padding: 12px 8px; text-align: center;">Frequency</th>
                <th style="padding: 12px 8px; text-align: right;">status</th>
              </tr>            
            </thead>
            <tbody>
              <tr v-for="(topic, key) in topicRates" :key="key" style="border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 13px;">
                <td style="padding: 14px 8px; font-weight: 600; color: #fff;">{{  topic.name }}</td>
                <td style="padding: 14px 8px; color: var(--text-muted);">{{ topic.type }}</td>
                <td style="padding: 14px 8px; text-align: center; color: var(--accent-blue); font-weight: bold;">{{ topic.hz }} Hz</td>
                <td style="padding: 14px 8px; text-align: right;">
                  <span class="badge" :class="getStatusBadgeClass(topic.status)">● {{ topic.status }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          </div>

      </div>
      <!-- Safety alarms log -->
       <div class="card" style="margin-top: 10px;">
        <h2 style="margin-top: 0; margin-bottom: 15px; font-size: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;
        color: var(--accent-red); display: flex; align-items: center; gap: 8px;">
          ⚠️ Recent Critical Safety Events
        </h2>

        <div v-if="blackBoxLogs.filter(log => log.severity === 'Critical').length === 0" style="text-align: center; color: var(--text-muted);
        font-size: 13px; padding: 20px 0;">✅ No critical safety events in memory.</div>

        <div v-else style="display: flex; flex-direction: column; gap: 8px; max-height: 150px; overflow-y: auto; padding-right: 5px;">
          <div v-for="incident in blackBoxLogs.filter(log => log.severity === 'Critical').slice(0, 5)"
            :key="incident.id"
            style="font-size: 12px; display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(239, 68, 68, 0.05);
            border-left: 4px solid var(--accent-red); border-radius: 4px;">
            <div>
              <span style="font-weight: 700; color: #fff; margin-right: 10px; text-transform: uppercase;">{{ incident.type }}</span>
              <span style="color: var(--text-muted);">{{ incident.description }}</span>
            </div>
            <span style="font-size: 11px; color: var(--text-secondary);">{{ incident.timestamp }}</span>
          </div>
        </div>
      </div>
  </div>
</template>