<script setup>
import { ref, computed, watch } from 'vue'
import * as ROSLIB from 'roslib'
import { InfluxDB, Point } from '@influxdata/influxdb-client'
import Chart from 'chart.js/auto'

// --- CONFIGURATION INFLUXDB ---
const influxURL = 'http://localhost:8086'
const influxToken = 'O6KdiXqBpyFcH1PlGx2GkVWjaUz6ptHEdA7nAwZsGA-DtC_un7iuWinrxczOF79ss1cb5ItgvqLjjRyaKDNXLQ=='
const influxOrg = '2fb3ec77104ac02e' // Utilisation de l'ID exact de votre organisation
const influxBucket = 'polebot_data'

const influxDB = new InfluxDB({ url: influxURL, token: influxToken })
const writeApi = influxDB.getWriteApi(influxOrg, influxBucket, 'ms') // ms = Précision à la milliseconde


// Nos variables réactives (si elles changent, l'interface se met à jour)
const wsUrl = ref('ws://localhost:9090')
const connected = ref(false)
const connecting = ref(false)
const mapCanvas = ref(null)
const mapInfo = ref('En attente de la carte...')
const battery = ref(100) // Batterie a 100% au départ
const maxLinearSpeed = ref(0.5)  // Vitesse d'avance (m/s)
const maxAngularSpeed = ref(0.5) // Vitesse de rotation (rad/s)
const isEStopActive = ref(false) // État du bouton d'arrêt d'urgence
const logs = ref([]) // tableau vide au départ
const showLidar = ref(true) // Controle de l'affichage du LiDAR
const mapZoom = ref(1) // 1 = 100%, 0.5 = 50% (dézoom), 2 = 200% (zoom)
const activeTab = ref('control') // Variable pour savoir quel onglet est ouvert
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
// Données partagées pour le modal agrandi
let chartDataCache = { labels: [], battery: [], linear: [], angular: [], trajectory: [], posX: [], posY: [] }
let mapCtx = null
let ros = null // L'objet qui gérera la connexion
let cmdVelTopic = null
let velInterval = null
let connectTimeout = null // Ajouté pour éviter l'erreur dans disconnectRos
let mapData = null
let mapImageData = null
let currentScan = null
// On récupère l'heure du dernier reset depuis le localStorage (survit au rafraîchissement)
let chartStartTime = localStorage.getItem('chartStartTime') ? new Date(localStorage.getItem('chartStartTime')) : null

// ---- SOLUTION D'EXPERT : Web Worker pour la Carte ----
// Création d'un Worker dynamique pour calculer l'image de la carte en arrière-plan (sans bloquer l'UI)
const mapWorkerCode = `
self.onmessage = function(e) {
  const { data, width, height } = e.data;
  const pixelData = new Uint8ClampedArray(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width) + x;
      const value = data[index];
      const pixelIndex = ((height - 1 - y) * width + x) * 4;
      
      if (value === -1) { // Inconnu (Gris foncé)
        pixelData[pixelIndex] = 15; pixelData[pixelIndex+1] = 22; pixelData[pixelIndex+2] = 41; pixelData[pixelIndex+3] = 255;
      } else if (value === 0) { // Vide (Gris très clair)
        pixelData[pixelIndex] = 220; pixelData[pixelIndex+1] = 220; pixelData[pixelIndex+2] = 225; pixelData[pixelIndex+3] = 255;
      } else { // Mur / Obstacle (Rouge vif)
        pixelData[pixelIndex] = 239; pixelData[pixelIndex+1] = 68; pixelData[pixelIndex+2] = 68; pixelData[pixelIndex+3] = 255;
      }
    }
  }
  
  // On renvoie le tableau calculé au fil principal
  self.postMessage({ pixelData, width, height }, [pixelData.buffer]);
}
`;
const mapWorkerBlob = new Blob([mapWorkerCode], { type: 'application/javascript' });
const mapWorker = new Worker(URL.createObjectURL(mapWorkerBlob));

mapWorker.onmessage = function(e) {
  const { pixelData, width, height } = e.data;
  mapImageData = new ImageData(pixelData, width, height);
};

// Variable réactive pour la position du robot
const odom = ref({
  x: '0.00',
  y: '0.00',
  yaw: '0.00',
  linear_speed: '0.00',
  angular_speed: '0.00'
})

// ----- Batterie et Data Historian -----

setInterval(() => {
  if (!connected.value) return

  // 1. DÉCHARGE SIMULÉE DE LA BATTERIE
  // Calcul : 100% / 10800 secondes (3h) ≈ 0.0093% par seconde
  if (parseFloat(odom.value.linear_speed) !== 0 || parseFloat(odom.value.angular_speed) !== 0) {
    battery.value = Math.max(0, battery.value - 0.0093)
  }

  // 2. BOUCLIER DE SÉCURITÉ
  // ⚠️ AVIS ARCHITECTURE ROS2 :
  // Gérer la sécurité depuis le Dashboard web est dangereux (risque de perte de Wi-Fi ou plantage navigateur).
  // Dans un vrai système, cette logique de "bouclier" (blocage cmd_vel) doit être implémentée 
  // dans un nœud ROS2 embarqué (C++ ou Python) directement sur le robot.
  if (battery.value < 20 || isEStopActive.value) stopVel()
  if (battery.value < 20) addLog(`Batterie critique : ${battery.value.toFixed(1)}%`, 'error')
  if (battery.value === 0) addLog("Batterie vide ! Le robot s'est arrêté.", 'error')

  // 3. ENVOI DES DONNÉES À INFLUXDB (Data Historian)
  try {
    const point = new Point('telemetry') // Le nom de la "table"
      .tag('robot_id', 'polebot_01')     // Étiquette pour identifier ce robot spécifique
      .tag('state', robotState.value)    // État du robot (MOVING, IDLE, OFFLINE)
      .floatField('battery_level', battery.value)
      .floatField('linear_speed', parseFloat(odom.value.linear_speed))
      .floatField('angular_speed', parseFloat(odom.value.angular_speed))
      .floatField('position_x', parseFloat(odom.value.x))
      .floatField('position_y', parseFloat(odom.value.y))
      .floatField('orientation_yaw', parseFloat(odom.value.yaw))
    
    writeApi.writePoint(point) // On met le point dans la boîte aux lettres
    // Optimisation : On ne force plus le flush() à chaque seconde.
    // On laisse le client InfluxDB grouper (batch) les envois en arrière-plan pour de meilleures performances.
  } catch (err) {
    console.error("Erreur d'écriture InfluxDB :", err)
  }
}, 1000)


// ----- Gestion des États et de l'UI -----

// ⚠️ AVIS ARCHITECTURE ROS2 :
// Détecter l'état via la réception de données brutes est imprécis.
// La bonne pratique (Standard ROS2) est d'utiliser `diagnostic_msgs` sur le topic `/diagnostics`
// où le robot publie un "Heartbeat" officiel de l'état de chaque composant (OK, WARN, ERROR).
//État de santé des capteurs
const sensors = ref({ 
  lidar: 'WAITING',
  camera: 'WAITING',
  map: 'WAITING'
})

// ⚠️ AVIS ARCHITECTURE ROS2 :
// Déduire l'état uniquement à partir de la vitesse (odom) est une approche limitée.
// Si le robot est bloqué physiquement mais que les moteurs tournent, le dashboard affichera "MOVING".
// L'approche industrielle : utiliser les Managed Nodes (Lifecycle) ou écouter le serveur
// d'action de navigation (ex: Nav2) pour connaître le véritable état logique du robot.
// L'état du robot se calcule tout seul en fonction de la vitesse !
const robotState = computed(() => {
  if(!connected.value) return 'OFFLINE'
  if(parseFloat(odom.value.linear_speed) !== 0 || parseFloat(odom.value.angular_speed) !==0) return 'MOVING'
  return 'IDLE' //Repos
})

// On crée une fonction pour obtenir le style CSS en fonction de l'état
const getStateColor = (state) => {
  switch (state) {
    case 'MOVING': return 'badge-green' // Vert
    case 'IDLE': return 'badge-yellow' // Orange
    case 'OFFLINE': return 'badge-red' // Rouge
    default: return ''
  }
}

// ----- Fonction Centrale de Connexion ROS (connectRos) -----

async function connectRos() {
  if (connecting.value || connected.value) return
  connecting.value = true
  
  try {
    // Création de la connexion vers ws://localhost:9090
    ros = new ROSLIB.Ros({ url: wsUrl.value })

    // Événement : Connexion réussie
    ros.on('connection', () => {
      connected.value = true
      connecting.value = false
      addLog('Connecté à ROSBridge !', 'success')
    })

    // ---- PUBLISHER /cmd_vel ----
    cmdVelTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/cmd_vel',
      messageType: 'geometry_msgs/msg/Twist'
    })

    // ---- ABONNEMENT À /odom ----
    const odomListener = new ROSLIB.Topic({
      ros: ros,
      name: '/odom',
      messageType: 'nav_msgs/msg/Odometry'
    })

    odomListener.subscribe((message) => {
      // On n'extrait plus que les vitesses depuis /odom (l'odométrie pure dérive)
      odom.value.linear_speed = message.twist.twist.linear.x.toFixed(2)
      odom.value.angular_speed = message.twist.twist.angular.z.toFixed(2)
    })
    // ----------------------------

    // ---- ABONNEMENT À /robot_pose (Position exacte sur la Carte SLAM) ----
    const poseListener = new ROSLIB.Topic({
      ros: ros,
      name: '/robot_pose',
      messageType: 'geometry_msgs/msg/PoseStamped'
    })

    poseListener.subscribe((message) => {
      // Extraction de la position X et Y sur la map
      odom.value.x = message.pose.position.x.toFixed(2)
      odom.value.y = message.pose.position.y.toFixed(2)

      // Extraction de l'angle Yaw
      const q = message.pose.orientation
      const siny_cosp = 2 * (q.w * q.z + q.x * q.y)
      const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
      odom.value.yaw = Math.atan2(siny_cosp, cosy_cosp).toFixed(2)
    })
    // ----------------------------

    // ---- ABONNEMENT À /map ----
    const mapListener = new ROSLIB.Topic({
      ros: ros,
      name: '/map',
      messageType: 'nav_msgs/msg/OccupancyGrid'
    })

    mapListener.subscribe((message) => {
      mapInfo.value = `Taille : ${message.info.width}x${message.info.height} (Résolution: ${message.info.resolution.toFixed(3)}m/px)`
      drawMap(message)
    })
    // ----------------------------

    // ---- ABONNEMENT AU LIDAR ----
    const lidarListener = new ROSLIB.Topic({
      ros: ros,
      name: '/scan',
      messageType: 'sensor_msgs/msg/LaserScan'
    })
    lidarListener.subscribe((message) => {
      drawLidar(message)
    })

    // Événement : Erreur
    ros.on('error', (error) => {
      connecting.value = false
      addLog("Erreur de connexion ROS", "error")
    })

    // Événement : Déconnexion
    ros.on('close', () => {
      connected.value = false
      connecting.value = false
      addLog("Déconnecté de ROSBridge", "error")
    })
  } catch (err) {
    addLog("Erreur d'import ou de connexion", "error")
    connecting.value = false
  }

  // ----------------------------

  // ---- ABONNEMENT AU DIAGNOSTICS (Heartbeat Capteurs) ----
  const diagListener = new ROSLIB.Topic({
    ros: ros,
    name: '/diagnostics',
    messageType : 'diagnostic_msgs/msg/DiagnosticArray'
  })

  diagListener.subscribe((message) => {
    // message.status est une liste (array) de tous les capteurs
    message.status.forEach((status) => {
      // Traduction du niveau d'erreur ROS2 (0=OK, 1= WARN, 2=ERROR, 3=STALE)
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

// ----- Système de Logs et Arrêt d'Urgence -----

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
    case 'error': return 'var(--accent-red)' // Rouge pour les pannes/urgences
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

// ---- Coordonnées Spatiales ----

//Convertit des mėtres (Monde ROS) en pixels (Canvas HTML)
function worldToCanvas(wx,wy){
  if(!mapData) return {px: 0, py: 0}
  const px = (wx - mapData.info.origin.position.x) / mapData.info.resolution
  const py = mapData.info.height -1 - ((wy - mapData.info.origin.position.y) / mapData.info.resolution)
  return {px, py}
}

// ----- Le Chef d'Orchestre Graphique (renderCanvas) -----

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



  // Couche 3 : On dessine le robot par dessus (Point Bleu)
  // 1. Le corps du robot (Cercle Bleu)
  mapCtx.beginPath()
  mapCtx.arc(px, py, 4, 0, 2*Math.PI)
  mapCtx.fillStyle = '#3b82f6' // Bleu
  mapCtx.fill()

  // 2. La flèche de direction (Ligne Noire)
  // On calcule un point virtuel situé 50 cm (0.5m) devant le robot
  const frontX = rx + (Math.cos(yawRobot) * 0.5) 
  const frontY = ry + (Math.sin(yawRobot) * 0.5)
  const {px: fpx, py: fpy} = worldToCanvas(frontX, frontY)
  
  mapCtx.beginPath()
  mapCtx.moveTo(px, py)
  mapCtx.lineTo(fpx, fpy)
  mapCtx.strokeStyle = '#000000' // Noir pour contraster avec le fond gris clair de la carte
  mapCtx.lineWidth = 3 // Trait plus épais
  mapCtx.stroke()

}

// ----- Le Relais du Lidar (drawLidar) -----

//Dessin du LIDAR
function drawLidar(msg) {
  currentScan = msg
}

// ----- LA GAME LOOP (Optimisation Industrielle) -----
let isLoopRunning = false
function startRenderLoop() {
  if (connected.value) {
    renderCanvas()
  }
  requestAnimationFrame(startRenderLoop)
}
// Démarrage de la boucle infinie dès le chargement du script
if (!isLoopRunning) {
  isLoopRunning = true
  requestAnimationFrame(startRenderLoop)
}

// ----- Dashboard Analytique (InfluxDB -> Chart.js) -----

// Plugin pour forcer un fond blanc (utile pour l'export PNG)
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
          data: { labels, datasets: [{ label: 'Batterie (%)', data: batteryData, borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, fill: true, backgroundColor: 'rgba(59,130,246,0.1)' }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } },
          plugins: [whiteBackgroundPlugin]
        })
      }

      // --- 2. GRAPHIQUE VITESSES ---
      const ctxSpd = document.getElementById('speedChart')
      if (ctxSpd) {
        if (speedChartInstance) speedChartInstance.destroy()
        const datasets = [
          { label: 'V. Linéaire (m/s)', data: linearSpeedData, borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, hidden: !showLinearSpeedLine.value },
          { label: 'V. Angulaire (rad/s)', data: angularSpeedData, borderColor: '#eab308', borderWidth: 2, pointRadius: 0, hidden: !showAngularSpeedLine.value }
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
        data: { labels: d.labels, datasets: [{ label: 'Batterie (%)', data: d.battery, borderColor: '#3b82f6', borderWidth: 2, pointRadius: 1, fill: true, backgroundColor: 'rgba(59,130,246,0.1)' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } },
        plugins: [whiteBackgroundPlugin]
      })
    } else if (chartType === 'speed') {
      const datasets = [
        { label: 'V. Linéaire (m/s)', data: d.linear, borderColor: '#ef4444', borderWidth: 2, pointRadius: 1, hidden: !showLinearSpeedLine.value },
        { label: 'V. Angulaire (rad/s)', data: d.angular, borderColor: '#eab308', borderWidth: 2, pointRadius: 1, hidden: !showAngularSpeedLine.value }
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
        data: { labels: [resetTimeLabel], datasets: [{ label: 'Batterie (%)', data: [100], borderColor: '#3b82f6', borderWidth: 2, pointRadius: 4, fill: true, backgroundColor: 'rgba(59,130,246,0.1)' }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } },
        plugins: [whiteBackgroundPlugin]
      })
    }
  }, 50)
}
</script>

<template>
  <div class="dashboard">
    <!-- HEADER : Barre du haut avec le logo et la connexion -->
    <header class="header">
      <div class="logo">
        <span style="font-size:28px">🤖</span>
        <div>
          <div style="font-size:16px; font-weight:700">Polebot AMR</div>
          <div style="font-size:11px; color:#475569">Analytics Dashboard</div>
        </div>
      </div>

      <div class="connection-bar">
        <!-- Champ pour l'URL WebSocket et Bouton de connexion -->
        <input v-model="wsUrl" class="ws-input" placeholder="ws://localhost:9090" :disabled="connected" />
        <button v-if="!connected" @click="connectRos" class="btn btn-primary" :disabled="connecting">
          {{ connecting ? '⏳ Connecting...' : '🔌 Connect' }}
        </button>
        <button v-else @click="disconnectRos" class="btn btn-danger">⏹ Disconnect</button>
        <!-- Statut de connexion et Batterie-->
        <div style="display:flex; align-items:center; gap:20px;">
          <!--Jauge de Batterie-->
          <div style="display:flex; align-items:center; font-size:14px; font-weight:700; background:var(--bg-card);
          padding:4px 12px; border-radius:20px; border:1px solid var(--border-color);">
            <span v-if="battery > 20" style="color:var(--accent-green)">🔋 {{ Math.round(battery) }}%</span>
            <span v-else style="color:var(--accent-red)">🪫 {{ Math.round(battery) }}%</span>
          </div>
        </div>
      </div>

      <!-- Statut de connexion et Heure -->
      <div style="display:flex; align-items:center; gap:16px">
        <span :class="['badge', connected ? 'badge-green' : 'badge-red']">
          <span :class="{ pulse: connected }">●</span>
          {{ connected ? 'ONLINE' : 'OFFLINE' }}
        </span>
      </div>
    </header>

    <!-- 1. LE MENU DES ONGLETS -->
    <div style="display:flex; gap:10px; padding: 10px 20px; background:var(--bg-secondary); border-bottom:1px solid var(--border-color);">
      <button class="btn" :style="activeTab === 'control' ? 'background:var(--accent-blue); color:white' : ''" @click="activeTab = 'control'">
        🎮 Live Control
      </button>
      <button class="btn" :style="activeTab === 'analytics' ? 'background:var(--accent-blue); color:white' : ''" @click="openAnalytics">
        📈 Historique Analytics
      </button>
    </div>

    <!-- 2. ONGLET ANALYTICS -->
    <div v-if="activeTab === 'analytics'" style="padding: 15px; flex: 1; display: flex; flex-direction: column; overflow-y: auto;">
      
      <!-- Barre d'outils globale -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px;">
        <h2 style="margin:0;">📊 Historique InfluxDB (Session complète)</h2>
        <button class="btn btn-reset" @click="resetChart" style="padding: 5px 10px; font-size:11px;">
          🔄 Reset
        </button>
      </div>

      <!-- Grille 2x2 des graphiques -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap:12px; flex:1;">
        
        <!-- 1. Batterie -->
        <div class="card chart-card" @click="expandedChart = 'battery'" style="min-height:250px; display:flex; flex-direction:column; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:13px;">🔋 Batterie</h3>
            <div style="display:flex; gap:10px; align-items:center;">
              <button class="btn btn-primary" @click.stop="downloadChart" style="padding: 4px 8px; font-size:10px;">
                💾 Save
              </button> 
              <span style="font-size:10px; color:var(--text-muted);">🔍 Click to enlarge</span>
            </div>
          </div>
          <div style="flex:1; position:relative; min-height:200px;">
            <canvas id="batteryChart"></canvas>
          </div>
        </div>

        <!-- 2. Vitesses -->
        <div class="card chart-card" @click="expandedChart = 'speed'" style="min-height:250px; display:flex; flex-direction:column; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:13px;">⚡ Vitesses</h3>
            <div style="display:flex; gap:8px; align-items:center;" @click.stop>
              <label style="font-size:10px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showLinearSpeedLine"> Linéaire
              </label>
              <label style="font-size:10px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showAngularSpeedLine"> Angulaire
              </label>
              <button class="btn btn-primary" @click="downloadChart" style="padding: 4px 8px; font-size:10px;">
                💾 Save
              </button> 
              <span style="font-size:10px; color:var(--text-muted);">🔍 Click to enlarge</span>
            </div>
          </div>
          <div style="flex:1; position:relative; min-height:200px;">
            <canvas id="speedChart"></canvas>
          </div>
        </div>

        <!-- 3. Trajectoire X/Y -->
        <div class="card chart-card" @click="expandedChart = 'trajectory'" style="min-height:250px; display:flex; flex-direction:column; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:13px;">🗺️ Trajectoire (X/Y)</h3>
            <div style="display:flex; gap:10px; align-items:center;">
              <button class="btn btn-primary" @click.stop="downloadChart" style="padding: 4px 8px; font-size:10px;">
                💾 Save
              </button> 
              <span style="font-size:10px; color:var(--text-muted);">🔍 Click to enlarge</span>
            </div>
          </div>
          <div style="flex:1; position:relative; min-height:200px;">
            <canvas id="trajectoryChart"></canvas>
          </div>
        </div>

        <!-- 4. Position au fil du temps -->
        <div class="card chart-card" @click="expandedChart = 'position'" style="min-height:250px; display:flex; flex-direction:column; cursor:pointer;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:13px;">📍 Position (Temps)</h3>
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
          <div style="flex:1; position:relative; min-height:200px;">
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
            {{ expandedChart === 'battery' ? '🔋 Batterie' : expandedChart === 'speed' ? '⚡ Vitesses' : expandedChart === 'trajectory' ? '🗺️ Trajectoire' : '📍 Position' }}
          </h2>
          <div style="display:flex; gap:10px; align-items:center;">
            <div v-if="expandedChart === 'speed'" style="display:flex; gap:10px;">
              <label style="font-size:12px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showLinearSpeedLine"> ⬆️ Linéaire
              </label>
              <label style="font-size:12px; cursor:pointer; color:var(--text-primary);">
                <input type="checkbox" v-model="showAngularSpeedLine"> 🔄 Angulaire
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
            <button class="btn btn-danger" @click="expandedChart = null" style="padding:5px 12px;">✕ Fermer</button>
          </div>
        </div>
        <div style="flex:1; position:relative;">
          <canvas id="expandedChartCanvas"></canvas>
        </div>
      </div>
    </div>

    <!-- 3. ONGLET CONTROL : GRID PRINCIPALE (Contient les 3 colonnes de notre dashboard) -->
    <main class="main-grid" v-show="activeTab === 'control'">
      <!-- Colonne GAUCHE (Données en direct) -->
      <div class="col">
        <div class="card">
          <h2>Position & Vitesses</h2>
          
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
              <div style="font-size:10px; color:var(--text-muted)">VITESSE LINÉAIRE</div>
              <div style="font-size:20px; font-family:monospace; color:var(--text-primary)">{{ odom.linear_speed }} m/s</div>
            </div>
            <div>
              <div style="font-size:10px; color:var(--text-muted)">VITESSE ANGULAIRE</div>
              <div style="font-size:20px; font-family:monospace; color:var(--text-primary)">{{ odom.angular_speed }} rad/s</div>
            </div>
          </div>

          <div class="card" style="margin-top: 10px;">
            <h2>Caméra Robot</h2>
            <img id="cameraStream" src="http://localhost:8080/stream?topic=/depth_camera/rgb/image_raw" 
                 style="width: 100%; border-radius: 8px; background: #000;" alt="Flux Vidéo ROS2" />
          </div>
        </div>
        <!-- CARTE : SYSTEM STATUS-->
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
            <h2>Carte Live (SLAM)</h2>
            <div style="font-size:10px; color:var(--text-muted); margin-bottom:8px">
              {{ mapInfo }}
            </div>
            <div style="display:flex; align-items:center; gap:16px; font-size:11px; color:var(--text-muted); margin-bottom:8px;">
              <!-- Curseur de Zoom -->
              <div style="display:flex; align-items:center; gap:8px;">
                <span>Zoom: {{ Math.round(mapZoom * 100) }}%</span>
                <input type="range" min="0.2" max="3" step="0.1" v-model="mapZoom" style="width:100px;">              
              </div>
            </div>

            <!-- C'est ici qu'on va dessiner la carte avec le zoom et le blocage des débordements -->
            <div style="flex:1; width:100%; border-radius:8px; background:var(--bg-secondary); overflow:hidden; display:flex; justify-content:center; align-items:center;">
              <canvas 
                ref="mapCanvas" 
                :style="{ transform: 'scale(' + mapZoom + ')' }"
              ></canvas>
            </div>
            
            <div style="display:flex; gap:16px; margin-top:12px; font-size:11px; color:var(--text-muted); justify-content:center">
              <span>🔵 Robot</span>
              <span>⬜ Vide</span>
              <span>🔴 Obstacle</span>
            </div>
        </div>
      </div>


      <!-- Colonne DROITE (Contrôles et Logs) -->
      <div class="col">
        
        <!-- Contrôle Manuel -->
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
            {{ isEStopActive ? "⚠️ ARRÊT D\'URGENCE VERROUILLÉ" : "🛑 MAINTENIR 1s POUR ARRÊT D\'URGENCE" }}
          </button>
          <h2>Contrôle Manuel</h2>
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
              <span>Vitesse Max (Avant) : {{ maxLinearSpeed }} m/s</span>
            </div>
            <input type="range" min="0.1" max="1.5" step="0.1" v-model.number="maxLinearSpeed" style="width:100%;">
            
            <div style="display:flex; justify-content:space-between; margin-bottom:5px; margin-top:10px;">
              <span>Vitesse Max (Rotation) : {{ maxAngularSpeed }} rad/s</span>
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
    </main>
  </div>
</template>

<style scoped>
/* Structure de la page */
.dashboard { display:flex; flex-direction:column; height:100vh; overflow:hidden; }

/* En-tête */
.header {
  display:flex; align-items:center; justify-content:space-between; padding:12px 20px;
  background:var(--bg-secondary); border-bottom:1px solid var(--border-color); flex-shrink:0;
}
.logo { display:flex; align-items:center; gap:12px; }
.connection-bar { display:flex; gap:8px; }
.ws-input {
  background:var(--bg-card); border:1px solid var(--border-color); color:var(--text-primary);
  padding:6px 12px; border-radius:8px; font-size:13px; width:220px; font-family:monospace;
}

/* Grille 3 colonnes */
.main-grid { 
    display:grid; 
    grid-template-columns:300px 1fr 300px; 
    gap:10px; padding:10px; flex:1; overflow:hidden; 
}
.col { display:flex; flex-direction:column; gap:10px; overflow-y:auto; }
.col-center { display:flex; flex-direction:column; overflow:hidden; }

/* Cartes (fonds gris) */
.card { 
    background:var(--bg-card); border:1px solid var(--border-color); 
    border-radius:12px; padding:14px; 
}
.chart-card { transition: transform 0.15s, box-shadow 0.15s; }
.chart-card:hover { transform: scale(1.02); box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
h2 { font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; }

/* Boutons de Contrôle */
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

/* Boutons */
.btn { padding:7px 14px; border-radius:8px; border:none; font-size:13px; font-weight:500; cursor:pointer; }
.btn-primary { background:var(--accent-blue); color:white; }
.btn-reset { background:var(--accent-yellow); color:white; }
.btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
.btn-danger { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }

/* Badges de statut */
.badge { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:20px; font-size:12px; font-weight:500; }
.badge-green { background:rgba(16,185,129,0.15); color:var(--accent-green); border:1px solid rgba(16,185,129,0.3); }
.badge-yellow { background:rgba(245,158,11,0.15); color:var(--accent-yellow); border:1px solid rgba(245,158,11,0.3); }
.badge-red { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }
.pulse { animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
</style>
