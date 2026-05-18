<script setup>
import { ref, computed, watch } from 'vue'
import * as ROSLIB from 'roslib'
import { InfluxDB, Point } from '@influxdata/influxdb-client'
import Chart from 'chart.js/auto'

// --- INFLUXDB CONFIGURATION ---
const hostIp = window.location.hostname || 'localhost'
const influxURL = `http://${hostIp}:8086`
const influxToken = 'O6KdiXqBpyFcH1PlGx2GkVWjaUz6ptHEdA7nAwZsGA-DtC_un7iuWinrxczOF79ss1cb5ItgvqLjjRyaKDNXLQ=='
const influxOrg = '2fb3ec77104ac02e' // Using the exact ID of your organization
const influxBucket = 'polebot_data'

const influxDB = new InfluxDB({ url: influxURL, token: influxToken })
const writeApi = influxDB.getWriteApi(influxOrg, influxBucket, 'ms') // ms = Millisecond precision


// Reactive variables (if they change, the UI updates)
const wsUrl = ref(`ws://${hostIp}:9090`)
const connected = ref(false)
const connecting = ref(false)
const mapCanvas = ref(null)
const mapInfo = ref('Waiting for map...')
const battery = ref(100) // Battery a 100% au départ
const maxLinearSpeed = ref(0.5)  // Linear speed (m/s)
const maxAngularSpeed = ref(0.5) // Angular speed (rad/s)
const isEStopActive = ref(false) // Emergency stop button state
const logs = ref([]) // empty array at startup
const showLidar = ref(true) // LiDAR display control
const mapZoom = ref(1) // 1 = 100%, 0.5 = 50% (zoom out), 2 = 200% (zoom in)
const activeTab = ref('control') // Variable to know which tab is open
const selectedRobotId = ref('polebot_01') // Fleet robot selector
const showBatteryLine = ref(true)
const showLinearSpeedLine = ref(true)
const showAngularSpeedLine = ref(true)
const showPosXLine = ref(true)
const showPosYLine = ref(true)
const expandedChart = ref(null)  // null, 'battery', 'speed', 'trajectory', 'position'
let batteryChartInstance = null
let speedChartInstance = null
let trajectoryChartInstance = null
let positionChartInstance = null
let expandedChartInstance = null
// Shared data for the expanded modal
let chartDataCache = { labels: [], battery: [], linear: [], angular: [], trajectory: [], posX: [], posY: [] }
let mapCtx = null
let ros = null // The object that will manage the connection
let cmdVelTopic = null
let velInterval = null
let connectTimeout = null // Added to prevent error in disconnectRos
let mapData = null
let mapImageData = null
let currentScan = null
// Retrieve the last reset time from localStorage (survives refresh)
let chartStartTime = localStorage.getItem('chartStartTime') ? new Date(localStorage.getItem('chartStartTime')) : null

// ---- EXPERT SOLUTION: Web Worker for the Map ----
// Create a dynamic Worker to calculate the map image in the background (without blocking the UI)
const mapWorkerCode = `
self.onmessage = function(e) {
  const { data, width, height } = e.data;
  const pixelData = new Uint8ClampedArray(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width) + x;
      const value = data[index];
      const pixelIndex = ((height - 1 - y) * width + x) * 4;
      
      if (value === -1) { // Unknown (Dark gray)
        pixelData[pixelIndex] = 15; pixelData[pixelIndex+1] = 22; pixelData[pixelIndex+2] = 41; pixelData[pixelIndex+3] = 255;
      } else if (value === 0) { // Empty (Gris très clair)
        pixelData[pixelIndex] = 220; pixelData[pixelIndex+1] = 220; pixelData[pixelIndex+2] = 225; pixelData[pixelIndex+3] = 255;
      } else { // Wall / Obstacle (Bright red)
        pixelData[pixelIndex] = 239; pixelData[pixelIndex+1] = 68; pixelData[pixelIndex+2] = 68; pixelData[pixelIndex+3] = 255;
      }
    }
  }
  
  // Send the calculated array back to the main thread
  self.postMessage({ pixelData, width, height }, [pixelData.buffer]);
}
`;
const mapWorkerBlob = new Blob([mapWorkerCode], { type: 'application/javascript' });
const mapWorker = new Worker(URL.createObjectURL(mapWorkerBlob));

mapWorker.onmessage = function(e) {
  const { pixelData, width, height } = e.data;
  mapImageData = new ImageData(pixelData, width, height);
};

// Reactive variable for the robot position
const odom = ref({
  x: '0.00',
  y: '0.00',
  yaw: '0.00',
  linear_speed: '0.00',
  angular_speed: '0.00'
})

// ----- Battery et Data Historian -----

setInterval(() => {
  if (!connected.value) return

  // 1. SIMULATED BATTERY DISCHARGE
  // Calculation: 100% / 10800 seconds (3h) ≈ 0.0093% per second
  if (parseFloat(odom.value.linear_speed) !== 0 || parseFloat(odom.value.angular_speed) !== 0) {
    battery.value = Math.max(0, battery.value - 0.0093)
  }

  // 2. SAFETY SHIELD
  // ⚠️ ROS2 ARCHITECTURE NOTICE:
  // Managing safety from the web Dashboard is dangerous (risk of Wi-Fi loss or browser crash).
  // In a real system, this "shield" logic (blocking cmd_vel) must be implemented 
  // in an embedded ROS2 node (C++ or Python) directly on the robot.
  if (battery.value < 20 || isEStopActive.value) stopVel()
  if (battery.value < 20) addLog(`Critical battery: ${battery.value.toFixed(1)}%`, 'error')
  if (battery.value === 0) addLog("Empty battery! Robot stopped.", 'error')

  // 3. SEND DATA TO INFLUXDB (Data Historian)
  try {
    // Virtual proximity sensor calculation (Lidar)
    let minDistance = 999.0
    if (typeof currentScan !== 'undefined' && currentScan && currentScan.ranges) {
      for (let i = 0; i < currentScan.ranges.length; i++) {
        const d = currentScan.ranges[i]
        if (d !== null && d >= currentScan.range_min && d <= currentScan.range_max) {
          if (d < minDistance) minDistance = d
        }
      }
    }
    // If there is no valid point, set a default value of 10 meters
    if (minDistance === 999.0) minDistance = 10.0

    const point = new Point('telemetry') // The name of the "table"
      .tag('robot_id', 'polebot_01')     // Tag to identify this specific robot
      .tag('state', robotState.value)    // Robot state (MOVING, IDLE, OFFLINE)
      .floatField('battery_level', battery.value)
      .floatField('linear_speed', parseFloat(odom.value.linear_speed))
      .floatField('angular_speed', parseFloat(odom.value.angular_speed))
      .floatField('position_x', parseFloat(odom.value.x))
      .floatField('position_y', parseFloat(odom.value.y))
      .floatField('orientation_yaw', parseFloat(odom.value.yaw))
      .booleanField('estop_active', isEStopActive.value)       // NEW: Emergency stop
      .floatField('min_obstacle_distance', minDistance)        // NEW: Lidar virtual bumper
    
    writeApi.writePoint(point) // Put the point in the mailbox
    writeApi.flush() // Force send to database so charts update in real time!
  } catch (err) {
    console.error("InfluxDB write error:", err)
  }
}, 1000)


// ----- State and UI Management -----

// ⚠️ ROS2 ARCHITECTURE NOTICE:
// Detecting state via raw data reception is imprecise.
// The best practice (ROS2 Standard) is to use `diagnostic_msgs` on the `/diagnostics` topic
// where the robot publishes an official "Heartbeat" of each component's state (OK, WARN, ERROR).
// Sensor health state
const sensors = ref({ 
  lidar: 'WAITING',
  camera: 'WAITING',
  map: 'WAITING'
})

// ⚠️ ROS2 ARCHITECTURE NOTICE:
// Deducing state solely from speed (odom) is a limited approach.
// If the robot is physically blocked but the motors are running, the dashboard will show "MOVING".
// The industrial approach: use Managed Nodes (Lifecycle) or listen to the
// navigation action server (e.g., Nav2) to know the true logical state of the robot.
// The robot state calculates itself based on speed!
const robotState = computed(() => {
  if(!connected.value) return 'OFFLINE'
  if(parseFloat(odom.value.linear_speed) !== 0 || parseFloat(odom.value.angular_speed) !==0) return 'MOVING'
  return 'IDLE' //Idle
})

// We create a function to get the CSS style based on the state
const getStateColor = (state) => {
  switch (state) {
    case 'MOVING': return 'badge-green' // Green
    case 'IDLE': return 'badge-yellow' // Orange
    case 'OFFLINE': return 'badge-red' // Red
    default: return ''
  }
}

// ----- Central ROS Connection Function (connectRos) -----

async function connectRos() {
  if (connecting.value || connected.value) return
  connecting.value = true
  
  try {
    // Creation of the connection to ws://localhost:9090
    ros = new ROSLIB.Ros({ url: wsUrl.value })

    // Event: Connection successful
    ros.on('connection', () => {
      connected.value = true
      connecting.value = false
      addLog('Connected to ROSBridge!', 'success')
    })

    // ---- PUBLISHER /cmd_vel ----
    cmdVelTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/cmd_vel',
      messageType: 'geometry_msgs/msg/Twist'
    })

    // ---- SUBSCRIPTION TO /odom ----
    const odomListener = new ROSLIB.Topic({
      ros: ros,
      name: '/odom',
      messageType: 'nav_msgs/msg/Odometry'
    })

    odomListener.subscribe((message) => {
      // We only extract speeds from /odom (pure odometry drifts)
      odom.value.linear_speed = message.twist.twist.linear.x.toFixed(2)
      odom.value.angular_speed = message.twist.twist.angular.z.toFixed(2)
    })
    // ----------------------------

    // ---- SUBSCRIPTION TO /robot_pose (Exact Position on SLAM Map) ----
    const poseListener = new ROSLIB.Topic({
      ros: ros,
      name: '/robot_pose',
      messageType: 'geometry_msgs/msg/PoseStamped'
    })

    poseListener.subscribe((message) => {
      // Extraction of X and Y position on the map
      odom.value.x = message.pose.position.x.toFixed(2)
      odom.value.y = message.pose.position.y.toFixed(2)

      // Extraction of Yaw angle
      const q = message.pose.orientation
      const siny_cosp = 2 * (q.w * q.z + q.x * q.y)
      const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
      odom.value.yaw = Math.atan2(siny_cosp, cosy_cosp).toFixed(2)
    })
    // ----------------------------

    // ---- SUBSCRIPTION TO /map ----
    const mapListener = new ROSLIB.Topic({
      ros: ros,
      name: '/map',
      messageType: 'nav_msgs/msg/OccupancyGrid'
    })

    mapListener.subscribe((message) => {
      mapInfo.value = `Size: ${message.info.width}x${message.info.height} (Resolution: ${message.info.resolution.toFixed(3)}m/px)`
      drawMap(message)
    })
    // ----------------------------

    // ---- SUBSCRIPTION TO LIDAR ----
    const lidarListener = new ROSLIB.Topic({
      ros: ros,
      name: '/scan',
      messageType: 'sensor_msgs/msg/LaserScan'
    })
    lidarListener.subscribe((message) => {
      drawLidar(message)
    })

    // Event: Error
    ros.on('error', (error) => {
      connecting.value = false
      addLog("ROS connection error", "error")
    })

    // Event: Disconnection
    ros.on('close', () => {
      connected.value = false
      connecting.value = false
      addLog("Disconnected from ROSBridge", "error")
    })
  } catch (err) {
    addLog("Import or connection error", "error")
    connecting.value = false
  }

  // ----------------------------

  // ---- SUBSCRIPTION TO DIAGNOSTICS (Sensor Heartbeat) ----
  const diagListener = new ROSLIB.Topic({
    ros: ros,
    name: '/diagnostics',
    messageType : 'diagnostic_msgs/msg/DiagnosticArray'
  })

  diagListener.subscribe((message) => {
    // message.status is an array of all sensors
    message.status.forEach((status) => {
      // Translation of ROS2 error level (0=OK, 1=WARN, 2=ERROR, 3=STALE)
      let stateStr = 'UNKNOWN'
      if (status.level === 0) stateStr = 'OK'
      else if (status.level === 1) stateStr = 'WARN'
      else if (status.level === 2) stateStr = 'ERROR'
      else if (status.level === 3) stateStr = 'STALE'

      // On met à jour l'UI en identifiant le capteur par son nom
      const name = status.name.toLowerCase()
      if (name.includes('lidar') || name.includes('scan')) {
        sensors.value.lidar = stateStr
      } else if (name.includes('camera') || name.includes('depth')) {
        sensors.value.camera = stateStr
      } else if (name.includes('map') || name.includes('slam') || name.includes('nav')) {
        sensors.value.map = stateStr
      }
    })
  })
}

// ----- Système de Logs et Emergency Stop -----

function addLog(message, type = 'info'){
  const now = new Date()
  const timeString = now.toLocaleTimeString() // Ex: 14:30:05
  //Om ajoute le nouveau message au début de la liste
  logs.value.unshift({
    time: timeString,
    message: message,
    type: type
  })

  // On limite le nombre de logs à 20
  if(logs.value.length > 20) {
    logs.value.pop()
  }
}

function getLogColor(type){
  switch (type){
    case 'error': return 'var(--accent-red)' // Red pour les pannes/urgences
    case 'warning': return 'var(--accent-yellow)' // Jaune pour les alertes (batterie)
    case "success": return 'var(--accent-green)' // vert pour les succés
    default : return 'var(--text-secondary)' // Couleur par défaut
  }
}

// ⚠️ AVIS ARCHITECTURE ROS2 (Sécurité) :
// Un bouton Web est un "Soft E-Stop". Il ne doit JAMAIS remplacer le vrai bouton d'arrêt d'urgence physique ("Hard E-Stop") sur le robot.
// En cas de perte Wi-Fi, ce bouton ne fonctionnera plus. Une sécurité logicielle robuste doit toujours
// s'accompagner d'une coupure matérielle.
// Sécurité IHM : Long Press (1 seconde) pour éviter les faux contacts sur écran tactile
let eStopTimer = null
function startEStopPress() {
  eStopTimer = setTimeout(() => {
    toggleEStop()
  }, 1000) // Le bouton doit être maintenu 1 seconde
}
function cancelEStopPress() {
  if (eStopTimer) clearTimeout(eStopTimer)
  eStopTimer = null
}

function toggleEStop(){
  isEStopActive.value = !isEStopActive.value //On inverse l'état du bouton
  if(isEStopActive.value){
    stopVel() //On force l'arret immédiat du robo
    addLog("Arret d'urgence activé !", "error")  
  }
  else {
    addLog("Arret d'urgence désactivé !", "success")  
  }
}

 
// ----- CONTRÔLE MANUEL -----



function startVel(linear, angular) {
  // 1. LE BOUCLIER : Si Urgence, on bloque instantanément, on ne fait rien d'autre !
  if (isEStopActive.value) return
  
  
  if (!cmdVelTopic || !connected.value) return
  if (velInterval) clearInterval(velInterval)
  
  // On envoie la commande en boucle (10 fois par seconde)
  velInterval = setInterval(() => {
    const twist = {
      linear: { x: linear, y: 0.0, z: 0.0 },
      angular: { x: 0.0, y: 0.0, z: angular }
    }
    cmdVelTopic.publish(twist)
  }, 100)
}

// ⚠️ AVIS ARCHITECTURE ROS2 (Conflit de commandes) :
// Envoyer {x:0, y:0, z:0} sur /cmd_vel est inefficace si Nav2 tourne en même temps, car Nav2 
// écrasera cette commande à la fraction de seconde suivante. 
// L'approche Industrielle ROS2 : utiliser `twist_mux` et publier sur un topic très prioritaire 
// (ex: /e_stop_vel), ou désactiver directement les Lifecycle Nodes contrôlant les moteurs via un Service.
function stopVel() {
  if (velInterval) clearInterval(velInterval)
  if (!cmdVelTopic || !connected.value) return
  
  const twist = {
    linear: { x: 0.0, y: 0.0, z: 0.0 },
    angular: { x: 0.0, y: 0.0, z: 0.0 }
  }
  
  // Solution d'Expert : On publie l'arrêt plusieurs fois pour 
  // garantir la réception malgré les éventuelles pertes Wi-Fi
  let stopTicks = 0
  velInterval = setInterval(() => {
    cmdVelTopic.publish(twist)
    stopTicks++
    if (stopTicks >= 4) { // Envoi 4 fois (pendant 400ms)
      clearInterval(velInterval)
    }
  }, 100)
}


// ----- Services ROS et Déconnexion -----
// Fonction appelée quand on clique sur "Disconnect"
function disconnectRos() {
  // 1. Couper la connexion réseau avec le robot
  if (ros) ros.close()

  // 2. Arrêter le spam des commandes moteurs
  if (velInterval) clearInterval(velInterval)

  // 3. Arrêter les tentatives de connexion en cours
  if (connectTimeout) clearTimeout(connectTimeout)

  // 4. Désactiver les alarmes (Watchdogs) des capteurs
  // On parcourt tous les chronos actifs pour les annuler
  if (typeof sensorWatchdogs !== 'undefined') {
    Object.values(sensorWatchdogs).forEach(timer => clearTimeout(timer))
  }

  // 5. Mettre à jour l'interface web immédiatement
  connected.value = false
  connecting.value = false
  
  // 6. Optionnel : un petit log de confirmation
  addLog("Déconnexion manuelle effectuée.", "info")
}

// ----- Peindre la Carte du Robot (OccupancyGrid) -----

// ⚠️ AVIS ARCHITECTURE ROS2 (Performance UI) :
// Cette double boucle (X/Y) bloque le fil principal (Main Thread) de JavaScript.
// Sur des cartes industrielles gigantesques (ex: 4000x4000 pixels = 16M d'itérations), cela va
// complètement "geler" l'interface web pendant plusieurs secondes à chaque rafraîchissement.
// Solutions industrielles : 
// 1. Déplacer ce calcul CPU lourd dans un "Web Worker" (en tâche de fond).
// 2. Ou utiliser le GPU avec WebGL (Shaders) pour un rendu instantané.
// Fonction qui transmet la carte au Web Worker pour un dessin en arrière-plan
function drawMap(msg) {
  if (!mapCanvas.value) return
  if (!mapCtx) mapCtx = mapCanvas.value.getContext('2d')
  
  // On sauvegarde les métadonnées tout de suite pour le Lidar
  mapCanvas.value.width = msg.info.width
  mapCanvas.value.height = msg.info.height
  mapData = msg

  // Envoi asynchrone au Worker (le Main Thread n'est plus bloqué !)
  mapWorker.postMessage({
    data: msg.data,
    width: msg.info.width,
    height: msg.info.height
  })
}

// ---- Spatial Coordinates ----

//Convertit des mėtres (Monde ROS) en pixels (Canvas HTML)
function worldToCanvas(wx,wy){
  if(!mapData) return {px: 0, py: 0}
  const px = (wx - mapData.info.origin.position.x) / mapData.info.resolution
  const py = mapData.info.height -1 - ((wy - mapData.info.origin.position.y) / mapData.info.resolution)
  return {px, py}
}

// ----- The Graphical Conductor (renderCanvas) -----

//Le chef d'orchestre qui superpose tout !
function renderCanvas(){
  if(!mapCtx || !mapImageData) return

  //Couche 1 : On colle le fond (la carte)
  mapCtx.putImageData(mapImageData, 0, 0)


  //Couche 2 : On dessine le robot par dessus (Point Bleu)
  const rx = parseFloat(odom.value.x)
  const ry = parseFloat(odom.value.y)
  const yawRobot = parseFloat(odom.value.yaw)
  const {px, py} = worldToCanvas(rx, ry)



  // Layer 3: Draw the robot on top (Blue Point)
  // 1. The robot body (Blue Circle)
  mapCtx.beginPath()
  mapCtx.arc(px, py, 4, 0, 2*Math.PI)
  mapCtx.fillStyle = '#3b82f6' // Blue
  mapCtx.fill()

  // 2. Direction arrow (Black Line)
  // We calculate a virtual point 50 cm (0.5m) in front of the robot
  const frontX = rx + (Math.cos(yawRobot) * 0.5) 
  const frontY = ry + (Math.sin(yawRobot) * 0.5)
  const {px: fpx, py: fpy} = worldToCanvas(frontX, frontY)
  
  mapCtx.beginPath()
  mapCtx.moveTo(px, py)
  mapCtx.lineTo(fpx, fpy)
  mapCtx.strokeStyle = '#000000' // Black to contrast with the light gray map background
  mapCtx.lineWidth = 3 // Thicker stroke
  mapCtx.stroke()

}

// ----- Le Relais du Lidar (drawLidar) -----

//Dessin du LIDAR
function drawLidar(msg) {
  currentScan = msg
}

// ----- THE GAME LOOP (Industrial Optimization) -----
let isLoopRunning = false
function startRenderLoop() {
  if (connected.value) {
    renderCanvas()
  }
  requestAnimationFrame(startRenderLoop)
}
// Start the infinite loop as soon as the script loads
if (!isLoopRunning) {
  isLoopRunning = true
  requestAnimationFrame(startRenderLoop)
}

// ----- Analytical Dashboard (InfluxDB -> Chart.js) -----

// Plugin to force a white background (useful for PNG export)
const whiteBackgroundPlugin = {
  id: 'customCanvasBackgroundColor',
  beforeDraw: (chart) => {
    const ctx = chart.canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  }
};

function fetchAndDrawChart() {
  const queryApi = influxDB.getQueryApi(influxOrg)
  const startRange = chartStartTime ? chartStartTime.toISOString() : '-24h'
  const query = `
    from(bucket: "${influxBucket}")
      |> range(start: ${startRange})
      |> filter(fn: (r) => r._measurement == "telemetry")
      |> filter(fn: (r) => r.robot_id == "${selectedRobotId.value}")
      |> filter(fn: (r) => r._field != "estop_active")
      |> aggregateWindow(every: 30s, fn: mean, createEmpty: false)
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
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
      batteryData.push(o.battery_level || 0)
      linearSpeedData.push(o.linear_speed || 0)
      angularSpeedData.push(o.angular_speed || 0)
      
      if (o.position_x !== undefined && o.position_y !== undefined) {
        trajectoryData.push({ x: o.position_x, y: o.position_y })
        posXData.push(o.position_x)
        posYData.push(o.position_y)
      }
    },
    error(error) { 
      console.error("Erreur de requête InfluxDB:", error) 
    },
    complete() {
      // Sauvegarder les données en cache (pour le modal agrandi)
      chartDataCache = { labels, battery: batteryData, linear: linearSpeedData, angular: angularSpeedData, trajectory: trajectoryData, posX: posXData, posY: posYData }

      // --- 1. GRAPHIQUE BATTERIE ---
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

      // --- 2. GRAPHIQUE VITESSES ---
      const ctxSpd = document.getElementById('speedChart')
      if (ctxSpd) {
        if (speedChartInstance) speedChartInstance.destroy()
        const datasets = [
          { label: 'V. Linear (m/s)', data: linearSpeedData, borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, hidden: !showLinearSpeedLine.value },
          { label: 'V. Angular (rad/s)', data: angularSpeedData, borderColor: '#eab308', borderWidth: 2, pointRadius: 0, hidden: !showAngularSpeedLine.value }
        ]
        speedChartInstance = new Chart(ctxSpd, {
          type: 'line',
          data: { labels, datasets },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } } },
          plugins: [whiteBackgroundPlugin]
        })
      }

      // --- 3. GRAPHIQUE TRAJECTOIRE X/Y ---
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

      // --- 4. GRAPHIQUE POSITION AU FIL DU TEMPS ---
      const ctxPos = document.getElementById('positionChart')
      if (ctxPos && posXData.length > 0) {
        if (positionChartInstance) positionChartInstance.destroy()
        positionChartInstance = new Chart(ctxPos, {
          type: 'line',
          data: { labels, datasets: [
            { label: 'X (m)', data: posXData, borderColor: '#10b981', borderWidth: 2, pointRadius: 0, hidden: !showPosXLine.value },
            { label: 'Y (m)', data: posYData, borderColor: '#f97316', borderWidth: 2, pointRadius: 0, hidden: !showPosYLine.value }
          ]},
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { font: { size: 10 } } } } },
          plugins: [whiteBackgroundPlugin]
        })
      }
    }
  })
}

// ----- Interactivité et Export (Analytics) -----

let analyticsRefreshInterval = null

function openAnalytics() {
  activeTab.value = 'analytics'
  setTimeout(() => {
    fetchAndDrawChart()
  }, 200)
  
  if (analyticsRefreshInterval) clearInterval(analyticsRefreshInterval)
  analyticsRefreshInterval = setInterval(() => {
    if (activeTab.value === 'analytics') {
      fetchAndDrawChart()
    } else {
      clearInterval(analyticsRefreshInterval)
      analyticsRefreshInterval = null
    }
  }, 10000)
}

// Watcher : quand on clique pour agrandir un graphique
watch(expandedChart, (chartType) => {
  if (!chartType) {
    if (expandedChartInstance) expandedChartInstance.destroy()
    expandedChartInstance = null
    return
  }
  // Attendre que le DOM du modal soit rendu
  setTimeout(() => {
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
      const datasets = [
        { label: 'V. Linear (m/s)', data: d.linear, borderColor: '#ef4444', borderWidth: 2, pointRadius: 1, hidden: !showLinearSpeedLine.value },
        { label: 'V. Angular (rad/s)', data: d.angular, borderColor: '#eab308', borderWidth: 2, pointRadius: 1, hidden: !showAngularSpeedLine.value }
      ]
      expandedChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels: d.labels, datasets },
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
        data: { labels: d.labels, datasets: [
          { label: 'X (m)', data: d.posX, borderColor: '#10b981', borderWidth: 2, pointRadius: 1, hidden: !showPosXLine.value },
          { label: 'Y (m)', data: d.posY, borderColor: '#f97316', borderWidth: 2, pointRadius: 1, hidden: !showPosYLine.value }
        ]},
        options: { responsive: true, maintainAspectRatio: false },
        plugins: [whiteBackgroundPlugin]
      })
    }
  }, 100)
})

// Watcher : quand les filtres de vitesse changent, on met à jour la visibilité (sans recharger les données)
watch([showLinearSpeedLine, showAngularSpeedLine], () => {
  if (speedChartInstance) {
    speedChartInstance.data.datasets[0].hidden = !showLinearSpeedLine.value;
    speedChartInstance.data.datasets[1].hidden = !showAngularSpeedLine.value;
    speedChartInstance.update();
  }
  if (expandedChart.value === 'speed' && expandedChartInstance) {
    expandedChartInstance.data.datasets[0].hidden = !showLinearSpeedLine.value;
    expandedChartInstance.data.datasets[1].hidden = !showAngularSpeedLine.value;
    expandedChartInstance.update();
  }
})

// Watcher : quand les filtres de position changent, on met à jour la visibilité
watch([showPosXLine, showPosYLine], () => {
  if (positionChartInstance) {
    positionChartInstance.data.datasets[0].hidden = !showPosXLine.value;
    positionChartInstance.data.datasets[1].hidden = !showPosYLine.value;
    positionChartInstance.update();
  }
  if (expandedChart.value === 'position' && expandedChartInstance) {
    expandedChartInstance.data.datasets[0].hidden = !showPosXLine.value;
    expandedChartInstance.data.datasets[1].hidden = !showPosYLine.value;
    expandedChartInstance.update();
  }
})

function downloadChart() {
  // Télécharger le graphique agrandi si ouvert, sinon le premier graphique
  const canvasId = expandedChart.value ? 'expandedChartCanvas' : 'batteryChart'
  const canvas = document.getElementById(canvasId)
  if (!canvas) return
  const link = document.createElement('a')
  link.download = 'Historique_Polebot.png'
  link.href = canvas.toDataURL('image/png')
  link.click()
}

function resetChart(){
  if (batteryChartInstance) batteryChartInstance.destroy()
  if (speedChartInstance) speedChartInstance.destroy()
  if (trajectoryChartInstance) trajectoryChartInstance.destroy()
  if (positionChartInstance) positionChartInstance.destroy()
  if (expandedChartInstance) expandedChartInstance.destroy()
  batteryChartInstance = speedChartInstance = trajectoryChartInstance = positionChartInstance = expandedChartInstance = null
  chartStartTime = new Date()
  localStorage.setItem('chartStartTime', chartStartTime.toISOString())  // Persistance !
  battery.value = 100
  addLog('Graphiques réinitialisés !', 'info')

  // Feedback immédiat : afficher un graphique batterie à 100% avec l'heure du reset
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
</script>

<template>
  <div style="display:flex; height:100vh; background:var(--bg-main); color:var(--text-primary); font-family:'Inter', sans-serif; overflow: hidden;">
    
    <!-- LEFT SIDEBAR -->
    <aside style="width: 260px; background: var(--bg-sidebar); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; z-index: 10;">
      <!-- Brand / Logo -->
      <div style="padding: 20px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 10px;">
        <div style="font-size: 26px;">🤖</div>
        <div>
          <h1 style="margin: 0; font-size: 16px; font-weight: 700; color: #fff; letter-spacing: 0.5px;">Polebot AMR</h1>
          <div style="font-size: 11px; color: var(--accent-blue); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Fleet Manager</div>
        </div>
      </div>

      <!-- Navigation -->
      <nav style="padding: 20px 10px; flex: 1;">
        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 12px; padding-left: 10px;">Applications</div>
        
        <button @click="activeTab = 'control'" class="sidebar-item" :class="{ 'active': activeTab === 'control' }">
          <span style="font-size: 16px;">🎮</span> Live Control
        </button>
        
        <button @click="openAnalytics()" class="sidebar-item" :class="{ 'active': activeTab === 'analytics' }">
          <span style="font-size: 16px;">📈</span> Analytics History
        </button>
      </nav>

      <!-- Fleet Selector -->
      <div style="padding: 15px 10px; border-top: 1px solid var(--border-color); background: var(--bg-sidebar);">
        <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 10px; padding-left: 10px; display:flex; justify-content:space-between; align-items:center;">
          <span>Active Fleet</span>
          <span class="badge badge-green pulse" style="font-size:9px; padding:2px 6px;">1 Online</span>
        </div>

        <!-- Selected Robot -->
        <div class="fleet-item" :class="{ 'selected': selectedRobotId === 'polebot_01' }" @click="selectedRobotId = 'polebot_01'; fetchAndDrawChart()">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="status-dot green pulse"></div>
            <span style="font-size: 13px; font-weight: 500; color:#fff;">polebot_01</span>
          </div>
          <div style="font-size:11px; font-weight:600; color:var(--accent-green);">{{ Math.round(battery) }}% 🔋</div>
        </div>
      </div>
    </aside>

    <!-- MAIN CONTENT AREA -->
    <main style="flex: 1; display: flex; flex-direction: column; position: relative; overflow: hidden; background: var(--bg-main);">
      
      <!-- TOP HEADER -->
      <header style="height: 65px; min-height: 65px; padding: 0 25px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); background: var(--bg-header); box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <div style="font-size: 18px; font-weight: 600; color: #fff; display: flex; align-items: center; gap: 10px;">
          {{ activeTab === 'control' ? 'Live Teleoperation' : 'Analytics & Data Historian' }}
          <span style="color:var(--text-muted); font-size:14px; font-weight:400;">/ {{ selectedRobotId }}</span>
        </div>

        <div style="display: flex; align-items: center; gap: 15px;">
          <input v-model="wsUrl" placeholder="ws://localhost:9090" :disabled="connected" style="background:var(--bg-secondary); border:1px solid var(--border-color); color:#fff; padding:6px 12px; border-radius:6px; font-size:12px; width:180px;" />
          <span class="badge" :class="connected ? 'badge-green pulse' : 'badge-red'" style="padding: 6px 12px; font-size:11px;">
            {{ connected ? '● ROS2 Connected' : '● ROS2 Offline' }}
          </span>
          <button v-if="!connected" @click="connectRos" class="btn btn-primary" :disabled="connecting" style="padding: 6px 16px;">
            {{ connecting ? 'Connecting...' : '▶ Connect' }}
          </button>
          <button v-else @click="disconnectRos" class="btn btn-danger" style="padding: 6px 16px;">⏹ Disconnect</button>
        </div>
      </header>

    <!-- 2. ONGLET ANALYTICS -->
    <div v-if="activeTab === 'analytics'" style="padding: 15px; flex: 1; display: flex; flex-direction: column; overflow: hidden;">
      
      <!-- Barre d'outils globale -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <div style="display:flex; gap:15px; align-items:center;">
          <h2 style="margin:0;">📊 InfluxDB History (Full Session)</h2>
          <select v-model="selectedRobotId" @change="fetchAndDrawChart" style="padding:4px 8px; border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); border:1px solid var(--border-color); font-size:12px; cursor:pointer;">
            <option value="polebot_01">🤖 polebot_01</option>
          </select>
        </div>
        <button class="btn btn-reset" @click="resetChart" style="padding: 5px 10px; font-size:11px;">
          🔄 Reset
        </button>
      </div>

      <!-- Grille 2x2 des graphiques -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap:12px; flex:1;">
        
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

        <!-- 3. Trajectoire X/Y -->
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

        <!-- 4. Position au fil du temps -->
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
    </div>

    <!-- MODAL : Graphique agrandi (plein écran) -->
    <div v-if="expandedChart" 
      @click="expandedChart = null"
      style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); z-index:1000; display:flex; align-items:center; justify-content:center; padding:40px;">
      <div class="card" @click.stop style="width:90vw; height:85vh; display:flex; flex-direction:column;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h2 style="margin:0;">
            {{ expandedChart === 'battery' ? '🔋 Battery' : expandedChart === 'speed' ? '⚡ Speeds' : expandedChart === 'trajectory' ? '🗺️ Trajectoire' : '📍 Position' }}
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

    <!-- 3. CONTROL TAB: MAIN GRID (Contains the 3 columns of our dashboard) -->
    <div class="main-grid" v-show="activeTab === 'control'">
      <!-- LEFT Column (Live data) -->
      <div class="col">
        <div class="card">
          <h2>Position & Speeds</h2>
          
          <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
            <div>
              <div style="font-size:10px; color:var(--text-muted)">POSITION X</div>
              <div style="font-size:24px; font-family:monospace; color:var(--accent-blue)">{{ odom.x }} m</div>
            </div>
            <div>
              <div style="font-size:10px; color:var(--text-muted)">POSITION Y</div>
              <div style="font-size:24px; font-family:monospace; color:var(--accent-green)">{{ odom.y }} m</div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between;">
            <div>
              <div style="font-size:10px; color:var(--text-muted)">LINEAR SPEED</div>
              <div style="font-size:20px; font-family:monospace; color:var(--text-primary)">{{ odom.linear_speed }} m/s</div>
            </div>
            <div>
              <div style="font-size:10px; color:var(--text-muted)">ANGULAR SPEED</div>
              <div style="font-size:20px; font-family:monospace; color:var(--text-primary)">{{ odom.angular_speed }} rad/s</div>
            </div>
          </div>

          <div class="card" style="margin-top: 10px;">
            <h2>Robot Camera</h2>
            <img id="cameraStream" src="http://localhost:8080/stream?topic=/depth_camera/rgb/image_raw" 
                 style="width: 100%; border-radius: 8px; background: #000;" alt="ROS2 Emptyo Stream" />
          </div>
        </div>
        <!-- CARD: SYSTEM STATUS -->
        <div class="card">
          <h2>System Status</h2>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; 
          border-bottom:1px solid var(--border-color); padding-bottom:10px; margin-bottom:12px;">
            <span style="font-size:12px; color:var(--text-muted)">ROBOT STATE</span>
            <span :class="['badge', getStateColor(robotState)]">{{ robotState }}</span>
          </div>

          <div style="display:flex; flex-direction: column; gap:8px; font-size:12px;">
            <!-- LIDAR -->
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted)">LIDAR</span>
              <span :style="{
                color: sensors.lidar === 'OK' ? 'var(--accent-green)' :
                       sensors.lidar === 'WARN' ? 'var(--accent-yellow)' :
                       (sensors.lidar === 'ERROR' || sensors.lidar === 'STALE') ? 'var(--accent-red)' :
                       'var(--text-secondary)'
              }">{{ sensors.lidar }}</span>
            </div>
            <!-- CAMERA -->
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted)">CAMERA</span>
              <span :style="{
                color: sensors.camera === 'OK' ? 'var(--accent-green)' :
                       sensors.camera === 'WARN' ? 'var(--accent-yellow)' :
                       (sensors.camera === 'ERROR' || sensors.camera === 'STALE') ? 'var(--accent-red)' :
                       'var(--text-secondary)'
              }">{{ sensors.camera }}</span>
            </div>
            <!-- MAP -->
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted)">MAP</span>
              <span :style="{
                color: sensors.map === 'OK' ? 'var(--accent-green)' :
                       sensors.map === 'WARN' ? 'var(--accent-yellow)' :
                       (sensors.map === 'ERROR' || sensors.map === 'STALE') ? 'var(--accent-red)' :
                       'var(--text-secondary)'
              }">{{ sensors.map }}</span>
            </div>
          </div>
        </div>
      </div>


      <!-- Colonne CENTRE (La Carte) -->
      <div class="col-center">
        <div class="card" style="flex:1; display:flex; flex-direction:column; min-height:400px;">
            <h2>Live Map (SLAM)</h2>
            <div style="font-size:10px; color:var(--text-muted); margin-bottom:8px">
              {{ mapInfo }}
            </div>
            <div style="display:flex; align-items:center; gap:16px; font-size:11px; color:var(--text-muted); margin-bottom:8px;">
              <!-- Zoom slider -->
              <div style="display:flex; align-items:center; gap:8px;">
                <span>Zoom: {{ Math.round(mapZoom * 100) }}%</span>
                <input type="range" min="0.2" max="3" step="0.1" v-model="mapZoom" style="width:100px;">              
              </div>
            </div>

            <!-- This is where we will draw the map with zoom and overflow blocking -->
            <div style="flex:1; width:100%; border-radius:8px; background:var(--bg-secondary); overflow:hidden; position:relative;">
              <canvas 
                ref="mapCanvas" 
                :style="{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%) scale(' + mapZoom + ')',
                  transformOrigin: 'center center'
                }"
              ></canvas>
            </div>
            
            <div style="display:flex; gap:16px; margin-top:12px; font-size:11px; color:var(--text-muted); justify-content:center">
              <span>🔵 Robot</span>
              <span>⬜ Empty</span>
              <span>🔴 Obstacle</span>
            </div>
        </div>
      </div>


      <!-- Colonne DROITE (Contrôles et Logs) -->
      <div class="col">
        
        <!-- Manual Control -->
        <div class="card">
          <button 
            @mousedown="startEStopPress" 
            @mouseup="cancelEStopPress" 
            @mouseleave="cancelEStopPress"
            @touchstart="startEStopPress" 
            @touchend="cancelEStopPress"
            class="btn" 
            :style="{ 
              width: '100%', 
              marginBottom: '15px', 
              padding: '12px', 
              fontWeight: 'bold',
              background: isEStopActive ? 'var(--accent-red)' : 'rgba(239,68,68,0.15)',
              color: isEStopActive ? '#fff' : 'var(--accent-red)',
              border: '2px solid var(--accent-red)'
            }">
            {{ isEStopActive ? "⚠️ EMERGENCY STOP LOCKED" : "🛑 HOLD 1s FOR EMERGENCY STOP" }}
          </button>
          <h2>Manual Control</h2>
          <div class="ctrl-grid">
            <div></div>
            <button class="ctrl-btn" @mousedown="startVel(maxLinearSpeed, 0)" @touchstart="startVel(maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▲</button>
            <div></div>
            <button class="ctrl-btn" @mousedown="startVel(0, maxAngularSpeed)" @touchstart="startVel(0, maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">◀</button>
            <button class="ctrl-btn ctrl-stop" @click="stopVel">⏹</button>
            <button class="ctrl-btn" @mousedown="startVel(0, -maxAngularSpeed)" @touchstart="startVel(0, -maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▶</button>
            <div></div>
            <button class="ctrl-btn" @mousedown="startVel(-maxLinearSpeed, 0)" @touchstart="startVel(-maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel" @touchend="stopVel">▼</button>
            <div></div>
          </div>

          <div style="text-align:center; font-size:11px; color:var(--text-muted); margin-top:8px">
            Maintenez cliqué pour piloter
          </div>

          <div style="margin-bottom: 15px; font-size: 12px; color: var(--text-muted);">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
              <span>Max Speed (Linear): {{ maxLinearSpeed }} m/s</span>
            </div>
            <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxLinearSpeed" style="width:100%;">
            
            <div style="display:flex; justify-content:space-between; margin-bottom:5px; margin-top:10px;">
              <span>Max Speed (Angular): {{ maxAngularSpeed }} rad/s</span>
            </div>
            <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxAngularSpeed" style="width:100%;">
          </div>

        </div>

        <div class="card">
            <h2>Logs</h2>
            <div style="display:flex; flex-direction:column; gap:8px; max-height:200px;
            overflow-y:auto; padding-right:12px;">
              <div v-for="(log, index) in logs"
              :key="log.time + index"
              :style="{color: getLogColor(log.type)}">
              <span style="color:var(--text-muted)">[{{ log.time }}]</span>
              {{ log.message }}
              </div>
        </div>
        </div>
      </div>
    </div>
  </main>
</div>
</template>

<style>
/* Very dark theme / Space */
:root {
  --bg-main: #e5e7eb; /* Light gray background */
  --bg-sidebar: #111827;
  --bg-header: #151e32;
  --bg-card: #1f2937;
  --bg-secondary: #374151;
  --text-primary: #f3f4f6;
  --text-muted: #9ca3af;
  --border-color: #2e3a53;
  --accent-blue: #3b82f6;
  --accent-green: #10b981;
  --accent-red: #ef4444;
  --accent-yellow: #f59e0b;
}

/* Sidebar Styles */
.sidebar-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 15px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 5px;
}
.sidebar-item:hover {
  background: rgba(255,255,255,0.05);
  color: var(--text-primary);
}
.sidebar-item.active {
  background: var(--accent-blue);
  color: #fff;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.fleet-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
  margin-bottom: 4px;
}
.fleet-item:hover {
  background: rgba(255,255,255,0.05);
}
.fleet-item.selected {
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.4);
}
.fleet-item.offline {
  opacity: 0.5;
}
.fleet-item.offline:hover {
  opacity: 0.8;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot.green { background: var(--accent-green); box-shadow: 0 0 8px var(--accent-green); }
.status-dot.red { background: var(--accent-red); }

/* Main Grid */
.main-grid { 
    display:grid; 
    grid-template-columns:300px 1fr 300px; 
    gap:10px; padding:10px; flex:1; overflow:hidden; 
}
.col { display:flex; flex-direction:column; gap:10px; overflow-y:auto; }
.col-center { display:flex; flex-direction:column; overflow:hidden; }

/* Cards (gray background) */
.card { 
    background:var(--bg-card); border:1px solid var(--border-color); 
    border-radius:12px; padding:14px; 
}
.chart-card { transition: transform 0.15s, box-shadow 0.15s; }
.chart-card:hover { transform: scale(1.02); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
h2 { font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; }

/* Control Buttons */
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

/* Buttons */
.btn { padding:7px 14px; border-radius:8px; border:none; font-size:13px; font-weight:500; cursor:pointer; }
.btn-primary { background:var(--accent-blue); color:white; }
.btn-reset { background:var(--accent-yellow); color:white; }
.btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
.btn-danger { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }

/* Status badges */
.badge { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:20px; font-size:12px; font-weight:500; }
.badge-green { background:rgba(16,185,129,0.15); color:var(--accent-green); border:1px solid rgba(16,185,129,0.3); }
.badge-yellow { background:rgba(245,158,11,0.15); color:var(--accent-yellow); border:1px solid rgba(245,158,11,0.3); }
.badge-red { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }
.pulse { animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

</style>
