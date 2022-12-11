const Fury = require('fury');
const { GameLoop } = Fury;
const VorldController = require('./vorldController');


module.exports = (function(){
	let exports = {};

	let debug = true;
	let config = null;
	let atlasImage = null;

	let camera, cameraRatio = 1.0;
	let scene;
	let vorldController = null;

	let vorld = null;
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
			vorldController.finishBatchUpdate(vorld, () => { console.log("Added walls?") });
		}
		// TODO: Run some logic!
		scene.render();
	}

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
	};

	return exports;
})();