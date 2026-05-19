import { ref } from 'vue'

// --- État singleton ---
export const mapZoom = ref(1)
export const showLidar = ref(true)
export const mapCanvasRef = ref(null) // Partagé avec LiveControl.vue (template ref)

let mapCtx = null
let mapData = null
let mapImageData = null
export let currentScan = null

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

export function useMap() {

  // Fonction qui transmet la carte au Web Worker pour un dessin en arrière-plan
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
  // Convertit des mètres (Monde ROS) en pixels (Canvas HTML)
  function worldToCanvas(wx, wy) {
    if (!mapData) return { px: 0, py: 0 }
    const px = (wx - mapData.info.origin.position.x) / mapData.info.resolution
    const py = mapData.info.height - 1 - ((wy - mapData.info.origin.position.y) / mapData.info.resolution)
    return { px, py }
  }

  // ----- The Graphical Conductor (renderCanvas) -----
  function renderCanvas(odom) {
    const canvas = mapCanvasRef.value
    if (canvas && !mapCtx) mapCtx = canvas.getContext('2d')
    if (!mapCtx || !mapImageData) return

    // Clear canvas before drawing (in case the map is smaller than the canvas or transparent)
    mapCtx.clearRect(0, 0, canvas.width, canvas.height)

    // Couche 1 : On colle le fond (la carte)
    mapCtx.putImageData(mapImageData, 0, 0)

    // Couche 2 : On dessine le robot par dessus (Point Bleu)
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
  }

  // ----- Le Relais du Lidar (drawLidar) -----
  function drawLidar(msg) {
    currentScan = msg
  }

  return {
    mapZoom,
    showLidar,
    mapCanvasRef,
    drawMap,
    worldToCanvas,
    renderCanvas,
    drawLidar
  }
}
