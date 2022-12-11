// Copy of cartographer's blockPlacer.js trying keep concerns separate
// Port of placement logic from vorld-archipelago player.js
// TODO: move preview creation logic elsewhere
const { BlockConfig, Cardinal, Physics: VorldPhysics } = require('../vorld');
const { Material, Maths, Mesh, Renderer, Shaders } = require('fury');
const { vec3, vec3Pool } = Maths;

module.exports = (function(){
	let exports = {};
	let blockPlacementInfo = {
		position: vec3.create(),
		up: Cardinal.Direction.up,
		forward: Cardinal.Direction.forward
	};

	let cubeWireframeJson = {
		vertices: [
			0.0, 0.0, 0.0,
			0.0, 1.0, 0.0,
			1.0, 1.0, 0.0,
			1.0, 0.0, 0.0,
			0.0, 0.0, 1.0,
			0.0, 1.0, 1.0,
			1.0, 1.0, 1.0,
			1.0, 0.0, 1.0,
		],
		indices: [ 0, 1, 1, 2, 2, 3, 3, 0, 0, 4, 1, 5, 2, 6, 3, 7, 4, 5, 5, 6, 6, 7, 7, 4 ]
	};

	exports.createPreview = (scene) => {
		let blockPreview, blockPreviewMesh, blockPreviewMaterial;
		if (scene) {
			blockPreviewMesh = Mesh.create(cubeWireframeJson);
			// TODO: ^^ Wireframe appropriate for block cast to. 
			// Have block config include wireframe mesh, then keep a cache of actual meshes
			// and swap blockPreview.mesh dynamically (good test of Fury.Scene) 
			blockPreviewMesh.renderMode = Renderer.RenderMode.Lines;
			if (!blockPreviewMaterial) {
				blockPreviewMaterial = Material.create({ shader: Shaders.UnlitColor, properties: { color: vec3.create() } } );
			}
			blockPreview = scene.add({ mesh: blockPreviewMesh, material: blockPreviewMaterial });
			blockPreview.active = false;
		}
		return blockPreview;
	};

	// This feels like it could go in VorldPhysics tbh
	exports.raycast = (out, vorld, origin, direction, distance) => {
		let hitPoint = out.point;
		if (VorldPhysics.raycast(hitPoint, vorld, origin, direction, distance)) {
			vec3.zero(out.normal);

			out.position[0] = Math.floor(hitPoint[0]);
			out.position[1] = Math.floor(hitPoint[1]);
			out.position[2] = Math.floor(hitPoint[2]);

			// Determine hit face to calculate normal and shift position
			for (let i = 0; i < 3; i++) {
				if (Maths.approximately(Math.round(hitPoint[i]), hitPoint[i])) {
					out.hitAxis = i;
					out.normal[i] = -Math.sign(direction[i]);
					out.position[i] = Math.floor(hitPoint[i] - 0.5 * out.normal[i]);
					break;
				}
			}

			return true;
		}
		return false;
	};

	let calculateBlockPlacementInfo = (out, hitInfo, castDirection, placement) => {
		let hitPoint = hitInfo.point;

		vec3.add(out.position, hitInfo.position, hitInfo.normal);
		
		let up = Cardinal.Direction.up;
		let forward = Cardinal.Direction.forward;

		if (placement === "up_normal") {
			up = Cardinal.getDirectionFromVector(hitInfo.normal);
		} else if (placement === "half" || placement === "steps") {
			let normalCardinal = Cardinal.getDirectionFromVector(hitInfo.normal);
			if (normalCardinal !== Cardinal.Direction.up && normalCardinal !== Cardinal.Direction.down) {
				if (hitPoint[1] - Math.floor(hitPoint[1]) < 0.5) {
					up = Cardinal.Direction.up;
				} else {
					up = Cardinal.Direction.down;
				}
			} else {
				up = normalCardinal;
			}

			if (placement === "steps") {
				let fwd = vec3Pool.request();

				if (normalCardinal !== Cardinal.Direction.up && normalCardinal !== Cardinal.Direction.down) {
					vec3.copy(fwd, hitInfo.normal);
				} else {
					// Calculate highest on x/z-axis
					vec3.zero(fwd);
					let maxAxis = 0;
					let maxAxisValue = 0;
					for(let i = 0; i < 3; i++) {
						if (i != 1 && Math.abs(castDirection[i]) > maxAxisValue) {
							maxAxis = i;
							maxAxisValue = Math.abs(castDirection[i]);
						}
					}
					fwd[maxAxis] = -Math.sign(castDirection[maxAxis]);
				}

				forward = Cardinal.getDirectionFromVector(fwd);
				// Invert because steps forward is not steps front (oops)
				if (forward % 2 == 0) {
					forward += 1;
				} else {
					forward -= 1;
				}

				vec3Pool.return(fwd);
			}
		} else if (placement === "front_facing") {
			// Point forward towards camera 
			let fwd = vec3Pool.request();
			vec3.zero(fwd);

			let maxAxis = 0;
			let maxAxisValue = 0;
			for (let i = 0; i < 3; i++) {
				if (Math.abs(castDirection[i]) > maxAxisValue) {
					maxAxis = i;
					maxAxisValue = Math.abs(castDirection[i]);
				}
			}

			fwd[maxAxis] = -Math.sign(castDirection[maxAxis]);
			forward = Cardinal.getDirectionFromVector(fwd);

			if (maxAxis == 1) {
				let upMaxAxis = 0;
				let upMaxAxisValue = 0;
				for (let i = 0; i < 3; i++) {
					if (i != 1 && Math.abs(castDirection[i]) > upMaxAxisValue) {
						upMaxAxis = i;
						upMaxAxisValue = Math.abs(castDirection[i]);
					}
				}
				let upVector = fwd;
				vec3.zero(upVector);
				upVector[upMaxAxis] = Math.sign(castDirection[upMaxAxis]);
				up = Cardinal.getDirectionFromVector(upVector);
			}

			vec3Pool.return(fwd);
		} else if (placement == "front_normal") {
			forward = Cardinal.getDirectionFromVector(hitInfo.normal);
			if (forward == Cardinal.Direction.up || forward == Cardinal.Direction.down) {
				// if normal was in vertical direction use max on x/z plane as up
				let maxAxis = 0;
				let maxAxisValue = 0;
				for (let i = 0; i < 3; i++) {
					if (i != 1 && Math.abs(castDirection[i]) > maxAxisValue) {
						maxAxis = i;
						maxAxisValue = Math.abs(castDirection[i]);
					}
				}
				let upVector = vec3Pool.request();
				vec3.zero(upVector);
				upVector[maxAxis] = Math.sign(castDirection[maxAxis]);
				up = Cardinal.getDirectionFromVector(upVector);
				vec3Pool.return(upVector);
			}
		}

		out.up = up;
		out.forward = forward;
	};

	exports.placeBlock = (vorldController, vorld, blockToPlace, hitInfo, castDirection, callback) => {
		// then convert to TryGetPlacement and have the consuming code call vorldController.addBlock
		let placement = BlockConfig.getBlockTypeDefinition(vorld, blockToPlace).placement;
		calculateBlockPlacementInfo(blockPlacementInfo, hitInfo, castDirection, placement);
		vorldController.addBlock(
			vorld,
			blockPlacementInfo.position[0],
			blockPlacementInfo.position[1],
			blockPlacementInfo.position[2],
			blockToPlace,
			blockPlacementInfo.up,
			blockPlacementInfo.forward, 
			callback);

		return blockPlacementInfo; 
	};

	return exports;
})();