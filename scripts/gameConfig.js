const CustomBlockMeshes = require('./customBlockMeshes');

// Duplicated from cartographer - should extract to shared

module.exports = (function(){
	let exports = {};

	let parseReference = (reference, data) => {
		if (reference) {
			let split = reference.split('.');
			return data[split[0]][split[1]];	
		}
		return null;
	};

	let crossReference = (key, object, data) => {
		if (object[key]) {
			object[key] = parseReference(object[key], data);
		} 
	};

	let crossReferenceArray = (key, object, data) => {
		let array = object[key];
		for (let i = 0, l = array.length; i < l; i++) {
			array[i] = parseReference(array[i], data);
		}
	};

	exports.parse = (config) => {
		// TODO: Schemas to determine references - rather than hard coded
		// TODO: figure out a better way of doing mesh data than just an id - a meshes group with option of lookup or uri ?
		if (config.blockConfig) {
			let blockConfig = config.blockConfig
			for (let i = 0, l = blockConfig.length; i < l; i++) {
				let blockDef = blockConfig[i];
				crossReference("collision", blockDef, config);
				if (blockDef.mesh) {
					blockDef.mesh = CustomBlockMeshes.getCustomMeshData(blockDef);	
				}
			}
		}

		if (config.materials) {
			let materialIds = Object.keys(config.materials);
			for (let i = 0, l = materialIds.length; i < l; i++) {
				let material = config.materials[materialIds[i]];
				// Hook up sfx references
				let sfxKeys = Object.keys(material.sfx);
				for (let j = 0, n = sfxKeys.length; j < n; j++) {
					crossReferenceArray(sfxKeys[j], material.sfx, config);
				}
			}
		}

		if (config.terrainGenerationRules) {
			let rulesKeys = Object.keys(config.terrainGenerationRules);
			for (let i = 0, l = rulesKeys.length; i < l; i++) {
				let rules = config.terrainGenerationRules[rulesKeys[i]];
				rules.id = rulesKeys[i]; // TODO: This would be a nice thing to do for hash map groups in general
				crossReferenceArray("blocksByThreshold", rules, config);
				if (rules.verticalTransforms) {
					for (let j = 0, n = rules.verticalTransforms.length; j < n; j++) {
						let vt = rules.verticalTransforms[j];
						crossReference("block", vt, config);
						crossReference("blockAbove", vt, config);
						crossReference("targetBlock", vt, config);
					}
				}
			} 
		}

		// TODO: Update meshingConfig.atlas to array of tile ids (e.g. stone, soil, grass_top, grass_side etc)
		// Move what textures on what sides to block definition and build the index lookup, the lookup could then just be
		// an array of indices with the array index based on the cardinal enum values, would simplify the mesher code 

		return config;
	};

	return exports;
})();