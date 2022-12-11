const Fury = require('fury');
const { Maths, GameLoop } = Fury;
const { vec3 } = Maths;
const Audio = require('./audio'); // Note this clashes with global Audio constructor
const VorldController = require('./vorldController');
const Player = require('./player');

module.exports = (function(){
	let exports = {};

	let debug = true;
	let config = null;
	let atlasImage = null;

	let camera, cameraRatio = 1.0;
	let scene;
	let vorldController = null;

	let vorld = null;
	let world = { boxes: [], entities: [] };
	let player = null;
	let initialGenerationComplete = false;

	let start = () => {
		GameLoop.start();
		let generationConfig =  { bounds: {
				iMin: -2, iMax: 2,
				jMin: -1, jMax: 1,
				kMin: -2, kMax: 2
			} };
		vorld = vorldController.createWorld(
			generationConfig,
			() => {
				initialGenerationComplete = true;
				console.log("World generation complete");
			},
			(stage, count, total) => { /* progress! */ });
	};

	let hasAddedLevelDetails = false;
	let loop = (elapsed) => {
		if (initialGenerationComplete && !hasAddedLevelDetails) {
			// TODO: consider making a custom vorld-worker file, which has options for custom generation logic 
			// so we can to this as part of the generation stage rather than after initial generation is complete 
			hasAddedLevelDetails = true;
			vorldController.startBatchUpdate();
			let zMin = -2 * 16, zMax = 2 * 16 - 1, xMin = -2 * 16, xMax = 2 * 16 - 1;
			for (let y = 0; y < 4; y++) {
				for (let z = zMin; z <= zMax; z++) {
					for (let x = xMin; x <= xMax; x++) {
						if (x == xMin || x == xMax || z == zMin || z == zMax) {
							vorldController.addBlock(vorld, x, y, z, config.blockIds["cobblestone"]);
						}
					}
				}
			}
			vorldController.finishBatchUpdate(vorld, () => { 
				spawnPlayer();
			});
		}

		if (player) {
			player.update(elapsed);
			Audio.setListenerPosition(player.position);
		}
		// TODO: Run some logic!
		scene.render();
	}

	let spawnPlayer = () => {
		let spawnPoint = null;
			if (!vorld.meta) {
				vorld.meta = {};
			}
			if (!vorld.meta.spawnPoint) {
				vorld.meta.spawnPoint = [0, 4, 0];
			}
			spawnPoint = vec3.clone(vorld.meta.spawnPoint);

			// TODO: Create Dynamic Material in vorld controller (?)
			// let quadMat = Object.create(dynamicMaterial);
			// quadMat.id = null;

			// TODO: Create overlay scene, we probably need it
			// orb: null, // overlayScene.add({ mesh: Fury.Mesh.create(VorldHelper.getHeldOrbMeshData()), material: unlitMaterial, position: vec3.create() }), // HACK - should be able to hold more than just an orb
			// ^^ Useful for held object logic 

			let playerConfig = {
				world: world,
				vorld: vorld,
				gameConfig: config,
				vorldController: vorldController,
				scene: scene,
				position: spawnPoint,
				quad: null, // overlayScene.add({ mesh: Primitives.createQuadMesh(VorldHelper.getTileIndexBufferValueForBlock("water")), material: quadMat, position: vec3.create() }),
				camera: camera,
				size: vec3.fromValues(0.75, 2, 0.75), // BUG: If you use size 0.8 - you can walk through blocks at axis = 7 when moving from axis = 8.
				stepHeight: 0.51,
				placementDistance: 5.5 + Math.sqrt(3),
				removalDistance: 5.5,
				enableCreativeMode: debug,
				onBlockPlaced: (block, x, y, z) => { 
					/* TODO: play appropriate block placement sfx and update game logic based on placement? */
				},
				onBlockRemoved: (block, x, y, z) => {
					/* TODO: play appropriate block removal sfx and update game logic based on placement? */
				},
			};
			// Massive Player!
			// playerConfig.size = vec3.fromValues(4,8,4);
			// playerConfig.stepHeight = 2.01;
			// Tiny Player
			// playerConfig.size = vec3.fromValues(0.25,0.5,0.25);
			// playerConfig.stepHeight = 0.26;
			player = Player.create(playerConfig);

			// TODO: Trigger this from a user gesture so we can request pointer lock here and then...
			// add a pause menu so we can get it back on clicking resume if we esc to remove it
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
	};

	return exports;
})();