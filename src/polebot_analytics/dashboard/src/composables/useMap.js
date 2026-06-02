import { ref } from 'vue'

// --- Singleton state ---
export const mapZoom = ref(1)
export const showLidar = ref(true)
export const mapCanvasRef = ref(null) // Shared with LiveControl.vue (template ref)
export const activeGoal = ref(null) // Selected destination
export let currentScan = null

let mapCtx = null
let mapData = null
let mapImageData = null

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

mapWorker.onmessage = function (e) {
  const { pixelData, width, height } = e.data;
  mapImageData = new ImageData(pixelData, width, height);
};

export function useMap() {

  // Function that sends the map to the Web Worker for background calculation
  function drawMap(msg) {
    const canvas = mapCanvasRef.value
    if (!canvas) return
    mapCtx = canvas.getContext('2d')
    canvas.width = msg.info.width
    canvas.height = msg.info.height
    mapData = msg
    mapWorker.postMessage({
      data: msg.data,
      width: msg.info.width,
      height: msg.info.height
    })
  }

  // ---- Spatial Coordinates ----
  // Convert meters (ROS World) to pixels (HTML Canvas)
  function worldToCanvas(wx, wy) {
    if (!mapData) return { px: 0, py: 0 }
    const px = (wx - mapData.info.origin.position.x) / mapData.info.resolution
    const py = mapData.info.height - 1 - ((wy - mapData.info.origin.position.y) / mapData.info.resolution)
    return { px, py }
  }

  // Convert pixels (HTML Canvas) to meters (ROS World)
  function canvasToWorld(px, py) {
    if (!mapData) return { wx: 0, wy: 0 }
    const wx = (px * mapData.info.resolution) + mapData.info.origin.position.x
    const wy = ((mapData.info.height - 1 - py) * mapData.info.resolution) + mapData.info.origin.position.y
    return { wx, wy }
  }

  function setGoal(wx, wy) {
    activeGoal.value = { x: wx, y: wy }
  }

  function clearGoal() {
    activeGoal.value = null
  }

  // ----- The Graphical Conductor (renderCanvas) -----
  function renderCanvas(odom) {
    const canvas = mapCanvasRef.value
    if (canvas && !mapCtx) mapCtx = canvas.getContext('2d')
    if (!mapCtx || !mapImageData) return

    // Clear canvas before drawing (in case the map is smaller than the canvas or transparent)
    mapCtx.clearRect(0, 0, canvas.width, canvas.height)

    // Layer 1: Draw the map background
    mapCtx.putImageData(mapImageData, 0, 0)

    // Layer 2: Draw the robot on top (Blue Point)
    const rx = parseFloat(odom.x)
    const ry = parseFloat(odom.y)
    const yawRobot = parseFloat(odom.yaw)
    const { px, py } = worldToCanvas(rx, ry)

    // Layer 3: Draw the robot on top (Blue Point)
    // 1. The robot body (Blue Circle)
    mapCtx.beginPath()
    mapCtx.arc(px, py, 4, 0, 2 * Math.PI)
    mapCtx.fillStyle = '#3b82f6' // Blue
    mapCtx.fill()

    // 2. Direction arrow (Black Line)
    const frontX = rx + (Math.cos(yawRobot) * 0.5)
    const frontY = ry + (Math.sin(yawRobot) * 0.5)
    const { px: fpx, py: fpy } = worldToCanvas(frontX, frontY)

    mapCtx.beginPath()
    mapCtx.moveTo(px, py)
    mapCtx.lineTo(fpx, fpy)
    mapCtx.strokeStyle = '#000000'
    mapCtx.lineWidth = 3
    mapCtx.stroke()

    // Layer 4: Draw the Goal if it exists (Red Target)
    if (activeGoal.value) {
      const g = worldToCanvas(activeGoal.value.x, activeGoal.value.y)

      // Giant cross for debugging
      mapCtx.beginPath()
      mapCtx.moveTo(g.px - 20, g.py)
      mapCtx.lineTo(g.px + 20, g.py)
      mapCtx.moveTo(g.px, g.py - 20)
      mapCtx.lineTo(g.px, g.py + 20)
      mapCtx.strokeStyle = '#ef4444' // Red
      mapCtx.lineWidth = 4
      mapCtx.stroke()

      // Central dot
      mapCtx.beginPath()
      mapCtx.arc(g.px, g.py, 8, 0, 2 * Math.PI)
      mapCtx.fillStyle = '#ef4444' // Red
      mapCtx.fill()
      mapCtx.strokeStyle = '#ffffff' // White border
      mapCtx.lineWidth = 3
      mapCtx.stroke()
    }
  }

  // ----- Lidar Relayer (drawLidar) -----
  function drawLidar(msg) {
    currentScan = msg
  }

  return {
    mapZoom,
    showLidar,
    mapCanvasRef,
    drawMap,
    worldToCanvas,
    canvasToWorld,
    setGoal,
    clearGoal,
    activeGoal,
    renderCanvas,
    drawLidar
  }
}
