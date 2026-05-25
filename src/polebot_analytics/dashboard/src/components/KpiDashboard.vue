<script setup>

import { useBattery } from '../composables/useBattery.js'
import { useInfluxDB } from '../composables/useInfluxDB.js'
import { onMounted, ref, computed} from 'vue'

const { battery, dischargeRate, estimatedAutonomy, formattedUsageTime } = useBattery()
const { averageCycleTime, cycleTimeHistory, fetchCycleTimes, movementEfficiency, stabilityIndex, sessionHistory, fetchRobotSessions } = useInfluxDB()

// Utility function to format duration (converts seconds to h m s)
function formatDuration(seconds) {
  if (!seconds) return '0s'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  
  let result = ''
  if (h > 0) result += `${h}h `
  if (m > 0) result += `${m}m `
  if (s > 0 || result === '') result += `${s}s`
  return result
}

// Reactive variables to store values chosen by the user
const FilterDate = ref('') // Will store "YYYY-MM-DD" chosen via the calendar
const filterMinDuration = ref(0) // Reactive variable containing the minimum number of seconds (0 = no filter)

const filteredSessions = computed(() => {
    return sessionHistory.value.filter(session => {
        // 1. Filter by Date (robust and independent of system locale)
        let dateMatch = true
        if (FilterDate.value) {
            const d = new Date(session.startTime)
            if (!isNaN(d.getTime())) { // Check if the date is valid
                const year = d.getFullYear()
                const month = String(d.getMonth() + 1).padStart(2, '0') // Pad month with zero if needed (e.g. "05")
                const day = String(d.getDate()).padStart(2, '0')        // Pad day with zero if needed (e.g. "25")
                
                const sessionDateString = `${year}-${month}-${day}` // Exact format "YYYY-MM-DD"
                
                // Compare directly with calendar chosen value
                dateMatch = (sessionDateString === FilterDate.value)
            } else {
                dateMatch = false
            }
        }
        // 2. Filter by Minimum Duration
        let durationMatch = true
        if (filterMinDuration.value > 0) {
            durationMatch = session.duration >= filterMinDuration.value
        }
        
        // The session must satisfy both filters
        return dateMatch && durationMatch
    })
})

onMounted(() => {
  fetchRobotSessions()
  fetchCycleTimes()
  setInterval(fetchCycleTimes, 5000) 
})
</script>

<template>
    <div style="padding: 20px; overflow-y: auto; height: calc(100vh - 65px); box-sizing: border-box;">
        <h2>📊 Performance Indicators (KPI)</h2>
        <!-- Section BATTERY -->
        <h3>🔋 Battery Usage</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;">
      
            <!-- Card 1: Current level -->
            <div class="kpi-card">
                <div class="kpi-label">Current Level</div>
                <div class="kpi-value">{{ Math.round(battery) }}%</div>
            </div>
            <!-- Card 2: Discharge rate -->
            <div class="kpi-card">
                <div class="kpi-label">Discharge Rate</div>
                <div class="kpi-value">{{ dischargeRate.toFixed(2) }} %/min</div>
            </div>
            <!-- Card 3: Estimated autonomy -->
            <div class="kpi-card">
                <div class="kpi-label">Estimated Autonomy</div>
                <div class="kpi-value">{{ estimatedAutonomy }}</div>
            </div>
            <!-- Card 4: Usage time -->
            <div class="kpi-card">
                <div class="kpi-label">Usage Time</div>
                <div class="kpi-value">{{ formattedUsageTime }}</div>
            </div>
        </div>
        
        <!-- CYCLE TIME SECTION -->
        <h3 style="margin-top: 30px;">⏱️ Mission Performance</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; align-items: start;">
            <!-- KPI Card -->
            <div class="kpi-card" style="border-left: 4px solid var(--accent-green);">
                <div class="kpi-label">Average Cycle Time</div>
                <div class="kpi-value" style="color: var(--accent-green);">{{ averageCycleTime }}</div>
            </div>

            <!-- History of the last 10 missions -->
            <div class="kpi-card" style="grid-column: span 3; display: block;">
                <div class="kpi-label" style="margin-bottom: 10px;">Recent missions (sec)</div>
                <div v-if="cycleTimeHistory.length === 0" style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 10px;">
                    No missions recorded
                </div>
                <div v-else style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 5px;">
                    <div v-for="(item, index) in cycleTimeHistory.slice().reverse().slice(0, 10)" :key="index" style="background: var(--bg-secondary); padding: 8px 12px; border-radius: 6px; min-width: 80px; text-align: center; border: 1px solid var(--border-color);">
                        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 4px;">{{ item.time }}</div>
                        <div style="font-weight: bold; font-size: 14px; color: var(--text-primary);">{{ item.value }} s</div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- MOVEMENT EFFICIENCY & STABILITY SECTION -->
        <h3 style="margin-top: 30px;">⚙️ Operational Metrics</h3>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;">
            <div class="kpi-card" style="border-left: 4px solid var(--accent-blue);">
                <div class="kpi-label" style="text-align:center;">Movement Efficiency<br><span style="font-size:10px; color:var(--text-muted);">(% Active Time)</span></div>
                <div class="kpi-value" style="color: var(--accent-blue);">{{ movementEfficiency }}%</div>
            </div>
            <div class="kpi-card" style="border-left: 4px solid var(--accent-yellow);">
                <div class="kpi-label" style="text-align:center;">Stability Index<br><span style="font-size:10px; color:var(--text-muted);">(Smoothness)</span></div>
                <div class="kpi-value" style="color: var(--accent-yellow);">{{ stabilityIndex }}%</div>
            </div>
        </div>

        <!-- Section HISTORIQUE DES SESSIONS (TABLEAU) -->
        <h3 style="margin-top: 30px;">🕒 Connection Sessions History</h3>
        
        <div style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px 25px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); margin-top: 15px;">
            <div style="font-size: 11px; color: #64748b; margin-bottom: 15px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">
                Last 30 Days History
            </div>
            <!-- Interactive filters bar -->
            <div style="display: flex; gap: 20px; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 15px; margin-bottom: 15px;">
                <!-- Filter 1: Date selection -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 12px; font-weight: 600; color: #64748b;">📅 Filter by date:</span>
                    <input 
                        type="date" 
                        v-model="FilterDate" 
                        style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 8px; font-size: 12px; color: #1e293b; background: white;"
                    />
                    <!-- Button to quickly clear date filter -->
                    <button 
                        v-if="FilterDate" 
                        @click="FilterDate = ''" 
                        style="border: none; background: transparent; color: #ef4444; cursor: pointer; font-size: 11px; font-weight: bold;"
                    >
                        Clear
                    </button>
                </div>

                <!-- Vertical separator -->
                <div style="width: 1px; height: 20px; background: #e2e8f0;"></div>

                <!-- Filter 2: Custom duration -->
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 12px; font-weight: 600; color: #64748b;">⏳ Min duration (sec):</span>
                        <input
                            type="number" 
                            v-model.number="filterMinDuration" 
                            min="0"
                            style="border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 8px; font-size: 12px; color: #1e293b; background: white; width: 80px;"
                            placeholder="Ex: 30"
                        />
                        <!-- Button to quickly reset to 0 -->
                        <button 
                            v-if="filterMinDuration > 0" 
                            @click="filterMinDuration = 0" 
                            style="border: none; background: transparent; color: #ef4444; cursor: pointer; font-size: 11px; font-weight: bold;"
                        >
                            Reset
                        </button>
                    </div>
            </div>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; color: #1e293b;">
                    <thead>
                        <tr style="border-bottom: 2px solid #e2e8f0; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">
                            <th style="padding: 10px 12px; font-weight: 700;">🛫 Start Date & Time</th>
                            <th style="padding: 10px 12px; font-weight: 700;">⏹ End Date & Time</th>
                            <th style="padding: 10px 12px; font-weight: 700; text-align: right;">⏳ Active Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- If no sessions are registered -->
                        <tr v-if="sessionHistory.length === 0">
                            <td colspan="3" style="padding: 20px; text-align: center; color: #64748b; font-style: italic;">
                                No connection sessions recorded yet.
                            </td>
                        </tr>
                        <!-- Dynamic display loop -->
                        <tr 
                            v-for="(session, index) in filteredSessions" 
                            :key="index" 
                            style="border-bottom: 1px solid #f1f5f9;"
                            class="table-row-hover"
                        >
                            <td style="padding: 12px; font-weight: 500; color: #0f172a;">{{ session.startTime }}</td>
                            <td style="padding: 12px; color: #475569;">{{ session.endTime }}</td>
                            <td style="padding: 12px; text-align: right; font-weight: 700; color: var(--accent-blue);">
                                {{ formatDuration(session.duration) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>

<style scoped>
.kpi-card {
    background-color: #ffffff; /* Arrière-plan blanc */
    border: 1px solid #e2e8f0;   /* Bordure gris clair */
    border-radius: 8px;          /* Coins arrondis */
    padding: 20px 25px;          /* Espacement intérieur */
    display: flex;               /* Activer Flexbox */
    flex-direction: column;      /* Empiler les éléments verticalement */
    justify-content: center;     /* Centrer verticalement */
    align-items: center;         /* Centrer horizontalement */
    transition: transform 0.2s, box-shadow 0.2s; /* Effet de survol doux */
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); /* Ombre légère */
    cursor: pointer;
}

/* Effet de survol (hover) */
.kpi-card:hover {
    transform: translateY(-4px); /* Remonte légèrement */
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); /* Ombre plus prononcée */
}

/* Style pour le libellé (Current Level, etc.) */
.kpi-label {
    font-size: 0.85rem;          /* Taille de police légèrement plus petite */
    font-weight: 600;            /* Police en gras */
    color: #64748b;              /* Couleur gris foncé */
    margin-bottom: 8px;          /* Marge en dessous */
    text-transform: uppercase;   /* Texte en majuscules */
    letter-spacing: 0.5px;       /* Espacement des lettres */
}

/* Style pour la valeur (100%, 50%, etc.) */
.kpi-value {
    font-size: 2.25rem;          /* Grande taille de police */
    font-weight: 700;            /* Police en gras */
    color: #1e293b;              /* Couleur noir/gris très foncé */
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; /* Police moderne */
}

/* Marge entre les cartes (sur les côtés seulement, pour que ça reste aligné) */
.kpi-card:not(:last-child) {
    margin-right: 15px;
}

.table-row-hover:hover {
  background: rgba(59, 130, 246, 0.05); /* Léger halo bleu au survol */
  transition: background 0.2s ease;
}

h2 {
    color: #1e293b;
    font-size: 1.5rem;
}
h3 {
    color: #334155;
    font-size: 1.1rem;
    margin-top: 20px;
    margin-bottom: 10px;
}
</style>
