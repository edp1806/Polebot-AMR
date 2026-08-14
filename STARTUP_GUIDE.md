# 🤖 Startup Guide — Polebot AMR
**Project**: Development of a Web-Based ROS Interface, Data Historian & Analytical Platform  
**Supervisor**: M. Wahyu Adhie CANDRA  
**Last updated**: June 2026

> ⚠️ **This guide is intended for authorized operators and technicians only.**  
> Never power on the robot when people are present in the robot's operating area.

---

## 📑 Table of Contents

1. [Pre-Power Checklist](#1-pre-power-checklist)
2. [Network Configuration](#2-network-configuration)
3. [Startup in SIMULATION Mode (Gazebo)](#3-startup-in-simulation-mode-gazebo)
4. [Startup on the PHYSICAL ROBOT](#4-startup-on-the-physical-robot)
5. [Launching the Web Dashboard](#5-launching-the-web-dashboard)
6. [Connecting & Using the Dashboard](#6-connecting--using-the-dashboard)
7. [Mobile Teleoperation (Phone)](#7-mobile-teleoperation-phone)
8. [Proper Shutdown Procedure](#8-proper-shutdown-procedure)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Pre-Power Checklist

Before powering anything on, verify the following:

- [ ] The **robot battery** is charged (green LED indicator on the chassis)
- [ ] No **obstacles** are present in the planned operating area (minimum 1 m radius)
- [ ] The **LiDAR Ethernet cable** is properly connected (Autonics LSC LiDAR → network switch)
- [ ] The **Orbbec Astra camera** is plugged in via USB to the robot's onboard PC
- [ ] The supervision PC (your computer) is **connected to the same Wi-Fi network** as the robot

---

## 2. Network Configuration

### System IP Addresses

| Equipment | IP Address | Port |
|---|---|---|
| Autonics LSC LiDAR | `192.168.0.1` | `8000` |
| Robot onboard PC | `192.168.0.X` *(to be confirmed)* | — |
| ROSBridge WebSocket | `<PC_IP>` | `9090` |
| Web Dashboard (Vite) | `<PC_IP>` | `5173` |
| InfluxDB | `<PC_IP>` | `8086` |

### Verify network connection with the LiDAR

From a terminal on the robot PC:
```bash
ping 192.168.0.1
```
If no response → check cables and network interface configuration.

---

## 3. Startup in SIMULATION Mode (Gazebo)

> Use this mode to test the dashboard **without the physical robot**.

### Step 1 — Prepare the ROS 2 environment

Open a terminal in the workspace folder:
```bash
cd /home/polebotamr01/Desktop/polebotamr/src/polman-mbd-ros2-polebot-amr
source /opt/ros/jazzy/setup.bash
colcon build
source install/setup.bash
```

### Step 2 — Launch the full simulation

This command starts everything at once: Gazebo, SLAM, Nav2, RViz, and the WebSocket bridge.
```bash
ros2 launch polebot_amr_bringup polebot_amr_sim_nav_webgui.launch.py
```

**What launches automatically:**
- 🌍 **Gazebo** — Physics simulator (`depot.sdf` world)
- 🗺️ **SLAM Toolbox** — Real-time mapping
- 🧭 **Nav2** — Autonomous navigation stack
- 🖥️ **RViz** — 3D ROS visualization
- 🌐 **ROSBridge WebSocket** — Communication bridge on port `9090`
- 📍 **pose_publisher** — ROS node that publishes robot position on `/robot_pose`

Wait for the console to display:
```
[rosbridge_websocket] Rosbridge WebSocket server started on port 9090
```
→ The system is ready.

---

## 4. Startup on the PHYSICAL ROBOT

> Use this mode for real tests and workshop operations.

### Step 1 — Prepare the ROS 2 environment

```bash
cd /home/polebotamr01/Desktop/polebotamr/src/polman-mbd-ros2-polebot-amr
source /opt/ros/jazzy/setup.bash
source install/setup.bash
```

### Step 2 — Launch sensors and navigation

```bash
ros2 launch polebot_amr_bringup polebot_amr_real_nav.launch.py
```

**What launches automatically:**
- 📡 **Autonics LSC LiDAR** — `lsc_ros2_driver`, IP `192.168.0.1`, port `8000`
- 📷 **Orbbec Astra Camera** — 640×480 resolution, 30 FPS
- 🗺️ **SLAM Toolbox** — Synchronous mode (`sync_slam_toolbox_node`)
- 🧭 **Nav2** — Full navigation stack
- 🖥️ **RViz** — 3D visualization (optional, use `use_rviz:=false` to disable)

### Step 3 — Launch WebSocket bridge (separate terminal)

```bash
source /opt/ros/jazzy/setup.bash && source install/setup.bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
```

### Step 4 — Launch position node (separate terminal)

```bash
ros2 run polebot_analytics pose_publisher
```

### Advanced options

```bash
# Launch without RViz (to save resources)
ros2 launch polebot_amr_bringup polebot_amr_real_nav.launch.py use_rviz:=false

# Launch with an existing map (localization only, no SLAM)
ros2 launch polebot_amr_bringup polebot_amr_real_nav.launch.py slam:=False map:=/path/to/map.yaml

# Launch physical joystick (gamepad)
ros2 launch polebot_amr_bringup polebot_amr_real_joy.launch.py
```

---

## 5. Launching the Web Dashboard

> The dashboard must be launched on the **supervision PC** (your computer).

### Step 1 — Start the Vite development server

```bash
cd /home/polebotamr01/Desktop/polebotamr/src/polman-mbd-ros2-polebot-amr/src/polebot_analytics/dashboard
npm run dev
```

The console will display something like:
```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://10.172.105.220:5173/
```

> ⚠️ **Important**: For your phone to access the dashboard, always use the **Network** URL (with your real IP), not `localhost`.

### Step 2 — Start InfluxDB (if not automatic)

```bash
influxd
```
Verify access at: `http://localhost:8086`

---

## 6. Connecting & Using the Dashboard

### Accessing the dashboard

Open your browser and go to:
```
http://<YOUR_IP>:5173
```
*(Example: `http://10.172.105.220:5173`)*

### Logging in

| Role | Username | Password | Permissions |
|---|---|---|---|
| **Administrator** | `polebot01` | `polebot@amr01` | Full robot control + analytics |
| **Operator 1** | `polebot02` | `polebot@amr02` | Read-only (no commands) |
| **Operator 2** | `polebot03` | `polebot@amr03` | Read-only (no commands) |

> 🔐 The session remains valid until the browser tab is closed.

### Connecting the dashboard to the robot

1. In the top bar, verify that the WebSocket URL is correct:
   ```
   ws://<ROBOT_OR_PC_IP>:9090
   ```
2. Click the blue **▶ Connect** button.
3. The badge should turn green: `● ROS2 Connected`.
4. The SLAM map will start appearing in the **Live Control** tab.

### Click-to-navigate on the map

1. Make sure the robot is connected and SLAM is active.
2. In the **Live Control** tab, click on a point on the 2D map.
3. A `goal_pose` navigation objective is sent automatically.
4. Click **❌ Cancel Goal** to abort the current mission.

---

## 7. Mobile Teleoperation (Phone)

> Reserved for the **Administrator** role only.

### First connection

1. On the dashboard (computer), click **📱 Pair Mobile Device** in the left sidebar.
2. A QR Code appears with the URL of the teleoperation page.
3. Scan the QR Code with your phone.
4. The `/teleop` page opens on your phone.
5. Log in with your admin credentials.
6. Enter the WebSocket URL and press **▶ Connect**.

### If the QR Code doesn't work

Your Wi-Fi IP may have changed. In the IP field of the pairing modal, correct the address.
To find your current IP:
```bash
hostname -I
```

Or enter directly in your phone's browser:
```
http://<IP_SHOWN_BY_VITE>:5173/teleop
```

### Mobile controls

| Control | Action |
|---|---|
| **▲ Up Button** | Move forward |
| **▼ Down Button** | Move backward |
| **◀ Left Button** | Turn left |
| **▶ Right Button** | Turn right |
| **⏹ Center Button** | Immediate stop |
| **HOLD 1s E-Stop** | Software emergency stop |

---

## 8. Proper Shutdown Procedure

Always follow this order to avoid data loss.

### On the Web Dashboard

1. Click **⏹ Disconnect** to properly close the WebSocket connection.  
   *(This automatically saves the session duration to InfluxDB)*
2. Close the browser tab.

### In ROS 2 terminals

Stop processes in the reverse order of launching:

```bash
# 1. Stop ROSBridge (Ctrl+C in the relevant terminal)
# 2. Stop pose_publisher (Ctrl+C)
# 3. Stop the main launch (Ctrl+C in the launch terminal)
```

Wait for all processes to terminate before powering off the robot.

### Physical robot shutdown

1. Verify the robot is stationary (speeds = 0).
2. Turn off the main chassis power switch.
3. Unplug USB and Ethernet cables for prolonged storage.

---

## 9. Troubleshooting

### ❌ "ROS2 Offline" — Dashboard cannot connect

| Possible cause | Check | Solution |
|---|---|---|
| ROSBridge not launched | `ros2 node list` → no `/rosbridge_websocket` | Launch the bridge (see step 3, section 4) |
| Wrong WebSocket IP | IP in the field doesn't match the robot PC | Correct with `hostname -I` |
| Firewall blocking | `sudo ufw status` | `sudo ufw allow 9090` |
| Wrong network | PC and robot on different networks | Connect to the same Wi-Fi |

### ❌ SLAM map does not appear

- Verify `/map` topic is publishing: `ros2 topic hz /map`
- If 0 Hz → SLAM not launched or LiDAR not connected
- Check LiDAR connection: `ping 192.168.0.1`

### ❌ LiDAR not publishing

```bash
# Check that the driver is running
ros2 node list | grep lidar

# Check raw data
ros2 topic echo /scan --once
```

### ❌ InfluxDB — No data in charts

```bash
# Check that InfluxDB is running
curl http://localhost:8086/ping

# Restart if necessary
influxd
```

### ❌ Phone cannot access the dashboard

1. Verify phone and computer are on the **same Wi-Fi**.
2. Get the correct IP: `hostname -I` in a terminal.
3. Enter `http://<IP>:5173` manually in the phone's browser.
4. Verify the firewall allows port 5173: `sudo ufw allow 5173`

### ❌ Emergency stop locked (E-Stop locked)

On the dashboard: Click the **🔧 Resolve E-Stop** button in the red banner.  
On the mobile page: Press **🔧 Unlock** below the E-Stop button.

---

*Guide written as part of an internship — Polman Bandung, 2026.*  
*For any questions, contact M. Wahyu Adhie CANDRA.*
