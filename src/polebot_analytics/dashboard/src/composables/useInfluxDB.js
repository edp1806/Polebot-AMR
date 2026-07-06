import { ref } from 'vue'
import { InfluxDB, Point } from '@influxdata/influxdb-client'
import Chart from 'chart.js/auto'

// --- INFLUXDB CONFIGURATION ---
const hostIp = window.location.hostname || 'localhost'
const influxURL = `http://${hostIp}:8086`
const influxToken = 'O6KdiXqBpyFcH1PlGx2GkVWjaUz6ptHEdA7nAwZsGA-DtC_un7iuWinrxczOF79ss1cb5ItgvqLjjRyaKDNXLQ=='
const influxOrg = '2fb3ec77104ac02e'
const influxBucket = 'polebot_data'

export const influxDB = new InfluxDB({ url: influxURL, token: influxToken })
export const writeApi = influxDB.getWriteApi(influxOrg, influxBucket, 'ms')

// --- Singleton state ---
export const selectedRobotId = ref('polebot_01')
export const selectedTimeRange = ref('-5m')
export const expandedChart = ref(null)
export const showBatteryLine = ref(true)
export const showLinearSpeedLine = ref(true)
export const showAngularSpeedLine = ref(true)
export const showPosXLine = ref(true)
export const showPosYLine = ref(true)
export const averageCycleTime = ref('N/A')
export const cycleTimeHistory = ref([])
export const movementEfficiency = ref(0)
export const stabilityIndex = ref(100)
export const sessionHistory = ref([])

let batteryChartInstance = null
let speedChartInstance = null
let trajectoryChartInstance = null
let positionChartInstance = null
let expandedChartInstance = null
let chartDataCache = { labels: [], battery: [], linear: [], angular: [], trajectory: [], posX: [], posY: [] }
let analyticsRefreshInterval = null
let chartStartTime = localStorage.getItem('chartStartTime') ? new Date(localStorage.getItem('chartStartTime')) : null

// Plugin to force a white background (useful for PNG export)
const whiteBackgroundPlugin = {
  id: 'customCanvasBackgroundColor',
  beforeDraw: (chart) => {
    const ctx = chart.canvas.getContext('2d')
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, chart.width, chart.height)
    ctx.restore()
  }
}

export function useInfluxDB() {

  function fetchAndDrawChart() {
    const queryApi = influxDB.getQueryApi(influxOrg)

    // Calculate the absolute start time based on selectedTimeRange
    let startTimeObj = new Date()
    const range = selectedTimeRange.value
    if (range === '-5m') startTimeObj.setMinutes(startTimeObj.getMinutes() - 5)
    else if (range === '-30m') startTimeObj.setMinutes(startTimeObj.getMinutes() - 30)
    else if (range === '-1h') startTimeObj.setHours(startTimeObj.getHours() - 1)
    else if (range === '-4h') startTimeObj.setHours(startTimeObj.getHours() - 4)
    else if (range === '-24h') startTimeObj.setHours(startTimeObj.getHours() - 24)

    // If the user clicked "Reset", we ignore data from before the reset time!
    if (chartStartTime && chartStartTime > startTimeObj) {
      startTimeObj = chartStartTime
    }

    const startRange = startTimeObj.toISOString()

    const query = `
      from(bucket: "${influxBucket}")
        |> range(start: ${startRange})
        |> filter(fn: (r) => r._measurement == "telemetry")
        |> filter(fn: (r) => r.robot_id == "${selectedRobotId.value}")
        |> filter(fn: (r) => r._field != "estop_active")
        |> group(columns: ["_measurement", "robot_id", "_field"])
        |> aggregateWindow(every: 30s, fn: mean, createEmpty: true)
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> group()
        |> sort(columns: ["_time"])
    `

    const labels = []
    const batteryData = []
    const linearSpeedData = []
    const angularSpeedData = []
    const trajectoryData = []
    const posXData = []
    const posYData = []

    queryApi.queryRows(query, {
      next(row, tableMeta) {
        const o = tableMeta.toObject(row)
        const time = new Date(o._time).toLocaleTimeString()
        labels.push(time)
        batteryData.push(o.battery_level ?? null)
        linearSpeedData.push(o.linear_speed ?? null)
        angularSpeedData.push(o.angular_speed ?? null)
        if (o.position_x !== null && o.position_y !== null && o.position_x !== undefined) {
          trajectoryData.push({ x: o.position_x, y: o.position_y })
          posXData.push(o.position_x)
          posYData.push(o.position_y)
        } else {
          posXData.push(null)
          posYData.push(null)
        }
      },
      error(error) {
        console.error("Erreur de requête InfluxDB:", error)
      },
      complete() {
        chartDataCache = { labels, battery: batteryData, linear: linearSpeedData, angular: angularSpeedData, trajectory: trajectoryData, posX: posXData, posY: posYData }

        // --- CALCUL DES NOUVEAUX KPIs ---
        // --- CALCUL DU MOVEMENT EFFICIENCY ---
        // 1. Clean data to ignore "null" values (connection drops)
        const validLinear = linearSpeedData.filter(v => v !== null)
        // 2. Count how many times the robot was actually moving.
        // Consider moving if speed exceeds 0.02 m/s (ignore sensor noise when idle)
        const movingSamples = validLinear.filter(v => Math.abs(v) > 0.02).length
        // 3. Calculate efficiency percentage (Active time / Total time * 100)
        movementEfficiency.value = validLinear.length > 0 ? Math.round((movingSamples / validLinear.length) * 100) : 0


        let jerkCount = 0
        for (let i = 1; i < validLinear.length; i++) {
          if (Math.abs(validLinear[i] - validLinear[i - 1]) > 0.15) jerkCount++
        }
        stabilityIndex.value = Math.max(0, 100 - (jerkCount * 2)) // 2% penalty per jerk
        // --------------------------------

        const ctxBat = document.getElementById('batteryChart')
        if (ctxBat) {
          if (batteryChartInstance) batteryChartInstance.destroy()
          batteryChartInstance = new Chart(ctxBat, {
            type: 'line',
            data: { labels, datasets: [{ label: 'Battery (%)', data: batteryData, borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: 'rgba(59,130,246,0.1)' }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } },
            plugins: [whiteBackgroundPlugin]
          })
        }

        const ctxSpd = document.getElementById('speedChart')
        if (ctxSpd) {
          if (speedChartInstance) speedChartInstance.destroy()
          speedChartInstance = new Chart(ctxSpd, {
            type: 'line',
            data: {
              labels, datasets: [
                { label: 'V. Linear (m/s)', data: linearSpeedData, borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, hidden: !showLinearSpeedLine.value },
                { label: 'V. Angular (rad/s)', data: angularSpeedData, borderColor: '#eab308', borderWidth: 2, pointRadius: 0, hidden: !showAngularSpeedLine.value }
              ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } } },
            plugins: [whiteBackgroundPlugin]
          })
        }

        const ctxTraj = document.getElementById('trajectoryChart')
        if (ctxTraj && trajectoryData.length > 0) {
          if (trajectoryChartInstance) trajectoryChartInstance.destroy()
          trajectoryChartInstance = new Chart(ctxTraj, {
            type: 'scatter',
            data: { datasets: [{ label: 'Trajectoire', data: trajectoryData, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.3)', pointRadius: 2, showLine: true, borderWidth: 2, fill: false }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'X (m)', color: '#94a3b8' } }, y: { title: { display: true, text: 'Y (m)', color: '#94a3b8' } } } },
            plugins: [whiteBackgroundPlugin]
          })
        }

        const ctxPos = document.getElementById('positionChart')
        if (ctxPos && posXData.length > 0) {
          if (positionChartInstance) positionChartInstance.destroy()
          positionChartInstance = new Chart(ctxPos, {
            type: 'line',
            data: {
              labels, datasets: [
                { label: 'X (m)', data: posXData, borderColor: '#10b981', borderWidth: 2, pointRadius: 0, hidden: !showPosXLine.value },
                { label: 'Y (m)', data: posYData, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, hidden: !showPosYLine.value }
              ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } } },
            plugins: [whiteBackgroundPlugin]
          })
        }
      }
    })
  }

  function openAnalytics() {
    setTimeout(() => fetchAndDrawChart(), 200)

    if (analyticsRefreshInterval) clearInterval(analyticsRefreshInterval)
    analyticsRefreshInterval = setInterval(() => {
      // Refresh stopped if canvas disappears
      if (document.getElementById('batteryChartCanvas')) {
        fetchAndDrawChart()
      } else {
        clearInterval(analyticsRefreshInterval)
        analyticsRefreshInterval = null
      }
    }, 10000)
  }

  function drawExpandedChart(chartType) {
    const ctx = document.getElementById('expandedChartCanvas')
    if (!ctx) return
    if (expandedChartInstance) expandedChartInstance.destroy()

    const d = chartDataCache
    if (chartType === 'battery') {
      expandedChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: d.labels, datasets: [{ label: 'Battery (%)', data: d.battery, borderColor: '#3b82f6', borderWidth: 2, pointRadius: 1, fill: true, backgroundColor: 'rgba(59,130,246,0.1)' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } },
        plugins: [whiteBackgroundPlugin]
      })
    } else if (chartType === 'speed') {
      expandedChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: d.labels, datasets: [
            { label: 'V. Linear (m/s)', data: d.linear, borderColor: '#ef4444', borderWidth: 2, pointRadius: 1, hidden: !showLinearSpeedLine.value },
            { label: 'V. Angular (rad/s)', data: d.angular, borderColor: '#eab308', borderWidth: 2, pointRadius: 1, hidden: !showAngularSpeedLine.value }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false },
        plugins: [whiteBackgroundPlugin]
      })
    } else if (chartType === 'trajectory') {
      expandedChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: [{ label: 'Trajectoire', data: d.trajectory, borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.3)', pointRadius: 3, showLine: true, borderWidth: 2, fill: false }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: { title: { display: true, text: 'Position X (m)' } }, y: { title: { display: true, text: 'Position Y (m)' } } } },
        plugins: [whiteBackgroundPlugin]
      })
    } else if (chartType === 'position') {
      expandedChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: d.labels, datasets: [
            { label: 'X (m)', data: d.posX, borderColor: '#10b981', borderWidth: 2, pointRadius: 1, hidden: !showPosXLine.value },
            { label: 'Y (m)', data: d.posY, borderColor: '#f97316', borderWidth: 2, pointRadius: 1, hidden: !showPosYLine.value }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false },
        plugins: [whiteBackgroundPlugin]
      })
    }
  }

  function destroyExpandedChart() {
    if (expandedChartInstance) expandedChartInstance.destroy()
    expandedChartInstance = null
  }

  function updateSpeedChartVisibility() {
    if (speedChartInstance) {
      speedChartInstance.data.datasets[0].hidden = !showLinearSpeedLine.value
      speedChartInstance.data.datasets[1].hidden = !showAngularSpeedLine.value
      speedChartInstance.update()
    }
    if (expandedChart.value === 'speed' && expandedChartInstance) {
      expandedChartInstance.data.datasets[0].hidden = !showLinearSpeedLine.value
      expandedChartInstance.data.datasets[1].hidden = !showAngularSpeedLine.value
      expandedChartInstance.update()
    }
  }

  function updatePositionChartVisibility() {
    if (positionChartInstance) {
      positionChartInstance.data.datasets[0].hidden = !showPosXLine.value
      positionChartInstance.data.datasets[1].hidden = !showPosYLine.value
      positionChartInstance.update()
    }
    if (expandedChart.value === 'position' && expandedChartInstance) {
      expandedChartInstance.data.datasets[0].hidden = !showPosXLine.value
      expandedChartInstance.data.datasets[1].hidden = !showPosYLine.value
      expandedChartInstance.update()
    }
  }

  function changeTimeRange(range) {
    selectedTimeRange.value = range
    chartStartTime = null // Ignore previous Reset to see the past
    localStorage.removeItem('chartStartTime')
    fetchAndDrawChart()
  }

  function downloadChart() {
    const canvasId = expandedChart.value ? 'expandedChartCanvas' : 'batteryChart'
    const canvas = document.getElementById(canvasId)
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'Polebot_History.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  function resetChart(battery, addLog) {
    if (batteryChartInstance) batteryChartInstance.destroy()
    if (speedChartInstance) speedChartInstance.destroy()
    if (trajectoryChartInstance) trajectoryChartInstance.destroy()
    if (positionChartInstance) positionChartInstance.destroy()
    if (expandedChartInstance) expandedChartInstance.destroy()
    batteryChartInstance = speedChartInstance = trajectoryChartInstance = positionChartInstance = expandedChartInstance = null
    chartStartTime = new Date()
    localStorage.setItem('chartStartTime', chartStartTime.toISOString())
    battery.value = 100
    addLog('Charts reset!', 'info')

    const resetTimeLabel = chartStartTime.toLocaleTimeString()
    setTimeout(() => {
      const ctxBat = document.getElementById('batteryChart')
      if (ctxBat) {
        batteryChartInstance = new Chart(ctxBat, {
          type: 'line',
          data: { labels: [resetTimeLabel], datasets: [{ label: 'Battery (%)', data: [100], borderColor: '#3b82f6', borderWidth: 2, pointRadius: 4, fill: true, backgroundColor: 'rgba(59,130,246,0.1)' }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } },
          plugins: [whiteBackgroundPlugin]
        })
      }
    }, 50)
  }

  // --- REQUÊTE CYCLE TIME ---
  async function fetchCycleTimes() {
    if (!influxDB || !selectedRobotId.value) return
    const queryApi = influxDB.getQueryApi(influxOrg)

    // We fetch all cycle times in the current time range
    let startTimeObj = new Date()
    const range = selectedTimeRange.value
    if (range === '-5m') startTimeObj.setMinutes(startTimeObj.getMinutes() - 5)
    else if (range === '-30m') startTimeObj.setMinutes(startTimeObj.getMinutes() - 30)
    else if (range === '-1h') startTimeObj.setHours(startTimeObj.getHours() - 1)
    else if (range === '-4h') startTimeObj.setHours(startTimeObj.getHours() - 4)
    else if (range === '-24h') startTimeObj.setHours(startTimeObj.getHours() - 24)

    const startRange = startTimeObj.toISOString()

    const query = `
      from(bucket: "${influxBucket}")
        |> range(start: ${startRange})
        |> filter(fn: (r) => r._measurement == "mission_performance")
        |> filter(fn: (r) => r.robot == "${selectedRobotId.value}")
        |> filter(fn: (r) => r._field == "cycle_time_s")
        |> sort(columns: ["_time"])
    `

    const history = []
    let totalSecs = 0
    let count = 0

    try {
      await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
          next(row, tableMeta) {
            const o = tableMeta.toObject(row)
            history.push({ time: new Date(o._time).toLocaleTimeString(), value: o._value })
            totalSecs += o._value
            count++
          },
          error(error) {
            reject(error)
          },
          complete() {
            resolve()
          }
        })
      })

      cycleTimeHistory.value = history
      if (count > 0) {
        const avg = Math.round(totalSecs / count)
        const m = String(Math.floor(avg / 60)).padStart(2, '0')
        const s = String(avg % 60).padStart(2, '0')
        averageCycleTime.value = `${m}:${s}`
      } else {
        averageCycleTime.value = 'N/A'
      }
    } catch (e) {
      console.error("Erreur InfluxDB Cycle Time:", e)
    }
  }

  function saveSessionToInflux(durationSeconds, startTimeISO) {
    if (!writeApi) return

    // Create a new measurement named "robot_session"
    const point = new Point('robot_session')
      .tag('robot_id', selectedRobotId.value)
      .stringField('start_time', startTimeISO)
      .intField('duration_s', durationSeconds);

    writeApi.writePoint(point);

    // Call ".flush()" to force immediate dispatch to InfluxDB server
    writeApi.flush().then(() => {
      console.log("⌚ Session saved in InfluxDB:", durationSeconds, "seconds");
    }).catch(err => { console.error("Error during session write to InfluxDB:", err); });
  }

  async function fetchRobotSessions() {
    if (!influxDB || !selectedRobotId.value) return
    const queryApi = influxDB.getQueryApi(influxOrg)

    // Compute the first day of the current month at midnight UTC
    const now = new Date()
    const firstDayOfMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
    const startOfMonth = firstDayOfMonth.toISOString()

    // Query sessions for the current month only
    const query = `
      from(bucket: "${influxBucket}")
        |> range(start: ${startOfMonth})
        |> filter(fn: (r) => r._measurement == "robot_session")
        |> filter(fn: (r) => r.robot_id == "${selectedRobotId.value}")
        // Pivot merges the duration and start_time fields into a single record
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
        |> sort(columns: ["_time"], desc: true)
    `

    const history = []

    try {
      await new Promise((resolve, reject) => {
        queryApi.queryRows(query, {
          next(row, tableMeta) {
            const o = tableMeta.toObject(row)
            // Append formatted session record to temp list
            history.push({
              endTime: new Date(o._time).toLocaleString(),
              startTime: o.start_time ? new Date(o.start_time).toLocaleString() : 'Inconnu',
              duration: o.duration_s ?? 0
            })
          },
          error(error) {
            reject(error)
          },
          complete() {
            resolve()
          }
        })
      })

      // Update reactively binded global state
      sessionHistory.value = history
      console.log("⌚ Session history loaded:", history.length, "sessions found.")
    } catch (e) {
      console.error("InfluxDB query error during session history load:", e)
    }
  }


  return {
    // State
    selectedRobotId,
    selectedTimeRange,
    expandedChart,
    showBatteryLine,
    showLinearSpeedLine,
    showAngularSpeedLine,
    showPosXLine,
    showPosYLine,
    averageCycleTime,
    cycleTimeHistory,
    movementEfficiency,
    stabilityIndex,
    sessionHistory,
    // Functions
    fetchAndDrawChart,
    openAnalytics,
    drawExpandedChart,
    destroyExpandedChart,
    updateSpeedChartVisibility,
    updatePositionChartVisibility,
    changeTimeRange,
    downloadChart,
    resetChart,
    fetchCycleTimes,
    saveSessionToInflux,
    fetchRobotSessions,
    // InfluxDB instances (pour App.vue setInterval)
    influxDB,
    writeApi
  }
}
