import { ref, watch } from 'vue'
import * as ROSLIB from 'roslib'

// --- Singleton state (shared across all components) ---
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
export const proximityWarning = ref(false)
export const minDetectedRange = ref(999.0)
export const sensors = ref({
  lidar: 'WAITING',
  camera: 'WAITING',
  map: 'WAITING'
})

export const connectionPing = ref(null)
export const isLowBandwidthMode = ref(false)

// Real-time topic statistics
export const topicRates = ref({
  odom: { name: '/odom', type: 'nav_msgs/Odometry', hz: 0, count: 0, status: 'OFFLINE', lastTime: null },
  scan: { name: '/scan', type: 'sensor_msgs/LaserScan', hz: 0, count: 0, status: 'OFFLINE', lastTime: null },
  map: { name: '/map', type: 'nav_msgs/OccupancyGrid', hz: 0, count: 0, status: 'OFFLINE', lastTime: null }
})

export const isDemoMode = ref(false)

let ros = null
let cmdVelTopic = null
let goalTopic = null
let cancelTopic = null
let velInterval = null
let connectTimeout = null
let pingInterval = null
let mapCounter = 0
let demoInterval = null
let demoTime = 0

watch(isDemoMode, (newVal) => {
  if (newVal) {
    // Enable demo mode
    connected.value = true
    connecting.value = false
    connectionPing.value = 12
    console.log('💻 Demo Mode activated! Simulating robot telemetry.')

    //Activer les status des noeuds
    sensors.value.lidar = 'OK'
    sensors.value.camera = 'OK'
    sensors.value.map = 'OK'

    demoInterval = setInterval(() => {
      demoTime += 0.05

      //simuler une trajectoire en cercle (X et Y tournent)
      const radius = 2.5
      const x = radius * Math.cos(demoTime)
      const y = radius * Math.sin(demoTime)
      const yaw = (demoTime % (2 * Math.PI)) - Math.PI

      odom.value.x = x.toFixed(2)
      odom.value.y = y.toFixed(2)
      odom.value.yaw = yaw.toFixed(2)
      odom.value.linear_speed = '0.35'
      odom.value.angular_speed = '0.15'

      // Simulate stable frequencies for diagnostics page
      topicRates.value.odom.hz = 50
      topicRates.value.odom.status = 'OK'

      topicRates.value.scan.hz = 10
      topicRates.value.scan.status = 'OK'

      topicRates.value.map.hz = 1
      topicRates.value.map.status = 'OK'

      // Realistic latency fluctuation
      connectionPing.value = Math.round(12 + Math.random() * 5)
    }, 100)

  } else {
    // Disable demo mode
    if (demoInterval) {
      clearInterval(demoInterval)
      demoInterval = null
    }
    connected.value = false
    connectionPing.value = null
    odom.value = { x: '0.00', y: '0.00', yaw: '0.00', linear_speed: '0.00', angular_speed: '0.00' }

    // Reset diagnostics
    Object.keys(topicRates.value).forEach(key => {
      topicRates.value[key].hz = 0
      topicRates.value[key].status = 'OFFLINE'
    })

    console.log('💻 Demo Mode disabled.')

  }
})

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

        pingInterval = setInterval(() => {
          if (!connected.value || !ros) return
          // console.log("[Ping] Attempting to call parameter service...");
          const start = performance.now()

          const paramService = new ROSLIB.Service({
            ros: ros,
            name: '/rosbridge_websocket/get_parameters',
            serviceType: 'rcl_interfaces/srv/GetParameters'
          })

          const request = {
            names: ['port']
          }

          paramService.callService(request, (res) => {
            const end = performance.now()
            const latency = Math.round(end - start)
            connectionPing.value = latency
            // console.log(`[Ping] Success! Latency measured: ${latency} ms. Low bandwidth mode: ${latency >= 150}`);

            // Auto low-bandwidth mode if ping is high (>= 150ms)
            isLowBandwidthMode.value = (latency >= 150)
          }, (err) => {
            console.warn("[Ping] Failed to call service. Error:", err);
            connectionPing.value = null
          })
        }, 3000)
      })

      // ---- PUBLISHER /cmd_vel ----
      cmdVelTopic = new ROSLIB.Topic({
        ros: ros,
        name: '/cmd_vel',
        messageType: 'geometry_msgs/msg/Twist'
      })

      // ---- PUBLISHER /goal_pose ----
      goalTopic = new ROSLIB.Topic({
        ros: ros,
        name: '/goal_pose',
        messageType: 'geometry_msgs/msg/PoseStamped'
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
        topicRates.value.odom.count++
        topicRates.value.odom.lastTime = Date.now()
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
        topicRates.value.map.count++
        topicRates.value.map.lastTime = Date.now()
        if (isLowBandwidthMode.value) {
          mapCounter++
          // Draw only 1 out of every 5 map messages under low bandwidth
          if (mapCounter % 5 !== 0) return
        }
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

        // --- Proximity detection (<0.5m) ---
        if (message && message.ranges && message.ranges.length > 0) {
          let warning = false
          let minR = 999.0
          topicRates.value.scan.count++
          topicRates.value.scan.lastTime = Date.now()
          const rMin = message.range_min || 0.1
          const rMax = message.range_max || 10.0

          for (let i = 0; i < message.ranges.length; i++) {
            const r = message.ranges[i]
            // Skip invalid/zero ranges
            if (r > rMin && r < rMax && !isNaN(r)) {
              if (r < minR) minR = r
              if (r < 0.5) warning = true
            }
          }
          proximityWarning.value = warning
          minDetectedRange.value = minR
        } else {
          topicRates.value.scan.count++
          topicRates.value.scan.lastTime = Date.now()
          proximityWarning.value = false
          minDetectedRange.value = 999.0
        }
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

    //Calcul des Hz toutes les secondes
    ratesInterval = setInterval(() => {
      const now = Date.now()
      Object.keys(topicRates.value).forEach((key) => {
        const topic = topicRates.value[key]
        if (!connected.value) {
          topic.hz = 0
          topic.status = 'OFFLINE'
          topic.count = 0
          return
        }
        topic.hz = topic.count // Hz matches the number of msgs received in the last second
        topic.count = 0 // Reset for the next second
        // Status evaluation
        if (topic.lastTime && (now - topic.lastTime < 3000)) {
          topic.status = topic.hz > 0 ? 'OK' : 'STALE'
        } else {
          topic.status = 'ERROR' // Aucun message depuis plus de 3 secondes
        }
      })
    }, 1000)
  }


  // ----- Disconnect -----
  function disconnectRos(addLog) {
    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }
    connectionPing.value = null
    isLowBandwidthMode.value = false
    mapCounter = 0

    if (ros) ros.close()
    if (velInterval) clearInterval(velInterval)
    if (connectTimeout) clearTimeout(connectTimeout)
    connected.value = false
    connecting.value = false
    addLog("Manual disconnect completed.", "info")

    if (ratesInterval) {
      clearInterval(ratesInterval)
      ratesInterval = null
    }
    // Reset values
    Object.keys(topicRates.value).forEach(key => {
      topicRates.value[key].hz = 0
      topicRates.value[key].status = 'OFFLINE'
      topicRates.value[key].count = 0
      topicRates.value[key].lastTime = null
    })
  }

  // ----- Manual Control -----
  function publishVel(linear, angular) {
    if (!cmdVelTopic || !connected.value) return
    const twist = {
      linear: { x: linear, y: 0.0, z: 0.0 },
      angular: { x: 0.0, y: 0.0, z: angular }
    }
    cmdVelTopic.publish(twist)
  }

  function startVel(linear, angular, isEStopActive) {
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

  // ⚠️ ROS2 ARCHITECTURE NOTE: use twist_mux for command priorities
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

  function sendNavGoal(wx, wy) {
    console.log("=== sendNavGoal ===");
    console.log("wx:", wx, "wy:", wy);
    console.log("goalTopic:", goalTopic);
    console.log("connected.value:", connected.value);

    if (!goalTopic) {
      console.error("goalTopic is not initialized! Trying to initialize it now...");
      if (ros) {
        goalTopic = new ROSLIB.Topic({
          ros: ros,
          name: '/goal_pose',
          messageType: 'geometry_msgs/msg/PoseStamped'
        });
        console.log("goalTopic initialized dynamically:", goalTopic);
      } else {
        console.error("ros object is also null!");
        return;
      }
    }

    const goalMsg = {
      header: {
        frame_id: 'map',
        stamp: {
          sec: 0,
          nanosec: 0
        }
      },
      pose: {
        position: { x: wx, y: wy, z: 0.0 },
        orientation: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 } // Facing forward by default
      }
    }
    console.log("Publishing goalMsg (Zero Timestamp for sim time compatibility):", goalMsg);
    try {
      goalTopic.publish(goalMsg);
      console.log("Successfully published to /goal_pose topic via ROSLIBJS");
    } catch (e) {
      console.error("Error publishing goal message:", e);
    }
  }

  function cancelNavGoal() {
    if (!ros || !connected.value) return

    // 1. Robust fallback: Publish current odometry position as destination to immediately stop the robot
    const rx = parseFloat(odom.value.x)
    const ry = parseFloat(odom.value.y)
    if (!isNaN(rx) && !isNaN(ry)) {
      sendNavGoal(rx, ry)
    }

    // 2. Action ROS 2 standard : Appeler le service d'annulation avec un UUID vide pour annuler tous les buts actifs
    const request = {
      goal_info: {
        goal_id: {
          uuid: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
        }
      }
    }
    const client = new ROSLIB.Service({
      ros: ros,
      name: '/navigate_to_pose/_action/cancel',
      serviceType: 'action_msgs/srv/CancelGoal'
    })
    client.callService(request, (result) => {
      console.log('ROS2 action cancelled successfully. Result:', result)
    }, (error) => {
      console.warn('Service d\'annulation d\'action non disponible (silencieux si hors Nav2) :', error)
    })
  }

  function sendExplorationEnable(enable) {
    if (!ros) return
    const exploreTopic = new ROSLIB['Topic']({
      ros: ros,
      name: '/explore_enable',
      messageType: 'std_msgs/Bool'
    })
    exploreTopic.publish({ data: enable })
  }

  function saveMap() {
    if (!ros) return
    const topic = new ROSLIB['Topic']({
      ros: ros,
      name: '/map_command',
      messageType: 'std_msgs/String'
    })
    topic.publish({ data: 'save' })
    console.log("Map save command sent!")
  }

  function clearMapSession() {
    if (!ros) return
    const topic = new ROSLIB['Topic']({
      ros: ros,
      name: '/map_command',
      messageType: 'std_msgs/String'
    })
    topic.publish({ data: 'clear' })
    console.log("Map clear command sent!")
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
    stopVel,
    publishVel,
    sendNavGoal,
    cancelNavGoal,
    sendExplorationEnable,
    saveMap,
    clearMapSession,
    proximityWarning,
    minDetectedRange,
    connectionPing,
    isLowBandwidthMode,
    topicRates,
    isDemoMode
  }
}
