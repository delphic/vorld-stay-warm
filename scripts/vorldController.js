// Vorld Controller - handles dispatching work from the main thread to workers
const Fury = require('fury');
const { Mesh, Maths, Random, Renderer, Scene, WorkerPool } = Fury;
const { World: Vorld, Updater: VorldUpdater, Utils: VorldUtils, Shader: VoxelShader } = require('../vorld');
const { vec3 } = Maths;

// Duplicated from cartographer - may want to sync changes after the jam
// Arguably this could live in vorld, yes it's coupled to Fury's scene format / methods / is a fury 
// integration but fury is already a dependency for Fury.Random (although arguably we should separate
// that into a difference package as it's just random utils and doesn't have any other dependencies iirc).

module.exports = (function(){
	let exports = {};

	let workerPool = null;
	let boundsCache = {};

	let performWorkOnBounds = (bounds, sectionSize, configDelegate, messageCallback, completeCallback) => {
		let iMin = bounds.iMin, iMax = bounds.iMax, kMin = bounds.kMin, kMax = bounds.kMax;
		let generatedSectionsCount = 0;
		let totalSectionsToGenerate = Math.ceil((iMax - iMin + 1) / sectionSize) * Math.ceil((kMax - kMin + 1) / sectionSize);

		let nextWorkerId = 0;
		let progress = [];
		let startTimes = [];
		let executionRatio = 0;

		let i = iMin, k = kMin;

		let workerMessageCallback = (data) => {
			if (data.complete) {
				generatedSectionsCount += 1;
			}

			let totalProgress = generatedSectionsCount;
			if (data.id !== undefined) {
				if (data.progress !== undefined) {
					progress[data.id] = data.progress;
				}
				totalProgress = 0;
				for (let i = 0, l = progress.length; i < l; i++) {
					if (progress[i]) {
						totalProgress += progress[i];
					}
				}
			}

			messageCallback(data, totalProgress, totalSectionsToGenerate);
			if (data.complete) {
				let elapsed = Date.now() - startTimes[data.id];
				let ratio = data.duration / elapsed;
				let n = generatedSectionsCount;
				executionRatio = ((n - 1) * executionRatio / n) + ratio / n;

				if (generatedSectionsCount >= totalSectionsToGenerate && completeCallback) {
					completeCallback((executionRatio * 100).toFixed(2));
				} else {
					tryStartNextWorker();
				}
			}
		};

		let tryStartNextWorker = () => {
			if (i <= iMax && k <= kMax) {
				startWorker(configDelegate({ 
						iMin: i,
						iMax: i + sectionSize - 1,
						jMin: bounds.jMin,
						jMax: bounds.jMax,
						kMin: k,
						kMax: k + sectionSize - 1 
					}), 
					workerMessageCallback);
				k += sectionSize;
				if (k > kMax) {
					k = kMin;
					i += sectionSize;
				}
				return true;
			}
			return false;
		};

		let startWorker = (config, callback) => {
			let worker = workerPool.requestWorker();
			worker.onmessage = (e) => {
				if (e.data.complete) {
					workerPool.returnWorker(worker);
				}
				if (callback) {
					callback(e.data);
				}
			};
			config.id = nextWorkerId++;
			startTimes[config.id] = Date.now();
			worker.postMessage(config);
		};

		while (workerPool.isWorkerAvailable() && tryStartNextWorker()) { /* Try make next worker! */ }
	};

	exports.create = ({ debug, vorldConfig, scene, materials, workerSrc }) => {
		if (workerPool == null) {
			workerPool = WorkerPool.create({ src: workerSrc });
		}

		let controller = {};

		// TODO: NOTE: if we want 'unlit' effect should update shader to have emissive map
		let { material, cutoutMaterial, alphaMaterial } = materials;
		let { blockIds, lightingConfig, meshingConfig, blockConfig, terrainGenerationRules } = vorldConfig;
		let sceneChunkObjects = {};

		// Note on blockConfig "placement"
		// "front_facing" - up is up and front of the block is pointed towards camera
		// "up_normal" - up of block towards normal of face placed (TODO: test against MC wood placement)
		// "half" - block up can only be up or down, based on normal or fract(y) if on sideways face
		// "steps" - block up as with half, but front of steps towards camera

		let generate = (vorld, bounds, id, terrainRules, stages, callback, progressDelegate) => {
			let generationConfig = {
				jobType: "terrain",
				seed: vorld.seed,
				generationRules: terrainRules
			};

			let startTime = Date.now();
			workerPool.updateMaxWorkerCount(8);
			performWorkOnBounds(
				bounds,
				1,
				(sectionBounds) => {
					generationConfig.bounds = sectionBounds;
					return generationConfig;
				},
				(data, count, total) => {
					progressDelegate("generation", count, total);
					if (data.complete) {
						Vorld.tryMerge(vorld, data.vorld);
					}
				},
				(efficiency) => {
					vorld.meta = { id: id };
					if (debug) {
						let elapsed = Date.now() - startTime;
						console.log("Generation pass took " + elapsed + "ms (" + efficiency + "%)");
					}
					if (stages && stages.length) {
						stagePass(vorld, bounds, stages, 0, callback, progressDelegate);
					} else {
						lightingPass(vorld, bounds, callback, progressDelegate);
					}
				});
	
			return vorld;
		};

		let stagePass = (vorld, bounds, stages, index, callback, progressDelegate) => {
			// execute additional passes on stages one by one
			// then perform lighting pass
			// Note - only one thread used at at time: 
			// could probably have some stages execute on sets of bounds
			// this would allow for passing of slices of vorld rather than the whole thing
			// Right now "stages" are just an array of jobType to pass to the worker
			// In order to use this you must create a custom vorld worker which can handle
			// your custom job types stages 
			if (index < stages.length) {
				let worker = workerPool.requestWorker();
				worker.onmessage = (e) => {
					if (e.data.complete) {
						workerPool.returnWorker(worker);
					}
					let data = e.data; 
					if (data.complete) {
						if (data.vorld) {
							Vorld.tryMerge(vorld, data.vorld);
						}
						index += 1;
						// TODO: call progress delegate index + 1 / stages.length
						stagePass(vorld, bounds, stages, index, callback, progressDelegate);
					}
				};
				worker.postMessage({ jobType: stages[index], vorld: vorld });
			} else {
				lightingPass(vorld, bounds, callback, progressDelegate);
			}
		};

		let lightingPass = (vorld, bounds, callback, progressDelegate) => {
			let startTime = Date.now();
			workerPool.updateMaxWorkerCount(8);
			performWorkOnBounds(
				bounds, 
				7, // Maybe re-test on larger set, on the small set this is going to be affected by empty chunks
				(sectionBounds) => {
					let slice = Vorld.createSlice(
						vorld,
						sectionBounds.iMin - 1,
						sectionBounds.iMax + 1,
						sectionBounds.jMin - 1,
						sectionBounds.jMax + 1,
						sectionBounds.kMin - 1,
						sectionBounds.kMax + 1);
					return { jobType: "lighting", vorld: slice, bounds: sectionBounds };
				}, 
				(data, count, total) => {
					// count is number of sections completed not number of progress callbacks 
					// which is why this bar appears to jump (we have big sections)
					progressDelegate("lighting", count, total);
					if (data.complete) {
						Vorld.tryMerge(vorld, data.vorld);
					}
				},
				(efficiency) => {
					if (debug) {
						let elapsed = Date.now() - startTime;
						console.log("Lighting pass took " + elapsed + "ms (" + efficiency + "%)");	
					}
					meshVorld(vorld, bounds, callback, progressDelegate);
				});
		};

		let meshVorld = (vorld, bounds, callback, progressDelegate) => {
			let startTime = Date.now();
			workerPool.updateMaxWorkerCount(4);
			performWorkOnBounds(
				bounds,
				3,
				(sectionBounds) => {
					return {
						jobType: "meshing",
						bounds: sectionBounds,
						vorld: Vorld.createSlice(
							vorld,
							sectionBounds.iMin - 1,
							sectionBounds.iMax + 1,
							sectionBounds.jMin - 1,
							sectionBounds.jMax + 1,
							sectionBounds.kMin - 1,
							sectionBounds.kMax + 1),
						atlas: meshingConfig.atlas
					};
				},
				(data, count, total) => {
					progressDelegate("meshing", count, total); // Note: data contains.progress could also just send that
					if (data.mesh) {
						instantiateWorkerResponseMesh(data, vorld);
					}
				},
				(efficiency) => {
					if (debug) {
						let elapsed = Date.now() - startTime;
						console.log("Meshing pass took " + elapsed + "ms (" + efficiency + "%)");	
					}
					callback();
				});
		};

		let setLightingConfig = (id) => {
			controller.lightingConfigId = id;
			let { fogColor, fogDensity, ambientMagnitude, sunlightMagnitude: directionalMagnitude } = lightingConfig[id];
			let materialProperties = { 
				fogColor: [],
				fogDensity: fogDensity,
				ambientMagnitude: ambientMagnitude,
				directionalMagnitude: directionalMagnitude
			};
			vec3.scale(materialProperties.fogColor, fogColor, 1 / 255);

			let materialKeys = Object.keys(materials);
			for (let i = 0, l = materialKeys.length; i < l; i++) {
				materials[materialKeys[i]].setProperties(materialProperties);
			}

			// TODO: Would be nice to be able to set clear color on scene instead
			Renderer.clearColor(materialProperties.fogColor[0], materialProperties.fogColor[1], materialProperties.fogColor[2], 1.0);
		};

		controller.addMaterial = (id, material) => {
			if (!materials[id]) {
				materials[id] = material;
				setLightingConfig(controller.lightingConfigId);
			} else {
				console.error("Unable to add material with id " + id + " as it is already in the material list");
			}
		};

		let instantiateWorkerResponseMesh = (data, vorld) => {
			let mesh = Mesh.create(data.mesh);
			let position = vec3.clone(data.chunkIndices);
			vec3.scale(position, position, vorld.chunkSize);
			let chunkMaterial = data.alpha ? alphaMaterial : data.cutout ? cutoutMaterial : material;

			let key = VorldUtils.getChunkKey(data.chunkIndices[0], data.chunkIndices[1], data.chunkIndices[2]);
			if (!sceneChunkObjects[key]) { sceneChunkObjects[key] = []; }
			sceneChunkObjects[key].push(scene.add({ mesh: mesh, material: chunkMaterial, position: position, static: true }));
		};

		controller.setMaterialProperty = (name, value) => {
			material[name] = value;
			cutoutMaterial[name] = value;
			alphaMaterial[name] = value;
		};

		controller.createWorld = (config, callback, progressDelegate) => {
			let { id, bounds, terrainRules, terrainRulesId =  "flat", lightingConfigId = "day" } = config;
			
			if (!terrainRules) { terrainRules = terrainGenerationRules[terrainRulesId]; }
			else { terrainRulesId = terrainRules.id; }
			if (!id) { id = terrainRulesId; }

			// TODO: Some way to inject additional stages after terrain generation, but before lighting and meshing
			// that are still on the worker thread, ideally stages would be fully configurable

			setLightingConfig(lightingConfigId);

			let vorld = Vorld.create({
				seed: config.seed ? config.seed : Random.generateSeed(32),
				blockConfig: blockConfig
			});
			return generate(vorld, bounds, id, terrainRules, config.stages, callback, progressDelegate);
		};

		controller.clear = (vorld) => {
			let keys = Object.keys(sceneChunkObjects);
			for (let i = 0, l = keys.length; i < l; i++) {
				let objects = sceneChunkObjects[keys[i]];
				for (let j = 0, n = objects.length; j < n; j++) {
					scene.remove(objects[j]);
				}
				delete sceneChunkObjects[keys[i]];
			}
			Scene.clearResources();
			// ^^ This nukes *all scene resources* including those still in use
			// but the scene will happily just readd the resources it needs
			if (vorld) {
				Vorld.clear(vorld);
			}
		};

		controller.instantiate = (config, callback, progressDelegate) => {
			let { vorld, lightingConfigId = "day" } = config;

			setLightingConfig(lightingConfigId);

			let bounds = Vorld.calculateChunkBounds(vorld)

			if (bounds) {
				meshVorld(vorld, bounds, callback, progressDelegate);
			} else {
				callback();
			}
		};

		let batchUpdate = false;
		let batchCount = 0;

		controller.startBatchUpdate = () => {
			batchUpdate = true;
		};

		controller.finishBatchUpdate = (vorld, callback) => {
			batchUpdate = false;
			if (batchCount > 0) {
				batchCount = 0;
				performRemeshening(vorld, boundsCache, callback);
			} else if (callback) {
				callback();
			}
		};

		controller.addBlock = (vorld, x, y, z, block, up, forward, callback) => {
			let chunkIndices = Maths.vec3Pool.request();
			chunkIndices[0] = Math.floor(x / vorld.chunkSize);
			chunkIndices[1] = Math.floor(y / vorld.chunkSize);
			chunkIndices[2] = Math.floor(z / vorld.chunkSize); 
			let key = VorldUtils.getChunkKey(chunkIndices[0], chunkIndices[1], chunkIndices[2]);
			VorldUpdater.addBlock(vorld, x, y, z, block, up, forward);
			// TODO: Maybe addBlock could take an out for blocks/chunks modified
			// Or we could mark chunks dirty and on remesh set them clean
	
			let xMin = x, xMax = x, yMin = y, yMax = y, zMin = z, zMax = z;
	
			// Remesh all adjacent chunks
			// as light propogation changes can effect up to 16 blocks away
			xMin -= vorld.chunkSize;
			xMax += vorld.chunkSize;
			yMin -= vorld.chunkSize;
			yMax += vorld.chunkSize;
			zMin -= vorld.chunkSize;
			zMax += vorld.chunkSize;
			// if no light propogation changes, could just remesh if on a boundary 
			// and so would effect mesh faces and or AO on existing faces.
	
			if (!batchUpdate || batchCount == 0) {
				boundsCache.iMin = Math.floor(xMin / vorld.chunkSize);
				boundsCache.iMax = Math.floor(xMax / vorld.chunkSize);
				boundsCache.jMin = Math.floor(yMin / vorld.chunkSize);
				boundsCache.jMax = Math.floor(yMax / vorld.chunkSize);
				boundsCache.kMin = Math.floor(zMin / vorld.chunkSize);
				boundsCache.kMax = Math.floor(zMax / vorld.chunkSize);
			} else {
				boundsCache.iMin = Math.min(boundsCache.iMin, Math.floor(xMin / vorld.chunkSize));
				boundsCache.iMax = Math.max(boundsCache.iMax, Math.floor(xMax / vorld.chunkSize));
				boundsCache.jMin = Math.min(boundsCache.jMin, Math.floor(yMin / vorld.chunkSize));
				boundsCache.jMax = Math.max(boundsCache.jMax, Math.floor(yMax / vorld.chunkSize));
				boundsCache.kMin = Math.min(boundsCache.kMin, Math.floor(zMin / vorld.chunkSize));
				boundsCache.kMax = Math.max(boundsCache.kMax, Math.floor(zMax / vorld.chunkSize));
			}

			if (batchUpdate) {
				batchCount += 1;
			}
	
			Maths.vec3Pool.return(chunkIndices);
	
			if (!batchUpdate) {
				performRemeshening(vorld, boundsCache, callback);
			} else if (callback) {
				console.error("Callback provided to addBlock in batch mode, will never execute");
			}
		};

		let performRemeshening = (vorld, bounds, callback) => {
			let pendingMeshData = [];
			performWorkOnBounds(bounds, 1,
				(sectionBounds) => {
					return {
						jobType: "meshing",
						bounds: sectionBounds,
						vorld: Vorld.createSlice(
							vorld,
							sectionBounds.iMin - 1,
							sectionBounds.iMax + 1,
							sectionBounds.jMin - 1,
							sectionBounds.jMax + 1,
							sectionBounds.kMin - 1,
							sectionBounds.kMax + 1),
						atlas: meshingConfig.atlas
					};
				}, (data) => { // count, total arguments available
					if (data.chunkIndices) {
						pendingMeshData.push(data);
					}
				}, () => {
					// Remove all scene objects for remeshed chunks
					for (let i = 0, l = pendingMeshData.length; i < l; i++) {
						let data = pendingMeshData[i];
						let key = VorldUtils.getChunkKey(data.chunkIndices[0], data.chunkIndices[1], data.chunkIndices[2]);
						if (sceneChunkObjects[key]) {
							for (let j = 0, n = sceneChunkObjects[key].length; j < n; j++) {
								scene.remove(sceneChunkObjects[key][j]);
							}
							sceneChunkObjects[key].length = 0;
						} else {
							sceneChunkObjects[key] = [];
						}
					}

					// The Remeshening
					for (let i = 0, l = pendingMeshData.length; i < l; i++) {
						if (pendingMeshData[i].mesh) {
							instantiateWorkerResponseMesh(pendingMeshData[i], vorld);
						}
					}
					if (callback) { callback(); }
				});
		};

		controller.removeBlock = (vorld, x, y, z, callback) => {
			// TODO: Move removal logic for block above to block configuration
			// TODO: have blockConfig determine which block types should be 
			// treated as fluids rather than just hard coding "water"

			// Check for long grass and remove if necessary
			if (Vorld.getBlock(vorld, x, y, z) == blockIds["grass"] 
				&& Vorld.getBlock(vorld, x, y + 1, z) == blockIds["long_grass"]) {
					VorldUpdater.addBlock(vorld, x, y + 1, z, 0);
			}
	
			// Check horizontally adjacent blocks for water
			let adjacentWaterBlock = false;
			for (let i = -1; i <= 1; i++) {
				for (let j = -1; j <= 1; j++) {
					if ((i != 0 || j != 0) && Math.abs(i) != Math.abs(j)) {
						if (Vorld.getBlock(vorld, x + i, y, z + j) == blockIds.water) {
							adjacentWaterBlock = true;
							break;
						}
					}
				}
			}
			// Also check above for water
			if (Vorld.getBlock(vorld, x, y + 1, z) == blockIds.water) {
				adjacentWaterBlock = true;
			}
			// TODO: Replace this with flow simulation so that more than the 
			// block you're removing can get filled once exposed to water 
			// Or just do a graph search and fill all appropriate blocks from here
	
			if (!adjacentWaterBlock) {
				controller.addBlock(vorld, x, y, z, 0, undefined, undefined, callback);
			} else {
				controller.addBlock(vorld, x, y, z, blockIds.water, undefined, undefined, callback);
			}
		};
		return controller;
	};

	// NOTE: Moved from game.js compared to cartographer
	// TODO: May want to add emissive material / or take emissive texture map
	// TODO: Will need dynamic material for held objects if using the voxel shader for held objects
	let skyColor = [ 0, 0, 0 ];
	exports.createVorldMaterials = function(image) {
		let shaderConfig = VoxelShader.create();
		let cutoutShaderConfig = VoxelShader.create(0.5); 
		// Cutout threshold needs to be 0.5 to prevent the shader 'evapourating' at distance, 
		// however this also requires a mag filter of nearest pixel to remove visible lines at edges
		let shader = Fury.Shader.create(shaderConfig);
		let cutoutShader = Fury.Shader.create(cutoutShaderConfig);

		let targetWidth = 128; // => Scale 8 for 16 pixels, 4 for 32 pixels, 2 for 64 pixels, 1 for 128 pixels+
		let scale = Math.ceil(targetWidth / image.width);  
		let upscaled = Fury.Utils.createScaledImage({ image: image, scale: scale });
		let textureSize = upscaled.width, textureCount = Math.round(upscaled.height / upscaled.width);
		let textureConfig = { source: upscaled, width: textureSize, height: textureSize, imageCount: textureCount, clamp: true };
		textureConfig.quality = "pixel";
		let textureArray = Fury.Texture.createTextureArray(textureConfig);
		textureConfig.quality = "low";
		let nearestFilteredTextureArray = Fury.Texture.createTextureArray(textureConfig);
		
		let result = {};
		result.material = Fury.Material.create({
			shader: shader,
			texture: textureArray,
			properties: { "fogColor": vec3.clone(skyColor), "fogDensity": 0.005, "ambientMagnitude": 0.75, "directionalMagnitude": 0.5 }
		});
		result.cutoutMaterial = Fury.Material.create({
			shader: cutoutShader,
			texture: nearestFilteredTextureArray,
			properties: { "fogColor": vec3.clone(skyColor), "fogDensity": 0.005, "ambientMagnitude": 0.75, "directionalMagnitude": 0.5 }
		});
		result.alphaMaterial = Fury.Material.create({
			shader: shader,
			texture: textureArray,
			properties: { alpha: true, blendSeparate: true, "fogColor": vec3.clone(skyColor), "fogDensity": 0.005, "ambientMagnitude": 0.75, "directionalMagnitude": 0.5 }
		});

		return result;
	};

	return exports;
})();