import { ref, computed } from "vue"

// Reactive variables declaration
const battery = ref(100)
const batteryHistory = ref([])
// Retrieve usage time from the browser if it exists, otherwise 0
const usageTime = ref(parseInt(localStorage.getItem('polebot_usage_time')) || 0)
// Retrieve the session start date from the browser
const sessionStartTime = ref(localStorage.getItem('polebot_session_start') || null)

const lastSession = ref(null)



export function useBattery() {
    const dischargeRate = computed(() => {
        // If there are no data points, return 0
        if (batteryHistory.value.length < 2) return 0

        // The difference between the oldest and newest values
        const oldest = batteryHistory.value[0]
        const newest = batteryHistory.value[batteryHistory.value.length - 1]
        const elapsedSeconds = batteryHistory.value.length
        // since 1 value = 1 second

        // Calculation: (discharge / time in seconds) * 60 = %/min
        return ((oldest - newest) / elapsedSeconds) * 60
    })

    const estimatedAutonomy = computed(() => {
        const rate = dischargeRate.value
        // If the rate is 0, avoid division by 0
        if (rate <= 0) return "-"
        // Calculate in minutes
        const minutesLeft = battery.value / rate

        // Convert to hours and minutes
        const hours = Math.floor(minutesLeft / 60)
        const minutes = Math.floor(minutesLeft % 60)

        if (hours > 0) return `${hours}h ${minutes}m`
        return `${minutes} min`
    })

    // Formatting usage time (HH:MM:SS) for UI display
    const formattedUsageTime = computed(() => {
        const h = Math.floor(usageTime.value / 3600)
        const m = Math.floor((usageTime.value % 3600) / 60)
        const s = usageTime.value % 60
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    })

    function updateBattery(batteryLevel, isSimulated, linearSpeed, angularSpeed) {
        // MODE SIMULATION: Battery is artificially discharged (0.0093%/s when moving)
        // MODE REAL ROBOT: Battery level will come from ROS topic /battery_status (sensor_msgs/BatteryState)

        if (!sessionStartTime.value) {
            const now = new Date().toISOString()
            sessionStartTime.value = now
            localStorage.setItem('polebot_session_start', now)
            localStorage.setItem('polebot_usage_time', 0)
        }

        if (isSimulated) {
            // SIMULATION MODE: Calculate discharge rate programmatically
            if (linearSpeed !== 0 || angularSpeed !== 0) {
                battery.value = Math.max(0, battery.value - 0.0093)
            }
        } else {
            // REAL ROBOT MODE: Use raw telemetry battery level
            battery.value = parseFloat(batteryLevel)
        }

        // Register battery history (for discharge rate calculation)
        batteryHistory.value.push(battery.value)

        // Keep only the last 60 values (representing 1 minute of telemetry)
        if (batteryHistory.value.length > 60) {
            batteryHistory.value.shift() // Remove the oldest value
        }

        // Increment the time counter (+1 second per tick)
        usageTime.value++
        // Persist to localStorage to survive page reload
        localStorage.setItem('polebot_usage_time', usageTime.value)

    }

    // ----- DATA CLEANING ----- 
    // Functions to reset battery and usage metrics

    function resetUsageTime() {
        //Save last session info before clearing
        if (usageTime.value > 0 && sessionStartTime.value) {
            lastSession.value = {
                startTime: new Date(sessionStartTime.value).toLocaleString(),
                endTime: new Date().toLocaleString(),
                duration: usageTime.value,
                finalBattery: Math.round(battery.value)
            }
        }

        usageTime.value = 0
        localStorage.setItem('polebot_usage_time', 0)
        sessionStartTime.value = null
        localStorage.removeItem('polebot_session_start')
    }

    function resetBattery() {
        battery.value = 100
        batteryHistory.value = []

        // Persist start timestamp in localStorage to sync chart timeline
        localStorage.setItem('chartStartTime', new Date().toISOString())
    }

    return {
        battery,
        batteryHistory,
        usageTime,
        formattedUsageTime,
        dischargeRate,
        estimatedAutonomy,
        sessionStartTime,
        lastSession,
        updateBattery,
        resetBattery,
        resetUsageTime
    }
}
