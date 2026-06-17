<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const distanceTraveled = ref(124.5) // simulated km
const motorHealth = ref(85)
const wheelHealth = ref(60)
const lidarHealth = ref(92)

let simInterval = null

onMounted(() => {
  simInterval = setInterval(() => {
    distanceTraveled.value += (Math.random() * 0.05)
    
    // Gradual wear
    if (Math.random() > 0.8) motorHealth.value = Math.max(0, motorHealth.value - 0.1)
    if (Math.random() > 0.7) wheelHealth.value = Math.max(0, wheelHealth.value - 0.2)
  }, 3000)
})

onUnmounted(() => {
  if (simInterval) clearInterval(simInterval)
})

const getHealthColor = (health) => {
  if (health > 75) return 'var(--accent-green)'
  if (health > 40) return 'var(--accent-yellow)'
  return 'var(--accent-red)'
}
</script>

<template>
  <div class="maintenance-container" style="padding: 25px; overflow-y: auto; height: 100%;"> 
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
      <div class="card" style="display: flex; align-items: center; justify-content: space-between; padding: 20px;">
        <div>
          <h3 style="margin: 0; font-size: 13px; color: var(--text-muted); text-transform: uppercase;">Total Distance Traveled</h3>
          <span style="font-size: 28px; font-weight: 700; color: var(--accent-blue);">{{ distanceTraveled.toFixed(2) }} km</span>
        </div>
        <div style="font-size: 32px; opacity: 0.8;">📏</div>
      </div>
      
      <div class="card" style="display: flex; align-items: center; justify-content: space-between; padding: 20px;">
        <div>
          <h3 style="margin: 0; font-size: 13px; color: var(--text-muted); text-transform: uppercase;">Next Service Due</h3>
          <span style="font-size: 28px; font-weight: 700; color: var(--text-primary);">In 25.5 km</span>
        </div>
        <div style="font-size: 32px; opacity: 0.8;">📅</div>
      </div>
    </div>

    <h3 style="color: black; margin-bottom: 15px; font-size: 15px;">Component Health Status</h3>
    
    <div style="display: flex; flex-direction: column; gap: 15px;">
      <!-- Motors -->
      <div class="card" style="padding: 15px 20px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-weight: 600; color: var(--text-primary);">⚙️ Drive Motors</span>
          <span :style="{ color: getHealthColor(motorHealth), fontWeight: 'bold' }">{{ motorHealth.toFixed(1) }}%</span>
        </div>
        <div style="width: 100%; height: 10px; background: var(--bg-secondary); border-radius: 5px; overflow: hidden;">
          <div :style="{ width: motorHealth + '%', background: getHealthColor(motorHealth), height: '100%', transition: 'width 0.3s' }"></div>
        </div>
        <div v-if="motorHealth < 75" style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">
          ℹ️ Minor vibrations detected in left motor. Lubrication recommended.
        </div>
      </div>

      <!-- Wheels -->
      <div class="card" style="padding: 15px 20px; border-left: 4px solid var(--accent-yellow);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-weight: 600; color: var(--text-primary);">🛞 Mecanum Wheels</span>
          <span :style="{ color: getHealthColor(wheelHealth), fontWeight: 'bold' }">{{ wheelHealth.toFixed(1) }}%</span>
        </div>
        <div style="width: 100%; height: 10px; background: var(--bg-secondary); border-radius: 5px; overflow: hidden;">
          <div :style="{ width: wheelHealth + '%', background: getHealthColor(wheelHealth), height: '100%', transition: 'width 0.3s' }"></div>
        </div>
        <div style="margin-top: 8px; font-size: 11px; color: var(--accent-yellow); font-weight: 600;">
          ⚠️ Significant wear on front-right rollers. Replacement suggested within 14 days.
        </div>
      </div>

      <!-- Lidar -->
      <div class="card" style="padding: 15px 20px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-weight: 600; color: var(--text-primary);">🔴 2D Lidar Scanner</span>
          <span :style="{ color: getHealthColor(lidarHealth), fontWeight: 'bold' }">{{ lidarHealth.toFixed(1) }}%</span>
        </div>
        <div style="width: 100%; height: 10px; background: var(--bg-secondary); border-radius: 5px; overflow: hidden;">
          <div :style="{ width: lidarHealth + '%', background: getHealthColor(lidarHealth), height: '100%', transition: 'width 0.3s' }"></div>
        </div>
        <div style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">
          ✅ Lens is clean. Motor operating at optimal RPM.
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
</style>
