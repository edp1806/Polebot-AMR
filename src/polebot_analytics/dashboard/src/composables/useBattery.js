import { ref, computed } from "vue"

//Déclaration des variables réactives
const battery = ref(100)
const batteryHistory = ref([])
const usageTime = ref(0)

export function useBattery() {
    const dischargeRate = computed(() => {
        // S'il n'y a pas de données, on retourne 0
        if (batteryHistory.value.length < 2) return 0

        //La différence entre la plus ancienne et la plus récente valeur
        const oldest = batteryHistory.value[0]
        const newest = batteryHistory.value[batteryHistory.value.length - 1]
        const elapsedSeconds = batteryHistory.value.length
        // car 1 valeur = 1 seconde

        //Calcul : (perte / temps en secondes) * 60 = %/min
        return ((oldest - newest) / elapsedSeconds) * 60
    })

    const estimatedAutonomy = computed(() => {
        const rate = dischargeRate.value
        // Si le taux est 0, on évite la division par 0
        if (rate <= 0) return "-"
        // On calcule en minutes
        const minutesLeft = battery.value / rate

        // Conversion en heures et minutes
        const hours = Math.floor(minutesLeft / 60)
        const minutes = Math.floor(minutesLeft % 60)

        if (hours > 0) return `${hours}h ${minutes}m`
        return `${minutes} min`
    })

    // Formatage du temps d'utilisation (HH:MM:SS) pour l'affichage UI
    const formattedUsageTime = computed(() => {
        const h = Math.floor(usageTime.value / 3600)
        const m = Math.floor((usageTime.value % 3600) / 60)
        const s = usageTime.value % 60
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    })

    function updateBattery(batteryLevel, isSimulated, linearSpeed, angularSpeed) {
        // MODE SIMULATION: Battery is artificially discharged (0.0093%/s when moving)
        // MODE REAL ROBOT: Battery level will come from ROS topic /battery_status (sensor_msgs/BatteryState)

        if (isSimulated) {
            // MODE SIMULATION: On calcule la décharge nous-mêmes
            if (linearSpeed !== 0 || angularSpeed !== 0) {
                battery.value = Math.max(0, battery.value - 1)
            }
        } else {
            // MODE ROBOT RÉEL: On utilise la donnée brute de la batterie
            battery.value = parseFloat(batteryLevel)
        }

        // Enregistrer l'historique (pour le calcul du taux de décharge)
        batteryHistory.value.push(battery.value)

        // Limiter la taille de l'historique (garder les 60 dernières valeurs = 1 minute)
        if (batteryHistory.value.length > 60) {
            batteryHistory.value.shift() // Retire la plus ancienne valeur
        }

        // Incrémenter le compteur de temps (+1 seconde par appel)
        usageTime.value++

    }

    // ----- DATA CLEANING ----- 
    // Fonction pour réinitialiser l'historique et le temps
    function resetBattery() {
        battery.value = 100
        batteryHistory.value = []
        usageTime.value = 0

        // On sauvegarde aussi dans le localStorage pour que le compteur reste à 0 après un rafraîchissement
        localStorage.setItem('chartStartTime', new Date().toISOString())
    }

    return {
        battery,
        batteryHistory,
        usageTime,
        formattedUsageTime,
        dischargeRate,
        estimatedAutonomy,
        updateBattery,
        resetBattery
    }
}
