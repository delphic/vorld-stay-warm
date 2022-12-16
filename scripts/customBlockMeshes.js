const { Mesh } = require('fury');
const { Primitives: VorldPrimitives } = require('../vorld');

// Duplicated from cartographer - as a dependency for gameConfig
// Should consider a better way to specify these, clearly some
// could be moved to vorld, but are certainly going to need custom
// mesh definitions per game

module.exports = (function(){
	let exports = {};

	exports.getCustomMeshData = (blockDef) => {
		// We'd probably be better off if the worker took the id rather than assigning the mesh data in like this
		// Would be less data to copy to the worker
		switch (blockDef.mesh) {
			case "stub":
				return stubJson;
			case "button":
				return buttonJson;
			case "tube":
				return tubeJson;
			case "torch":
				return torchJson;
			case "halfCube":
				return halfCubeJson;
			case "step":
				return stepJson;
			case "longGrass":
				return longGrassJson;
			case "surfaceBlock":
				return surfaceBlockJson;
				case "layerBlock":
					return layerBlockJson;
			default:
				console.error("Unexpected mesh id: " + blockDef.mesh);
				return null;
		}
	};

	// Custom Mesh Definitions
	let halfCubeJson = VorldPrimitives.createCuboidMeshJson(0.0, 1.0, 0.0, 0.5, 0.0, 1.0);

	let stubJson = VorldPrimitives.createCuboidMeshJson(6.0/16.0, 10.0/16.0, 0.0, 4.0/16.0, 6.0/16.0, 10.0/16.0)

	let buttonJson = VorldPrimitives.createCuboidMeshJson(6.0/16.0, 10.0/16.0, 0.0, 2.0/16.0, 6.0/16.0, 10.0/16.0)

	let tubeJson = VorldPrimitives.createCuboidMeshJson(6.0/16.0, 10.0/16.0, 0.0, 1.0, 6.0/16.0, 10.0/16.0);

	let torchJson = VorldPrimitives.createCuboidMeshJson(0.4, 0.6, 0.0, 0.8, 0.4, 0.6);

	// Combined pair of cubes - top quad halved on lower, no bottom on upper - TODO: single quad at back
	let stepJson = {
		vertices: [ 
			// base
			// forward
			0.0, 0.0, 1.0,
			1.0, 0.0, 1.0,
			1.0, 0.5, 1.0,
			0.0, 0.5, 1.0,
			// back
			0.0, 0.0, 0.0,
			0.0, 0.5, 0.0,
			1.0, 0.5, 0.0,
			1.0, 0.0, 0.0,
			// up
			0.0, 0.5, 0.0,
			0.0, 0.5, 0.5,
			1.0, 0.5, 0.5,
			1.0, 0.5, 0.0,
			// down
			0.0, 0.0, 0.0,
			1.0, 0.0, 0.0,
			1.0, 0.0, 1.0,
			0.0, 0.0, 1.0,
			// right
			1.0, 0.0, 0.0,
			1.0, 0.5, 0.0,
			1.0, 0.5, 1.0,
			1.0, 0.0, 1.0,
			// left
			0.0, 0.0, 0.0,
			0.0, 0.0, 1.0,
			0.0, 0.5, 1.0,
			0.0, 0.5, 0.0, 
			// step
			// forward
			0.0, 0.5, 1.0,
			1.0, 0.5, 1.0,
			1.0, 1.0, 1.0,
			0.0, 1.0, 1.0,
			// back
			0.0, 0.5, 0.5,
			0.0, 1.0, 0.5,
			1.0, 1.0, 0.5,
			1.0, 0.5, 0.5,
			// up
			0.0, 1.0, 0.5,
			0.0, 1.0, 1.0,
			1.0, 1.0, 1.0,
			1.0, 1.0, 0.5,
			// right
			1.0, 0.5, 0.5,
			1.0, 1.0, 0.5,
			1.0, 1.0, 1.0,
			1.0, 0.5, 1.0,
			// left
			0.0, 0.5, 0.5,
			0.0, 0.5, 1.0,
			0.0, 1.0, 1.0,
			0.0, 1.0, 0.5 
		],
		normals: [
			// base
			// forward
			0.0, 0.0, 1.0,
			0.0, 0.0, 1.0,
			0.0, 0.0, 1.0,
			0.0, 0.0, 1.0,
			// back
			0.0, 0.0, -1.0,
			0.0, 0.0, -1.0,
			0.0, 0.0, -1.0,
			0.0, 0.0, -1.0,
			// up
			0.0, 1.0, 0.0,
			0.0, 1.0, 0.0,
			0.0, 1.0, 0.0,
			0.0, 1.0, 0.0,
			// down
			0.0, -1.0, 0.0,
			0.0, -1.0, 0.0,
			0.0, -1.0, 0.0,
			0.0, -1.0, 0.0,
			// right
			1.0, 0.0, 0.0,
			1.0, 0.0, 0.0,
			1.0, 0.0, 0.0,
			1.0, 0.0, 0.0,
			// left
			-1.0, 0.0, 0.0,
			-1.0, 0.0, 0.0,
			-1.0, 0.0, 0.0,
			-1.0, 0.0, 0.0,
			// step
			// forward
			0.0, 0.0, 1.0,
			0.0, 0.0, 1.0,
			0.0, 0.0, 1.0,
			0.0, 0.0, 1.0,
			// back
			0.0, 0.0, -1.0,
			0.0, 0.0, -1.0,
			0.0, 0.0, -1.0,
			0.0, 0.0, -1.0,
			// up
			0.0, 1.0, 0.0,
			0.0, 1.0, 0.0,
			0.0, 1.0, 0.0,
			0.0, 1.0, 0.0,
			// right
			1.0, 0.0, 0.0,
			1.0, 0.0, 0.0,
			1.0, 0.0, 0.0,
			1.0, 0.0, 0.0,
			// left
			-1.0, 0.0, 0.0,
			-1.0, 0.0, 0.0,
			-1.0, 0.0, 0.0,
			-1.0, 0.0, 0.0
		],
		textureCoordinates: [
			// base
			// forward
			0.0, 0.0,
			1.0, 0.0,
			1.0, 0.5,
			0.0, 0.5,
			// back
			1.0, 0.0,
			1.0, 0.5,
			0.0, 0.5,
			0.0, 0.0,
			// up
			0.0, 1.0,
			0.0, 0.5,
			1.0, 0.5,
			1.0, 1.0,
			// down
			1.0, 1.0,
			0.0, 1.0,
			0.0, 0.0,
			1.0, 0.0,
			// right
			1.0, 0.0,
			1.0, 0.5,
			0.0, 0.5,
			0.0, 0.0,
			// left
			0.0, 0.0,
			1.0, 0.0,
			1.0, 0.5,
			0.0, 0.5, 
			// step
			// forward
			0.0, 0.5,
			1.0, 0.5,
			1.0, 1.0,
			0.0, 1.0,
			// back
			1.0, 0.5,
			1.0, 1.0,
			0.0, 1.0,
			0.0, 0.5,
			// up
			0.0, 1.0,
			0.0, 0.5,
			1.0, 0.5,
			1.0, 1.0,
			// right
			0.5, 0.5,
			0.5, 1.0,
			0.0, 1.0,
			0.0, 0.5,
			// left
			0.5, 0.5,
			1.0, 0.5,
			1.0, 1.0,
			0.5, 1.0 
		],
		indices: [
			// base
			0, 1, 2, 
			0, 2, 3,
			4, 5, 6,
			4, 6, 7,
			8, 9, 10,
			8, 10, 11,
			12, 13, 14,
			12, 14, 15,
			16, 17, 18,
			16, 18, 19,
			20, 21, 22,
			20, 22, 23,
			// step
			24, 25, 26, 
			24, 26, 27,
			28, 29, 30,
			28, 30, 31,
			32, 33, 34,
			32, 34, 35,
			36, 37, 38,
			36, 38, 39,
			40, 41, 42,
			40, 42, 43,
		]
	};

	let longGrassJson = Mesh.combineConfig([
		VorldPrimitives.createQuadMeshJson(0, 0.5, 1.0),
		VorldPrimitives.createQuadMeshJson(0, 0.5, -1.0),
		VorldPrimitives.createQuadMeshJson(2, 0.5, 1.0),
		VorldPrimitives.createQuadMeshJson(2, 0.5, -1.0)
	]);

	let surfaceBlockJson = VorldPrimitives.createCuboidMeshJson(
		0.0, 1.0,
		0.0, 1.0,
		0.0, 1.0 / 16.0);

	let layerBlockJson = VorldPrimitives.createCuboidMeshJson(
		0.0, 1.0,
		0.0, 1.0/16.0,
		0.0, 1.0);

	return exports;
})();