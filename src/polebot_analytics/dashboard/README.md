# 🤖 Polebot AMR - Fleet Manager Dashboard

![Vue.js](https://img.shields.io/badge/Vue.js-35495E?style=for-the-badge&logo=vue.js&logoColor=4FC08D)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E)
![ROS2](https://img.shields.io/badge/ROS2-22314E?style=for-the-badge&logo=ros&logoColor=white)
![InfluxDB](https://img.shields.io/badge/InfluxDB-22ADF6?style=for-the-badge&logo=InfluxDB&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)

Welcome to the **Polebot AMR Dashboard**, a state-of-the-art web interface designed to control, supervise, and analyze your Autonomous Mobile Robots (AMR). 

This project was built to replace basic teleoperation tools with a fully integrated, industrial-grade Fleet Management System. It communicates directly with ROS2 via `rosbridge_suite` and stores telemetry data in `InfluxDB` for long-term analytics.

---

## 🌟 Key Features

### 1. 🎮 Live Control & Teleoperation
* **Real-time Map Rendering**: View the SLAM map dynamically fetched from the `/map` topic.
* **Autonomous Navigation**: Send 2D NavGoals directly by clicking on the map.
* **Manual Override**: D-pad and keyboard controls for precision teleoperation.
* **Camera Feed Integration**: Monitor the robot's point of view in real-time.
* **Safety HUD**: Visual alerts (blue borders for mission cancellation, red for emergencies).

### 2. 🛡️ Operator Panel
* **Emergency Stop (E-Stop)**: Immediate software halt directly from the dashboard.
* **Live System Status**: Instant view of connection latency, bandwidth mode, and battery levels.
* **Alarm Banners**: Reactive UI that highlights errors and warnings.

### 3. 📈 Analytics & Data Historian
* **InfluxDB Integration**: Persists all critical metrics (Speed, Battery, Trajectory).
* **Interactive Chart.js Graphs**: Filter data by the last 5 minutes up to 12 hours.
* **Trajectory Mapping**: View historical path lines overlaying the physical layout.

### 4. 📊 KPI Dashboard
* **Predictive Insights**: Automatically calculates `Movement Efficiency` (%) and `Stability Index` (jerk/shock detection).
* **Exportable Reports**: Generate PDF session reports and CSV data exports with a single click.
* **Session Tracking**: Maintains a history table of all past robot operations.

### 5. 🩺 System Diagnostics & Architecture
* **Node Graph Visualization**: An interactive, animated diagram showing the live data flow between ROS2 nodes (`/teleop`, `/nav2`, `/slam_toolbox`).
* **Topic Frequency Monitor**: Ensures sensors are publishing at the expected Hz rates.
* **Hardware Health**: Simulated CPU, RAM, and internal sensor temperatures.

### 6. 🔧 Predictive Maintenance
* **Component Health Tracking**: Monitors wear and tear on Drive Motors, Mecanum Wheels, and the Lidar scanner.
* **Service Estimator**: Predicts the remaining distance before calibration or parts replacement is required.

### 7. 🔐 Dynamic Role Management
* **Secure Access**: The dashboard is locked behind a login screen.
* **Admin View (`polebot01`)**: Full access to Analytics, KPIs, Diagnostics, and Maintenance.
* **Operator View (`polebot02`)**: Simplified interface restricted to Live Control and the Operator Panel to prevent accidental misconfigurations.

---

## 🛠️ Architecture & Tech Stack

* **Frontend Framework**: Vue 3 (Composition API) + Vite
* **Routing**: Vue Router (URL Parameter based `?tab=...` for multi-window support)
* **Styling**: Vanilla CSS with CSS Variables (Supporting both `Deep Space` and `Light` themes)
* **ROS2 Middleware**: `roslibjs` communicating with `rosbridge_server` over WebSockets (ws://localhost:9090)
* **Time-Series Database**: `@influxdata/influxdb-client` for persistent telemetry metrics.

---

## 🚀 How to Run

### Prerequisites
1. Node.js (v16+)
2. InfluxDB (running locally or remotely)
3. ROS2 environment with `rosbridge_suite`

### Installation
1. Navigate to the dashboard directory:
   ```bash
   cd src/polebot_analytics/dashboard
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

### Connecting to the Robot
1. Launch your ROS2 simulation or physical robot nodes.
2. Launch the rosbridge server:
   ```bash
   ros2 launch rosbridge_server rosbridge_websocket_launch.xml
   ```
3. Open the dashboard in your browser (usually `http://localhost:5173`).
4. **Log in** using default Admin credentials:
   * **Username**: `polebot01`
   * **Password**: `polebot@amr01`

---

## 🎨 Theming
The dashboard supports dual themes. Click the `🌙 Dark` / `☀️ Light` button in the top header to instantly switch between the high-contrast Deep Space environment and the clean, daylight-readable Light mode.

## 🤝 Contributing
This dashboard was significantly refactored to prioritize professional UI/UX and robust robotic data handling. Future implementations could include the HTML5 Gamepad API for joystick control or 3D point cloud rendering.
