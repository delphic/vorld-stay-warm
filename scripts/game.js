const Fury = require('fury');
const { Maths, GameLoop } = Fury;
const { vec3 } = Maths;
const Audio = require('./audio'); // Note this clashes with global Audio constructor
const GameEntity = require('./gameEntity');
const Models = require('./models');
const VorldController = require('./vorldController');
const Player = require('./player');
const Vorld = require('../vorld');
const { Physics } = require('fury');

module.exports = (function(){
	let exports = {};

	let debug = true;
	let config = null;
	let atlasImage = null;

	let camera, cameraRatio = 1.0;
	let scene;
	let vorldController = null;

	let vorld = null;
	let world = { boxes: [], entities: [], heatSources: [] };
	let player = null;

	let winMachine = null;

	let start = () => {
		GameLoop.start();
		let generationConfig =  { 
			bounds: {
				iMin: -2, iMax: 2,
				jMin: -1, jMax: 1,
				kMin: -2, kMax: 2
			},
			stages: [ "buildWalls" ]
		};
		vorld = vorldController.createWorld(
			generationConfig,
			() => {
				console.log("World generation complete");

				if (!vorld.meta) {
					vorld.meta = {};
				}
				if (!vorld.meta.spawnPoint) {
					vorld.meta.spawnPoint = [0, 4, 0];
				}

				player = spawnPlayer(vec3.clone(vorld.meta.spawnPoint));
				
				let machine = {
					sockets: []
				};
				for (let i = 0; i < 3; i++) {
					spawnModelEntity("core", [ -8 + 8 * i, 0, 8 ]).addComponent("carriable", {});
					let entity = spawnModelEntity("powered_machine", [-2 + 2 * i, 0, 16 ]);
					world.heatSources.push(createHeatSource(vec3.clone(entity.transform.position), 16, 30));
					let socket = { transform: entity.transform, filled: false }
					entity.addComponent("socket", socket);
					machine.sockets.push(socket);
				}
				winMachine = machine;

				world.heatSources.push(createHeatSource([0, 1, 0], 16, 40));

			},
			(stage, count, total) => { /* progress! */ });
	};

	let hasWon = false;

	let loop = (elapsed) => {
		for (let i = 0, l = world.entities.length; i < l; i++) {
			world.entities[i].update(elapsed);
		}

		if (!hasWon && winMachine) {
			let allFull = true;
			for (let i = 0, l = winMachine.sockets.length; i < l; i++) {
				allFull = allFull && winMachine.sockets[i].filled; 
			}
			if (allFull) {
				hasWon = true;
				alert("You Win!");
			}
		}

		scene.render();
	}

	let spawnPlayer = (position) => {
		// TODO: Create Dynamic Material in vorld controller (?)
		// let quadMat = Object.create(dynamicMaterial);
		// quadMat.id = null;
		// TODO: Create overlay scene, we probably need it
		// orb: null, // overlayScene.add({ mesh: Fury.Mesh.create(VorldHelper.getHeldOrbMeshData()), material: unlitMaterial, position: vec3.create() }),
		// ^^ HACK - should be able to hold more than just an orb
		// quad: overlayScene.add({ mesh: Primitives.createQuadMesh(VorldHelper.getTileIndexBufferValueForBlock("water")), material: quadMat, position: vec3.create() }),
		// ^^ Useful for held object logic 
		let playerConfig = {
			world: world,
			vorld: vorld,
			gameConfig: config,
			vorldController: vorldController,
			scene: scene,
			position: position,
			quad: null,
			camera: camera,
			size: [ 0.75, 2, 0.75 ], // BUG: If you use size 0.8 - you can walk through blocks at axis = 7 when moving from axis = 8.
			stepHeight: 0.51,
			placementDistance: 5.5 + Math.sqrt(3),
			removalDistance: 5.5,
			enableCreativeMode: false,
			onBlockPlaced: (block, x, y, z) => { 
				/* TODO: update any game logic based on placement */
			},
			onBlockRemoved: (block, x, y, z) => {
				/* TODO: update any game logic based on placement */
			},
		};
		// Massive Player!
		// playerConfig.size = [ 4, 8, 4];
		// playerConfig.stepHeight = 2.01;
		// Tiny Player
		// playerConfig.size = [ 0.25, 0.5, 0.25 ];
		// playerConfig.stepHeight = 0.26;
		let player = Player.create(playerConfig);
		// TODO: Trigger this from a user gesture so we can request pointer lock here and then...
		// add a pause menu so we can get it back on clicking resume if we esc to remove it

		// Okay we've got a bastard hybrid of component based and huge monster 
		// module but that's fine for now
		let playerEntity = GameEntity.create();
		playerEntity.addComponent("player", player);

		playerEntity.addComponent("audioFollow", { 
			update: (_elapsed) => { Audio.setListenerPosition(player.position); }
		});


		let warmth = {
			bodyTemperature: 37,
			airTemperature: 0,
			shelter: 0,
			hasDied: false, // Arguably should be on player component
		};

		const coolingRatePerDegree = 0.001;

		/// Takes normalised shelter value 1.0 maximum shelter and returns an exposure factor 
		let mapShelterToExposureFactor = function(shelter) {
			return 1.0 / (1.0 + shelter);
		};

		let mapBodyTemperatureToWarmingRate = function(bodyTemperature) {
			// Sigmoid curve
			// Maximum warming below ~36 degrees, None at ~37 
			// 10 factor in exponent gives a range of ~1.0 degree
			return 0.04 * (1.0 - (1.0 / (1.0 + Math.exp(10.0 * (36.5 - bodyTemperature)))));
			// Note ~0.02 at cross over point implies cooling rate is ~0.001 
			// (from the idea that at 17 degrees (diff of 20) no exposure should be stable)
		}; // ^^ Might be nice if sigmoid curves was somewhere in Fury Utils

		warmth.update = function(elapsed) {
			warmth.shelter = calculateShelter(vorld, player.position);
			warmth.airTemperature = 15 * warmth.shelter; 
			// ^^ For now just have sheltered areas warmer
			// We could probably do something more clever with shade / sunlight level and time of day vs. shelter
			// (i.e. in sunlight slightly warmer, though more exposed), would be better once shelter is moved to casting
			// method instead of local sunlight deltas.

			for (let i = 0, l = world.heatSources.length; i < l; i++) {
				warmth.airTemperature += world.heatSources[i].getHeat(player.position); 
			}
			console.log(warmth.airTemperature)

			let exposureFactor = mapShelterToExposureFactor(warmth.shelter);
			let bodyWarmth = mapBodyTemperatureToWarmingRate(warmth.bodyTemperature);
			let cooling = coolingRatePerDegree * exposureFactor * (warmth.bodyTemperature - warmth.airTemperature);
			warmth.bodyTemperature += (bodyWarmth - cooling) * elapsed;

			if (vec3.sqrLen(player.localInputVector) > 0.0001) {
				player.bodyTemperature += 0.01 * elapsed;
			}

			if (!warmth.hasDied && warmth.bodyTemperature < 35.0) {
				warmth.hasDied = true;
				alert("You died from the cold"); 
				// TODO: Disable input and respawn
			}
		};

		playerEntity.addComponent("warmth", warmth);

		world.entities.push(playerEntity);

		return player;
	};

	// Extension for Fury Maths - TODO Move to Fury
	Fury.Maths.vec3NegX = [ -1, 0 , 0];
	Fury.Maths.vec3NegY = [ 0, -1, 0 ];
	Fury.Maths.vec3NegZ = [ 0, 0, -1 ];

	let calculateShelter = (vorld, position) => {
		let [ x, y, z ] = position;
		x = Math.floor(x);
		y = Math.floor(y);
		z = Math.floor(z);

		let blockPosition = Fury.Maths.vec3Pool.request();
		vec3.set(blockPosition, x, y, z);

		// Really hacky estimation of shelter level from sunlight light  

		let lightLevel = Vorld.Lighting.getBlockSunlight(vorld, x, y, z);
		// Increasing delta means that direction is towards less sheltered / more exposed
		// Decreasing delta means that direction is towards more sheltered / less exposed
		let northDelta = getSunlightDelta(vorld, blockPosition, Fury.Maths.vec3NegZ);
		let eastDelta = getSunlightDelta(vorld, blockPosition, Fury.Maths.vec3X);
		let southDelta = getSunlightDelta(vorld, blockPosition, Fury.Maths.vec3Z);
		let westDelta = getSunlightDelta(vorld, blockPosition, Fury.Maths.vec3NegX);

		// This overvalues hugging walls outdoors so could do a max on the absolute value to reduce it's effectiveness
		// (unless wind was actually directional in which case it might even undervalue it).
		// An alternative to this would be to do some raycasts see how far you can get, although we should probably
		// factor sunlight level / outside in somehow, as you could be in a huge very sheltered room. 
		// This also wouldn't work if we had something like glass which would not stop sunlight propogation but would 
		// presumably give shelter.
		// Could we 'cast' horizontally against the yMax ? i.e. how far until "outdoors" that would differentiate between
		// indoors and outdoors, wouldn't be effected by glass ceilings or alike, would arguably overvalue huge pavilons 
		// but oh well. Well if you can get to outside in opposite direction we could reduce / negate the value of the distance? 
		// i.e. if the wind can just whistle through it's no shelter at all... :thinking: - that seems good to me tbh.

		Fury.Maths.vec3Pool.return(blockPosition);

		let averageDelta = (northDelta + eastDelta + southDelta + westDelta) / 4.0;
		return 1.0 - (lightLevel + averageDelta) / 15.0;

	};

	let getSunlightDelta = (vorld, position, direction) => {
		let [ x0, y0, z0 ] = position;
		let [ dx, dy, dz ] = direction
		let x1 = x0 + dx, y1 = y0 + dy, z1 = z0 + dz;
		return Vorld.Lighting.getBlockSunlight(vorld, x1, y1, z1) - Vorld.Lighting.getBlockSunlight(vorld, x0, y0, z0);
	};

	let spawnModelEntity = (modelId, position) => {
		let entity = GameEntity.create();
		let model = Models.instantiate({ id: modelId, scene: scene, position: position, vorldController: vorldController });
		
		model.lightProbePosition = vec3.clone(model.transform.position);
		
		model.updateLighting = function() {
			vec3.scaleAndAdd(model.lightProbePosition, model.transform.position, Maths.vec3Y, 0.5);
			// ^^ Could get the center of mesh bounds if we wanted to be more generic
			let sceneObjects = model.sceneObjects;
			let lightLevel = Vorld.Lighting.interpolateLight(vorld, model.lightProbePosition);
			let sunlightLevel = Vorld.Lighting.interpolateSunlight(vorld, model.lightProbePosition);
			for (let i = 0, l = sceneObjects.length; i < l; i++) {
				sceneObjects[i].lightLevel = lightLevel;
				sceneObjects[i].sunlightLevel = sunlightLevel;
			}
			// ^^ Amusingly this shows up the delay on lighting changes being implemented would be fix if lighting propogation was part of the off thread chunks
		};
		model.updateLighting();

		model.update = function(_elapsed) {
			model.updateLighting();
		}
		entity.addComponent("model", model);

		entity.transform = model.transform;

		// Add centered bounds to scene objects and one to the entity
		// NOTE: Would create an invalid bounds if there were no scene objects!
		let sceneObjects = model.sceneObjects;
		let min = [ Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY ], max = [ Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY ];
		for (let i = 0, l = sceneObjects.length; i < l; i++) {
			let meshBounds = sceneObjects[i].mesh.bounds;
			let center = vec3.clone(meshBounds.center);
			sceneObjects[i].transform.updateMatrix();
			vec3.transformMat4(center, center, sceneObjects[i].transform.matrix);
			let size = vec3.clone(meshBounds.size);
			sceneObjects[i].bounds = Fury.Physics.Box.create({ center: center, size: size });
			// HACK: Box is an AABB so does not adjust for rotation (all models fit in a cube so it's not too bad for first pass)
			vec3.min(min, min, sceneObjects[i].bounds.min);
			vec3.max(max, max, sceneObjects[i].bounds.max);
		}

		let collider = {};
		collider.bounds = Fury.Physics.Box.create({ min: min, max: max });
		// HACK: Box is an AABB so does not adjust for rotation
		collider.offset = vec3.subtract([], collider.bounds.center, model.transform.position);
		collider.lastPosition = [ 0, 0, 0 ];
		collider.updateBounds = function() {
			if (!vec3.equals(collider.lastPosition, model.transform.position)) {
				// Move the bounding boxes, would be nice if this could be automatic when you change the position
				vec3.add(collider.bounds.center, collider.offset, model.transform.position);
				collider.bounds.recalculateMinMax();
				let sceneObjects = model.sceneObjects;
				for (let i = 0, l = sceneObjects.length; i < l; i++) {
					let center = sceneObjects[i].bounds.center;
					vec3.copy(center, sceneObjects[i].mesh.bounds.center);
					sceneObjects[i].transform.updateMatrix();
					vec3.transformMat4(center, center, sceneObjects[i].transform.matrix);
					sceneObjects[i].bounds.recalculateMinMax();
				}
				vec3.copy(collider.lastPosition, model.transform.position);
			}
		};
		collider.updateBounds();

		collider.raycast = function(raycastHitPoint, pickPos, pickDir) {
			if (Physics.Box.rayCast(raycastHitPoint, pickPos, pickDir, collider.bounds)) {
				let hitSceneObject = null;
				let minToi = Number.MAX_VALUE;
				let sceneObjects = model.sceneObjects;
				for (let i = 0, l = sceneObjects.length; i < l; i++) {
					let toi = Physics.Box.rayCast(raycastHitPoint, pickPos, pickDir, sceneObjects[i].bounds);
					if (toi && toi < minToi) {
						minToi = toi;
						hitSceneObject = sceneObjects[i];
					}
				}
				if (hitSceneObject) {
					return minToi;
				}
			}
			return 0;
		};

		collider.update = function(_elapsed) {
			collider.updateBounds();
		};
		entity.addComponent("collider", collider);
		
		world.entities.push(entity);

		return entity;
	};

	world.pickClosestEntity = function(raycastHitPoint, pickPos, pickDir, range, tag) {
		let minToi = range;
		let result = null;
		for (let i = 0, l = world.entities.length; i < l; i++) {
			let entity = world.entities[i];
			if ((!tag || entity[tag]) && entity.collider) {
				let toi = entity.collider.raycast(raycastHitPoint, pickPos, pickDir);
				if (toi && toi < minToi) {
					minToi = toi;
					result = entity;
				}
			}
		}
		return result;
	};

	let createHeatSource = (position, radius, intensity) => {
		let castDirection = [];
		let hitPoint = [];
		return {
			position: position,
			raidus: radius,
			intensity: intensity,
			getHeat: (from) => {
				let sqrDist = vec3.sqrDist(position, from);
				if (sqrDist < radius * radius) {
					vec3.subtract(castDirection, position, from);
					vec3.normalize(castDirection, castDirection);
					if (!Vorld.Physics.raycast(hitPoint, vorld, from, castDirection, Math.sqrt(sqrDist))) {
						return intensity / Math.max(sqrDist, 1);
					}
				}
				return 0;
			}
		};
	};

	exports.init = function({ canvas, gameConfig }) {
		canvas.addEventListener("resize", () => {
			cameraRatio = canvas.clientWidth / canvas.clientHeight;
			if (camera && camera.ratio) camera.ratio = cameraRatio;
		});

		config = gameConfig;

		camera = Fury.Camera.create({
			near: 0.1,
			far: 1000000.0,
			fov: 1.0472,
			ratio: canvas.clientWidth / canvas.clientHeight,
			position: [0, 2, 5]
		});

		Fury.Renderer.clearColor(1,1,1,1);

		scene = Fury.Scene.create({ camera: camera });

		Audio.createMixer("ui", 1, Audio.mixers.master);
		Audio.createMixer("sfx", 0.5, Audio.mixers.master);
		Audio.createMixer("sfx/footsteps", 0.25, Audio.mixers["sfx"]);
		Audio.createMixer("bgm", 0.25, Audio.mixers.master);

		GameLoop.init({ loop: loop, maxFrameTimeMs: 66 });
		loadAssets(gameConfig, start);
	};

	let loadAssets = (config, callback) => {
		let assetsLoading = 0;

		let assetLoaded = () => {
			assetsLoading--;
			if (assetsLoading == 0) {
				callback();
			}
		};

		assetsLoading++;
		atlasImage = new Image();
		atlasImage.onload = function() {
			let materials = VorldController.createVorldMaterials(atlasImage);
			vorldController = VorldController.create({
				debug: debug,
				vorldConfig: config,
				scene: scene,
				materials: materials,
				workerSrc: "scripts/vorld-worker.js"
			});
			assetLoaded();
		};
		atlasImage.src = config.meshingConfig.atlas.src;

		assetsLoading++;
		Audio.fetchAudio(Object.values(config.sfx).map(x => x.uri), assetLoaded);

		assetsLoading++;
		Models.fetchModels(config.models, assetLoaded);
	};

	return exports;
})();