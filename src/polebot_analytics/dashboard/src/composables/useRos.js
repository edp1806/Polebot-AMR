import { ref } from 'vue'
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

let ros = null
let cmdVelTopic = null
let goalTopic = null
let cancelTopic = null
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
        
        // --- Proximity detection (<0.5m) ---
        if (message && message.ranges && message.ranges.length > 0) {
          let warning = false
          let minR = 999.0
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
  }

  // ----- Disconnect -----
  function disconnectRos(addLog) {
    if (ros) ros.close()
    if (velInterval) clearInterval(velInterval)
    if (connectTimeout) clearTimeout(connectTimeout)
    connected.value = false
    connecting.value = false
    addLog("Manual disconnect completed.", "info")
  }

  // ----- Manual Control -----
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
    if (!cancelTopic) return
    cancelTopic.publish({})
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
    sendNavGoal,
    cancelNavGoal,
    sendExplorationEnable,
    saveMap,
    clearMapSession,
    proximityWarning,
    minDetectedRange
  }
}
