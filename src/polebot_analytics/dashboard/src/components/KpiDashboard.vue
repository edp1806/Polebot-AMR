<script setup>

import { useBattery } from '../composables/useBattery.js'
import { useInfluxDB } from '../composables/useInfluxDB.js'
import { onMounted, ref, computed} from 'vue'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const { battery, dischargeRate, estimatedAutonomy, formattedUsageTime, lastSession } = useBattery()
const { averageCycleTime, cycleTimeHistory, fetchCycleTimes, movementEfficiency, stabilityIndex, sessionHistory, fetchRobotSessions, changeTimeRange } = useInfluxDB()

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

// Export filtered sessions as a downloadable CSV file
function exportCSV() {
    const header = 'Start Time, End Time, Duration \n'
    const rows = filteredSessions.value.map(s => 
        `"${s.startTime}", "${s.endTime}", ${s.duration}`
    ).join('\n')

    const blob = new Blob([header + rows], { type: 'text/csv'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `polebot_sessions_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
}

//Generate a professional PDF report with KPI summary and session table
async function exportPDF(){
    const doc = new jsPDF()

    // --- Header ---
    doc.setFontSize(20)
    doc.setTextColor(30, 41, 59)
    doc.text('Polebot AMR - Performance Report', 14, 22)

    doc.setFontSize(10)
    doc.setTextColor(100, 116, 139)
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30)

    // --- KPI SUmmary ---
    doc.setFontSize(14)
    doc.setTextColor(30,41,59)
    doc.text('KPI Summary', 14, 45)

    autoTable(doc, {
        startY: 50,
        head: [['Metric', 'Value']],
        body: [
            ['Battery Level', `${Math.round(battery.value)}%`],
            ['Discharge Rate', `${dischargeRate.value.toFixed(2)}%/min`],
            ['Estimated Autonomy', `${estimatedAutonomy.value}`],
            ['Usage Time', `${formattedUsageTime.value}`],
            ['Average Cycle Time', `${averageCycleTime.value}`],
            ['Movement Efficiency', `${movementEfficiency.value}%`],
            ['Stability Index', `${stabilityIndex.value}%`],
        ],
        theme: 'grid',
        headStyles: {fillColor: [59, 130, 246,]}
    })

    // --- Session History Table ---
    doc.setFontSize(14)
    doc.text('Connection Sessions History', 14, doc.lastAutoTable.finalY + 15)
    autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 20,
        head: [['Start Time', 'End Time', 'Duration']],
        body: filteredSessions.value.map(s => [
            s.startTime,
            s.endTime,
            formatDuration(s.duration)
        ]),
        theme: 'striped',
        headStyles: {fillColor: [59, 130, 246]},
    })

    // --- CHArts Section ---
    // Temporarily reveal the hidden Analytics tab so canvases can render
    const batteryCanvas = document.getElementById('batteryChart')
    let hiddenParent = null
    if(batteryCanvas){
        let el = batteryCanvas.parentElement
        while(el){
            if(el.style.display === 'none'){
                hiddenParent = el
                break
            }
            el = el.parentElement
        }
    }
    if(hiddenParent) hiddenParent.style.display = ''

    // Force 1h range and wait for chart.js to redraw
    changeTimeRange('-1h')
    await new Promise(resolve => setTimeout(resolve, 1000))

    doc.addPage()
    doc.setFontSize(16)
    doc.setTextColor(30, 41, 59)
    doc.text('Charts - Last Hour', 14, 20)

    const chartIds = ['batteryChart', 'speedChart', 'trajectoryChart', 'positionChart']
    const chartNames = ['Battery Level', 'Speed (Linear & Angular)','Trajectory (X/Y)', 'Position over Time']
    let yPosition = 30

    chartIds.forEach((id, i) => {
        const canvas = document.getElementById(id)
        if(canvas && canvas.width > 0 && canvas.height > 0){
            doc.setFontSize(11)
            doc.setTextColor(100, 116, 139)
            doc.text(chartNames[i], 14, yPosition)
            yPosition += 3

            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = canvas.width
            tempCanvas.height = canvas.height
            const tempCtx = tempCanvas.getContext('2d')
            tempCtx.fillStyle = '#ffffff'
            tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height)
            tempCtx.drawImage(canvas, 0, 0)

            const imgData = tempCanvas.toDataURL('image/jpeg', 1.0)
            doc.addImage(imgData, 'JPEG', 14, yPosition, 180, 50)
            yPosition += 58

            if(yPosition > 240 && i < chartIds.length - 1) {
                doc.addPage()
                yPosition = 20
            }
        }
    })

    // Restore hidden State
    if(hiddenParent) hiddenParent.style.display = 'none'

    // --- Save PDF ---
    doc.save(`polebot_report_${new Date().toISOString().slice(0, 10)}.pdf`)    
}

onMounted(() => {
  fetchRobotSessions()
  fetchCycleTimes()
  setInterval(fetchCycleTimes, 5000) 
})
</script>

<template>
    <div style="padding: 20px; overflow-y: auto; height: calc(100vh - 65px); box-sizing: border-box;">
        <h2>📊 Performance Indicators (KPI)</h2>
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button @click="exportCSV" style="border: 1px solid #cbd5e1; background: white; color: #1e293b; padding:
            8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
            onmouseover="this.style.background='#f1f5f9'"
            onmouseout="this.style.background='white'">
            📥 Export CSV
        </button>
        <button @click="exportPDF" style="border: 1px solid #cbd5e1; background: white; color: #1e293b; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'">
            📋 Export PDF
        </button>
        </div>
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

        <!-- LAST SESSION SUMMARY -->
        <div v-if="lastSession" style="margin-top: 20px; background: linear-gradient(135deg, #eff6ff, #f0fdf4); border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px 25px;">
            <h3 style="margin: 0 0 15px 0; color: #1e40af;">📋 Last Session Summary</h3>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;">
                <div style="text-align: center;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Start Time</div>
                    <div style="font-size: 14px; font-weight: 700; color: #1e293b; margin-top: 4px;">{{ lastSession.startTime }}</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">End Time</div>
                    <div style="font-size: 14px; font-weight: 700; color: #1e293b; margin-top: 4px;">{{ lastSession.endTime }}</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Duration</div>
                    <div style="font-size: 14px; font-weight: 700; color: #1e40af; margin-top: 4px;">{{ formatDuration(lastSession.duration) }}</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-size: 11px; color: #64748b; text-transform: uppercase; font-weight: 600;">Final Battery</div>
                    <div style="font-size: 14px; font-weight: 700; color: #10b981; margin-top: 4px;">{{ lastSession.finalBattery }}%</div>
                </div>
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

        <!-- SESSION HISTORY SECTION (TABLE) -->
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
    background-color: #ffffff; /* White background */
    border: 1px solid #e2e8f0;   /* Light gray border */
    border-radius: 8px;          /* Rounded corners */
    padding: 20px 25px;          /* Inner spacing */
    display: flex;               /* Enable Flexbox */
    flex-direction: column;      /* Stack elements vertically */
    justify-content: center;     /* Center vertically */
    align-items: center;         /* Center horizontally */
    transition: transform 0.2s, box-shadow 0.2s; /* Smooth hover effect */
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); /* Light shadow */
    cursor: pointer;
}

/* Hover effect */
.kpi-card:hover {
    transform: translateY(-4px); /* Moves up slightly */
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); /* Stronger shadow */
}

/* Style for label (Current Level, etc.) */
.kpi-label {
    font-size: 0.85rem;          /* Slightly smaller font size */
    font-weight: 600;            /* Bold font */
    color: #64748b;              /* Dark gray color */
    margin-bottom: 8px;          /* Margin bottom */
    text-transform: uppercase;   /* Uppercase text */
    letter-spacing: 0.5px;       /* Letter spacing */
}

/* Style for value (100%, 50%, etc.) */
.kpi-value {
    font-size: 2.25rem;          /* Large font size */
    font-weight: 700;            /* Bold font */
    color: #1e293b;              /* Very dark gray/black color */
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; /* Modern font */
}

/* Margin between cards (on the sides only, to keep it aligned) */
.kpi-card:not(:last-child) {
    margin-right: 15px;
}

.table-row-hover:hover {
  background: rgba(59, 130, 246, 0.05); /* Light blue halo on hover */
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
