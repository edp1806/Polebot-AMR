<script setup>
import { ref, computed} from 'vue'
import * as ROSLIB from 'roslib'

// Nos variables réactives (si elles changent, l'interface se met à jour)
const wsUrl = ref('ws://localhost:9090')
const connected = ref(false)
const connecting = ref(false)
const mapCanvas = ref(null)
const mapInfo = ref('En attente de la carte...')
const battery = ref(100) // Batterie a 100% au départ
const mapRotation = ref(0) // Rotation de la carte en degrés
const maxLinearSpeed = ref(0.5)  // Vitesse d'avance (m/s)
const maxAngularSpeed = ref(0.5) // Vitesse de rotation (rad/s)
let mapCtx = null
let ros = null // L'objet qui gérera la connexion
let cmdVelTopic = null
let velInterval = null
let camCtx = null
let mapData = null
let mapImageData = null
let currentScan = null

// Variable réactive pour la position du robot
const odom = ref({
  x: '0.00',
  y: '0.00',
  yaw: '0.00',
  linear_speed: '0.00',
  angular_speed: '0.00'
})

//Décharge simulée de la batterie
setInterval(() => {
  // Si on est connecté et aue le robot bouge (vitesse non nulle)
  if(connected.value && (parseFloat(odom.value.linear_speed) !==0 || parseFloat(odom.value.angular_speed) !== 0)){
    battery.value = Math.max(0, battery.value - 0.1)// On perd 0.1% chaque seconde
  }
}, 1000)

//État de santé des capteurs
const sensors = ref({ 
  lidar: 'WAITING',
  camera: 'WAITING',
  map: 'WAITING'
})

// L'état du robot se calcule tout seul en fonction de la vitesse !
const robotState = computed(() => {
  if(!connected.value) return 'OFFLINE'
  if(parseFloat(odom.value.linear_speed) !== 0 || parseFloat(odom.value.angular_speed) !==0) return 'MOVING'
  return 'IDLE' //Repos
})

// On crée une fonction pour obtenir le style CSS en fonction de l'état
const getStateColor = (state) => {
  switch (state) {
    case 'MOVING': return 'from-green-400 to-emerald-600' // Vert
    case 'IDLE': return 'from-yellow-400 to-orange-600' // Orange
    case 'OFFLINE': return 'from-red-400 to-rose-600' // Rouge
    default: return 'from-slate-400 to-slate-600'
  }
}

// Fonction appelée quand on clique sur "Connect"
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
      console.log('Connecté à ROSBridge !')
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
      // Extraction de la position X et Y
      odom.value.x = message.pose.pose.position.x.toFixed(2)
      odom.value.y = message.pose.pose.position.y.toFixed(2)

      // Extraction des vitesses
      odom.value.linear_speed = message.twist.twist.linear.x.toFixed(2)
      odom.value.angular_speed = message.twist.twist.angular.z.toFixed(2)

      // Extraction de l'angle Yaw à partir du Quaternion
      const q = message.pose.pose.orientation
      const siny_cosp = 2 * (q.w * q.z + q.x * q.y)
      const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
      odom.value.yaw = Math.atan2(siny_cosp, cosy_cosp).toFixed(2)
      
      renderCanvas()
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
      sensors.value.map = 'ACTIVE'
    })
    // ----------------------------

    // ---- ABONNEMENT Ȧ LA CAMÉRA ----
    const cameraListener = new ROSLIB.Topic({
      ros: ros,
      name: '/depth_camera/rgb/image_raw',
      messageType: 'sensor_msgs/msg/Image'
    })
    cameraListener.subscribe((message) => {
      drawCamera(message)
      sensors.value.camera = 'ACTIVE'
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
      sensors.value.lidar = 'ACTIVE'
    })

    // Événement : Erreur
    ros.on('error', (error) => {
      connecting.value = false
      console.error('Erreur de connexion:', error)
    })

    // Événement : Déconnexion
    ros.on('close', () => {
      connected.value = false
      connecting.value = false
      console.warn('Déconnecté de ROSBridge')
    })
  } catch (err) {
    console.error("Erreur d'import ou de connexion :", err)
    connecting.value = false
  }
}

// ---- CONTRÔLE MANUEL ----
function startVel(linear, angular) {
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

function stopVel() {
  if (velInterval) clearInterval(velInterval)
  if (!cmdVelTopic || !connected.value) return
  
  const twist = {
    linear: { x: 0.0, y: 0.0, z: 0.0 },
    angular: { x: 0.0, y: 0.0, z: 0.0 }
  }
  cmdVelTopic.publish(twist)
}

// Fonction appelée quand on clique sur "Disconnect"
function disconnectRos() {
  if (ros) {
    ros.close()
  }
}
// ---- DESSINER LA CARTE ----
function drawMap(msg) {
  if (!mapCanvas.value) return
  if (!mapCtx) mapCtx = mapCanvas.value.getContext('2d')
  
  const width = mapCanvas.value.width = msg.info.width
  const height = mapCanvas.value.height = msg.info.height
  const imgData = mapCtx.createImageData(width, height)

  // ROS envoie la carte sous forme de tableau (0 = vide, 100 = mur, -1 = inconnu)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Calcul de l'index dans le tableau 1D
      const index = (y * width) + x
      const value = msg.data[index]
      
      // On dessine de bas en haut (ROS = origine en bas à gauche, HTML = origine en haut à gauche)
      const pixelIndex = ((height - 1 - y) * width + x) * 4

      if (value === -1) { // Inconnu (Gris foncé)
        imgData.data[pixelIndex] = 15; imgData.data[pixelIndex+1] = 22; imgData.data[pixelIndex+2] = 41;
      } else if (value === 0) { // Vide (Gris très clair)
        imgData.data[pixelIndex] = 220; imgData.data[pixelIndex+1] = 220; imgData.data[pixelIndex+2] = 225;
      } else { // Mur / Obstacle (Rouge vif pour bien le voir)
        imgData.data[pixelIndex] = 239; imgData.data[pixelIndex+1] = 68; imgData.data[pixelIndex+2] = 68;
      }
      imgData.data[pixelIndex+3] = 255 // Opacité (100%)
    }
  }
  
  // On ne dessine pas tout de suite, on la garde en mémoire !
  mapImageData = imgData
  mapData = msg
  renderCanvas() // On appelle le chef d'orchestre
}
// ---- DESSINER LA CAMÉRA ----
function drawCamera(msg) {
  const canvas = document.getElementById('cameraCanvas')
  if(!canvas) return
  if(!camCtx) camCtx = canvas.getContext('2d')

  //ROS envoie les pixels (Rouge, vert, Bleu) bruts en format Base64.
  // Il faut le décoder en binaire, puis l'afficher pixel par pixel.
  const binaryString = window.atob(msg.data)
  const imgData = camCtx.createImageData(msg.width, msg.height)

  for (let i=0; i<binaryString.length; i += 3){
    const pixelIndex = (i/3)*4
    imgData.data[pixelIndex] = binaryString.charCodeAt(i) //Rouge
    imgData.data[pixelIndex+1] = binaryString.charCodeAt(i+1) //Green
    imgData.data[pixelIndex+2] = binaryString.charCodeAt(i+2) //Blue
    imgData.data[pixelIndex+3] = 255 //Opacité (100%)
    }
  camCtx.putImageData(imgData, 0, 0)
}
//Convertit des mėtres (Monde ROS) en pixels (Canvas HTML)
function worldToCanvas(wx,wy){
  if(!mapData) return {px: 0, py: 0}
  const px = (wx - mapData.info.origin.position.x) / mapData.info.resolution
  const py = mapData.info.height -1 - ((wy - mapData.info.origin.position.y) / mapData.info.resolution)
  return {px, py}
}

//Le chef d'orchestre qui superpose tout !
function renderCanvas(){
  if(!mapCtx || !mapImageData) return

  //Couche 1 : On colle le fond (la carte)
  mapCtx.putImageData(mapImageData, 0, 0)

  //Couche 2 : On dessine le robot pqr dessus (Point Bleu)
  const rx = parseFloat(odom.value.x)
  const ry = parseFloat(odom.value.y)
  const {px, py} = worldToCanvas(rx, ry)

  mapCtx.beginPath()
  mapCtx.arc(px, py, 4, 0, 2*Math.PI)
  mapCtx.fillStyle = '#3b82f6' // Bleu
  mapCtx.fill()

    // Couche 1.5 : Le nuage de points du LiDAR
  if (currentScan) {
    const yaw = parseFloat(odom.value.yaw)
    const rx = parseFloat(odom.value.x)
    const ry = parseFloat(odom.value.y)
    
    mapCtx.fillStyle = '#22c55e' // Couleur verte pour les lasers
    
    // On boucle sur chaque rayon du LiDAR
    for (let i = 0; i < currentScan.ranges.length; i++) {
      const distance = currentScan.ranges[i]
      
      // On ignore les valeurs hors limites du capteur
      if (distance < currentScan.range_min || distance > currentScan.range_max) continue
      
      // Math : Angle du rayon + Rotation actuelle du robot
      const angle = currentScan.angle_min + (i * currentScan.angle_increment) + yaw
      
      // Math : On calcule où le laser a tapé dans le monde 2D (Cosinus = X, Sinus = Y)
      const pointX = rx + (distance * Math.cos(angle))
      const pointY = ry + (distance * Math.sin(angle))
      
      // On convertit les mètres en pixels et on dessine un point de 2x2
      const { px, py } = worldToCanvas(pointX, pointY)
      mapCtx.fillRect(px, py, 2, 2)
    }
  }

}

//Dessin du LIDAR
function drawLidar(msg) {
  currentScan = msg
  //Le LIDAR se met ȧ jour 10 fois par seconde, on force le dessin
  if (mapData) renderCanvas()
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

    <!-- GRID PRINCIPALE : Contient les 3 colonnes de notre dashboard -->
    <main class="main-grid">
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
            <canvas id="cameraCanvas" width="640" height="480" style="width: 100%; border-radius: 8px; background: #000;">
            </canvas>
          </div>
        </div>
        <!-- CARTE : SYSTEM STATUS-->
        <div class="card">
          <h2>System Status</h2>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; 
          border-bottom:1px solid var(--border-color); padding-bottom:10px;">
            <span style="font-size:12px; color:var(--text-muted)">ROBOT STATE</span>
            <span :class="['badge', robotState === 'MOVING' ? 'badge-green' : (robotState === 'IDLE' ? '' : 'badge-red')]">{{ robotState }}</span>
          </div>

          <div style="display:flex; flex-direction: column; gap:8px; font-size:12px;">
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted)">LIDAR (/scan)</span>
              <span :style="{ color: sensors.lidar === 'ACTIVE' ? 'var(--accent-green)' : 'var(--accent-red)'}">{{sensors.lidar}}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted)">Camera (/depth_camera)</span>
              <span :style="{ color: sensors.camera === 'ACTIVE' ? 'var(--accent-green)' : 'var(--accent-red)'}">{{sensors.camera}}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:var(--text-muted)">SLAM (/map)</span>
              <span :style="{ color: sensors.map === 'ACTIVE' ? 'var(--accent-green)' : 'var(--accent-red)'}">{{ sensors.map }}</span>
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
            <div style="display:flex; align-items:center; gap:8px; font-size:11px; color:var(--text-muted)">
              <span>Rotation: {{  mapRotation }}°</span>
              <input type="range" min="-180°" max="180°" v-model="mapRotation" style="width:100px;">
            </div>
            <!-- C'est ici qu'on va dessiner la carte -->
            <canvas ref="mapCanvas" style="flex:1; width:100%; border-radius:8px; background:var(--bg-secondary);" 
            :style="{transform: 'rotate(' + mapRotation + 'deg)'}"></canvas>
            
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
          <h2>Contrôle Manuel</h2>
          <div class="ctrl-grid">
            <div></div>
            <button class="ctrl-btn" @mousedown="startVel(maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel">▲</button>
            <div></div>
            <button class="ctrl-btn" @mousedown="startVel(0, maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel">◀</button>
            <button class="ctrl-btn ctrl-stop" @click="stopVel">⏹</button>
            <button class="ctrl-btn" @mousedown="startVel(0, -maxAngularSpeed)" @mouseup="stopVel" @mouseleave="stopVel">▶</button>
            <div></div>
            <button class="ctrl-btn" @mousedown="startVel(-maxLinearSpeed, 0)" @mouseup="stopVel" @mouseleave="stopVel">▼</button>
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
            <!-- On mettra les événements ici -->
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
.btn-primary:disabled { opacity:0.5; cursor:not-allowed; }
.btn-danger { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }

/* Badges de statut */
.badge { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:20px; font-size:12px; font-weight:500; }
.badge-green { background:rgba(16,185,129,0.15); color:var(--accent-green); border:1px solid rgba(16,185,129,0.3); }
.badge-red { background:rgba(239,68,68,0.15); color:var(--accent-red); border:1px solid rgba(239,68,68,0.3); }
.pulse { animation:pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
</style>
