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

	let start = () => {
		GameLoop.start();
	};

	let loop = (elapsed) => {
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