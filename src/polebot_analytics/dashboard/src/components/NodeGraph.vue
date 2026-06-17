<script setup>
import { ref, computed } from 'vue'

const nodes = ref([
  // Sensors & Inputs
  { id: 'teleop', label: '/teleop_node', type: 'node', x: 50, y: 60, status: 'active' },
  { id: 'lidar', label: '/rplidar_node', type: 'node', x: 50, y: 180, status: 'active' },
  { id: 'camera', label: '/camera_node', type: 'node', x: 50, y: 300, status: 'warning' },
  
  // Topics (Intermediate)
  { id: 'cmd_vel', label: '/cmd_vel', type: 'topic', x: 250, y: 60, status: 'active' },
  { id: 'scan', label: '/scan', type: 'topic', x: 250, y: 180, status: 'active' },
  { id: 'image_raw', label: '/image_raw', type: 'topic', x: 250, y: 300, status: 'warning' },
  
  // Core Processing
  { id: 'base_ctrl', label: '/base_controller', type: 'node', x: 450, y: 60, status: 'active' },
  { id: 'slam', label: '/slam_toolbox', type: 'node', x: 450, y: 180, status: 'active' },
  { id: 'nav2', label: '/nav2_stack', type: 'node', x: 450, y: 300, status: 'active' },
  
  // Output Topics
  { id: 'odom', label: '/odom', type: 'topic', x: 650, y: 60, status: 'active' },
  { id: 'map', label: '/map', type: 'topic', x: 650, y: 180, status: 'active' },
  { id: 'path', label: '/plan', type: 'topic', x: 650, y: 300, status: 'active' },
  
  // Dashboard
  { id: 'dashboard', label: 'Polebot Dashboard', type: 'node', x: 850, y: 180, status: 'active', highlight: true },
])

const edges = ref([
  // Controls
  { source: 'teleop', target: 'cmd_vel' },
  { source: 'cmd_vel', target: 'base_ctrl' },
  { source: 'base_ctrl', target: 'odom' },
  // Lidar & SLAM
  { source: 'lidar', target: 'scan' },
  { source: 'scan', target: 'slam' },
  { source: 'slam', target: 'map' },
  // Nav2
  { source: 'scan', target: 'nav2' },
  { source: 'odom', target: 'nav2' },
  { source: 'map', target: 'nav2' },
  { source: 'nav2', target: 'path' },
  { source: 'nav2', target: 'cmd_vel' }, // Nav2 publishes to cmd_vel
  // Camera
  { source: 'camera', target: 'image_raw' },
  // Dashboard subscriptions
  { source: 'odom', target: 'dashboard' },
  { source: 'map', target: 'dashboard' },
  { source: 'path', target: 'dashboard' },
])

const hoveredNode = ref(null)

const getPath = (sourceId, targetId) => {
  const s = nodes.value.find(n => n.id === sourceId)
  const t = nodes.value.find(n => n.id === targetId)
  if (!s || !t) return ''
  
  // Offset to center of shapes (width: 140 for nodes, 100 for topics. Height: 40)
  const sx = s.x + (s.type === 'node' ? 140 : 100)
  const sy = s.y + 20
  const tx = t.x
  const ty = t.y + 20
  
  const cx = (sx + tx) / 2
  return `M ${sx} ${sy} C ${cx} ${sy}, ${cx} ${ty}, ${tx} ${ty}`
}
</script>

<template>
  <div style="padding: 25px; height: 100%; display: flex; flex-direction: column; overflow-y: auto;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
      <div style="display: flex; gap: 15px; font-size: 12px; color: var(--text-muted); background: var(--bg-card); padding: 8px 15px; border-radius: 8px; border: 1px solid var(--border-color);">
        <span style="display:flex; align-items:center; gap:8px;"><div style="width:14px; height:14px; background:var(--bg-card); border:2px solid var(--accent-blue); border-radius:50%;"></div> ROS2 Node</span>
        <span style="display:flex; align-items:center; gap:8px;"><div style="width:14px; height:14px; background:var(--bg-card); border:2px solid var(--accent-green);"></div> ROS2 Topic</span>
      </div>
    </div>
    
    <div class="card" style="flex: 1; min-height: 500px; position: relative; overflow: auto; display: flex; align-items: center; justify-content: center;">
      <div style="min-width: 1000px; height: 400px; position: relative;">
      <svg width="100%" height="100%" style="position: absolute; top: 0; left: 0;">
        <!-- Draw edges -->
        <g v-for="(edge, index) in edges" :key="`edge-${index}`">
          <path 
            :d="getPath(edge.source, edge.target)" 
            fill="none" 
            :stroke="(hoveredNode === edge.source || hoveredNode === edge.target) ? 'var(--accent-blue)' : 'var(--border-color)'" 
            :stroke-width="(hoveredNode === edge.source || hoveredNode === edge.target) ? 3 : 2"
            class="edge-path"
          />
          <!-- Animated data dots if active -->
          <circle r="4" fill="var(--accent-blue)" class="data-dot" v-if="hoveredNode === edge.source || hoveredNode === edge.target || nodes.find(n => n.id === edge.source).status === 'active'">
            <animateMotion :path="getPath(edge.source, edge.target)" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </g>
      </svg>
      
      <!-- Draw nodes -->
      <div v-for="node in nodes" :key="node.id" 
           @mouseenter="hoveredNode = node.id" 
           @mouseleave="hoveredNode = null"
           :class="['graph-node', node.type, node.status, { highlight: node.highlight, hovered: hoveredNode === node.id }]"
           :style="{ left: `${node.x}px`, top: `${node.y}px` }">
        {{ node.label }}
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.graph-node {
  position: absolute;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--bg-card);
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  cursor: pointer;
  transition: all 0.2s;
  z-index: 10;
}

.graph-node.node {
  width: 140px;
  border-radius: 20px;
  border: 2px solid var(--accent-blue);
}

.graph-node.topic {
  width: 100px;
  border-radius: 4px;
  border: 2px solid var(--accent-green);
}

.graph-node.warning {
  border-color: var(--accent-yellow);
  opacity: 0.7;
}

.graph-node.highlight {
  background: var(--accent-blue);
  color: white;
  border-color: var(--accent-blue);
}

.graph-node:hover, .graph-node.hovered {
  transform: scale(1.1);
  box-shadow: 0 8px 15px rgba(0,0,0,0.2);
  z-index: 20;
}

.edge-path {
  transition: stroke 0.2s, stroke-width 0.2s;
}

.data-dot {
  opacity: 0.7;
}
</style>
