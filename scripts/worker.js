const Vorld = require('../vorld');
const { LightingWorker, MeshingWorker, TerrianWorker, World, Utils } = Vorld;

onmessage = function(e) {
	let data = e.data;
	switch (data.jobType) {
		case "terrain":
			TerrianWorker.execute(data, this.postMessage);
			break;
		case "lighting":
			LightingWorker.execute(data, this.postMessage);
			break;
		case "meshing": 
			MeshingWorker.execute(data, this.postMessage);
			break;
		case "buildWalls":
			buildWalls(data, this.postMessage);
			break;
		default:
			console.warn("Unsupported job type " + data.jobType);
			postMessage({ id: data.id, complete: true, duration: 0 });
			break;
	}
};

let buildWalls = function(data, postMessage) {
	let startTime = Date.now();
	let vorld = data.vorld;
	let blockIds = Utils.createBlockIdsLookup(vorld);
	let block = blockIds["cobblestone"];

	let zMin = -2 * 16, zMax = 2 * 16 - 1, xMin = -2 * 16, xMax = 2 * 16 - 1;
	for (let y = 0; y < 4; y++) {
		for (let z = zMin; z <= zMax; z++) {
			for (let x = xMin; x <= xMax; x++) {
				if (x == xMin || x == xMax || z == zMin || z == zMax) {
					World.setBlock(vorld, x, y, z, block);
				}
			}
		}
	}
	postMessage({ id: data.id, complete: true, vorld: vorld, duration: Date.now() - startTime });
};