const Fury = require('fury');
const Vorld = require('../vorld');
const { Shader: VoxelShader } = Vorld; 
const { Shader, Model } = Fury;

module.exports = (function(){
	let exports = {};

	let modelShader = null;
	let modelDefinitions = {}; // Map of model id to definition

	let getModelShader = () => {
		if (!modelShader) {
			modelShader = Shader.create(VoxelShader.createDynamicTextured());
		}
		return modelShader;
	};

	// models: { id: { uri }, [...] }
	exports.fetchModels = (models, callback, progressCallback) => {
		let resourceProperties = {
			quality: "pixel",
			shader: getModelShader(),
			texturedMaterialProperties: { 
				// alpha: true,
				// blendSeparate: true,
				"fogColor": [ 0, 0, 0 ],
				"fogDensity": 0.005,
				"ambientMagnitude": 0.5,
				"directionalMagnitude": 0.5,
			},
		};
		let ids = Object.keys(models);
		let assetsLoading = ids.length;
		for (let i = 0, l = ids.length; i < l; i++) {
			let id = ids[i];
			Model.load(models[id].uri, (model) => {
				modelDefinitions[id] = model;
				model.id = id;
				assetsLoading--;
				if (progressCallback) {
					progressCallback();
				}
				if (callback && assetsLoading == 0) {
					callback();
				}
			}, resourceProperties);
		}
	};

	exports.instantiate = ({ id, scene, position, rotation, vorldController }) => {
		if (modelDefinitions[id]) {
			let model = modelDefinitions[id];
			if (!model.registeredMaterials) {
				model.registeredMaterials = true;
				for (let i = 0, l = model.resources.materials.length; i < l; i++) {
					vorldController.addMaterial(id + "_" + i, model.resources.materials[i]);
				}
			}
			return Model.instantiate(modelDefinitions[id], scene, position, rotation);
		}
		console.error("Invalid id " + id);
		return null;
	};

	return exports;
})();