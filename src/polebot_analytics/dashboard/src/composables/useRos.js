import { ref } from 'vue'
import * as ROSLIB from 'roslib'

// --- État singleton (partagé entre tous les composants) ---
export const connected = ref(false)
export const connecting = ref(false)
export const odom = ref({
  x: '0.00',
  y: '0.00',
  yaw: '0.00',
  linear_speed: '0.00',
  angular_speed: '0.00'
})
export const mapInfo = ref('Waiting for map...')
export const sensors = ref({
  lidar: 'WAITING',
  camera: 'WAITING',
  map: 'WAITING'
})

let ros = null
let cmdVelTopic = null
let velInterval = null
let connectTimeout = null

export function useRos() {

  // ----- Central ROS Connection Function -----
  async function connectRos(wsUrl, addLog, drawMap, drawLidar) {
    if (connecting.value || connected.value) return
    connecting.value = true

    try {
      ros = new ROSLIB.Ros({ url: wsUrl })

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
        odom.value.linear_speed = message.twist.twist.linear.x.toFixed(2)
        odom.value.angular_speed = message.twist.twist.angular.z.toFixed(2)
      })

      // ---- SUBSCRIPTION TO /robot_pose ----
      const poseListener = new ROSLIB.Topic({
        ros: ros,
        name: '/robot_pose',
        messageType: 'geometry_msgs/msg/PoseStamped'
      })
      poseListener.subscribe((message) => {
        odom.value.x = message.pose.position.x.toFixed(2)
        odom.value.y = message.pose.position.y.toFixed(2)
        const q = message.pose.orientation
        const siny_cosp = 2 * (q.w * q.z + q.x * q.y)
        const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
        odom.value.yaw = Math.atan2(siny_cosp, cosy_cosp).toFixed(2)
      })

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

      // ---- SUBSCRIPTION TO LIDAR ----
      const lidarListener = new ROSLIB.Topic({
        ros: ros,
        name: '/scan',
        messageType: 'sensor_msgs/msg/LaserScan'
      })
      lidarListener.subscribe((message) => {
        drawLidar(message)
      })

      ros.on('error', () => {
        connecting.value = false
        addLog("ROS connection error", "error")
      })

      ros.on('close', () => {
        connected.value = false
        connecting.value = false
        addLog("Disconnected from ROSBridge", "error")
      })

    } catch (err) {
      addLog("Import or connection error", "error")
      connecting.value = false
    }

    // ---- SUBSCRIPTION TO DIAGNOSTICS ----
    const diagListener = new ROSLIB.Topic({
      ros: ros,
      name: '/diagnostics',
      messageType: 'diagnostic_msgs/msg/DiagnosticArray'
    })
    diagListener.subscribe((message) => {
      message.status.forEach((status) => {
        let stateStr = 'UNKNOWN'
        if (status.level === 0) stateStr = 'OK'
        else if (status.level === 1) stateStr = 'WARN'
        else if (status.level === 2) stateStr = 'ERROR'
        else if (status.level === 3) stateStr = 'STALE'

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

  // ----- Déconnexion -----
  function disconnectRos(addLog) {
    if (ros) ros.close()
    if (velInterval) clearInterval(velInterval)
    if (connectTimeout) clearTimeout(connectTimeout)
    connected.value = false
    connecting.value = false
    addLog("Déconnexion manuelle effectuée.", "info")
  }

  // ----- Contrôle Manuel -----
  function startVel(linear, angular, isEStopActive) {
    if (isEStopActive.value) return
    if (!cmdVelTopic || !connected.value) return
    if (velInterval) clearInterval(velInterval)

    velInterval = setInterval(() => {
      const twist = {
        linear: { x: linear, y: 0.0, z: 0.0 },
        angular: { x: 0.0, y: 0.0, z: angular }
      }
      cmdVelTopic.publish(twist)
    }, 100)
  }

  // ⚠️ AVIS ARCHITECTURE ROS2 : utiliser twist_mux pour la priorité des commandes
  function stopVel() {
    if (velInterval) clearInterval(velInterval)
    if (!cmdVelTopic || !connected.value) return

    const twist = { linear: { x: 0.0, y: 0.0, z: 0.0 }, angular: { x: 0.0, y: 0.0, z: 0.0 } }
    let stopTicks = 0
    velInterval = setInterval(() => {
      cmdVelTopic.publish(twist)
      stopTicks++
      if (stopTicks >= 4) clearInterval(velInterval)
    }, 100)
  }

  return {
    connected,
    connecting,
    odom,
    mapInfo,
    sensors,
    connectRos,
    disconnectRos,
    startVel,
    stopVel
  }
}
