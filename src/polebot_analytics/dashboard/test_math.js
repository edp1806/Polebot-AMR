const mapData = {
  info: {
    width: 200,
    height: 200,
    resolution: 0.05,
    origin: { position: { x: -5.0, y: -5.0 } }
  }
};

function canvasToWorld(px, py) {
  const wx = (px * mapData.info.resolution) + mapData.info.origin.position.x
  const wy = ((mapData.info.height - 1 - py) * mapData.info.resolution) + mapData.info.origin.position.y
  return { wx, wy }
}

function worldToCanvas(wx, wy) {
  const px = (wx - mapData.info.origin.position.x) / mapData.info.resolution
  const py = mapData.info.height - 1 - ((wy - mapData.info.origin.position.y) / mapData.info.resolution)
  return { px, py }
}

console.log("c2w:", canvasToWorld(100, 100));
console.log("w2c:", worldToCanvas(0, 0));
