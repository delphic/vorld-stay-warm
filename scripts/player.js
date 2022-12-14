// Player Module
const Fury = require('fury');
const { GameLoop, Input, Physics, Maths, Random } = Fury;
const { vec3, quat, vec3Pool } = Maths;
const Audio = require('./audio');
const BlockPlacer = require('./blockPlacer');
const CharacterController = require ('./characterController.js');
const { BlockConfig, World: Vorld, Lighting: VorldLighting, Physics: VorldPhysics } = require('../vorld');

module.exports = (function(){
	let exports = {};
	let prototype = {};

	let verticalApproachClampAngleDegrees = 5;

	let jumpDeltaV = 7.5;
	let coyoteTime = 0.1;
	let gravity = 2 * 9.8;


	let hitInfo = { position: [], normal: [], point: [] };

	let hitPoint = vec3.create();
	const castDirection = vec3.fromValues(0, -1, 0);
	// TODO: ^^ vec3Ext.Up / Down / Left / Right / Forward / Back (just be sure which way is right? +x?) 
	// Or you know just have negX, negY, negZ and it does what it says on the tin

	let vec3ScaleXZ = (out, a, scale) => {
		let y = a[1];
		a[1] = 0;
		vec3.scale(out, a, scale);
		a[1] = out[1] = y;
	};

	let tryGetClosestGroundVoxelCoords = (out, vorld, box) => {
		// Searches the voxels directly below the box
		let closestSqrDistance = Number.POSITIVE_INFINITY;
		let origin = Maths.vec3Pool.request();
		let voxelCenter = Maths.vec3Pool.request();

		vec3.set(origin, box.center[0], box.min[1], box.center[2]);
		let xMin = Math.floor(box.min[0]), xMax = Math.floor(box.max[0]);
		let zMin = Math.floor(box.min[2]), zMax = Math.floor(box.max[2]);

		// TODO: Refine this - really want to check to see if you're *in* a half voxel (or similar) first?
		let y = Math.floor(origin[1]) - 1;
		voxelCenter[1] = y + 0.5;

		// Could be smarter could start from the center and loop out
		for (let x = xMin; x <= xMax; x++) {
			for (let z = zMin; z <= zMax; z++) {
				if (Vorld.isBlockSolid(vorld, x, y, z)) {
					// Check there is space above for the player box
					let isSpaceAbove = true;
					for (let j = 1, l = Math.ceil(box.size[1]); j <= l && isSpaceAbove; j++) {
						isSpaceAbove = !Vorld.isBlockSolid(vorld, x, y + j, z);
					}

					if (isSpaceAbove) {
						voxelCenter[0] = x + 0.5;
						voxelCenter[2] = z + 0.5;
						let sqrDistance = vec3.sqrDist(voxelCenter, origin);
						if (sqrDistance < closestSqrDistance) {
							closestSqrDistance = sqrDistance;
							vec3.set(out, x, y, z);
						}
					}
				}
			}
		}

		Maths.vec3Pool.return(origin);
		Maths.vec3Pool.return(voxelCenter);

		return closestSqrDistance != Number.POSITIVE_INFINITY;
	};

	let pickMaterialSfxUri = (materials, material, action) => {
		if (material && materials[material] && materials[material].sfx) {
			let sfxArray = materials[material].sfx[action];
			if (sfxArray && sfxArray.length > 0) {
				return sfxArray[Random.integer(0, sfxArray.length)].uri;
			}
		}
		return null;
	}

	exports.create = (parameters) => {
		let player = Object.create(prototype);

		if (parameters.position) {
			player.position = parameters.position;
		} else {
			player.position = vec3.create();
		}

		let gameConfig = parameters.gameConfig;
		let vorldController = parameters.vorldController;

		player.config = gameConfig.playerMovement;
		let prefs = player.prefs = gameConfig.playerInputMap;
		let maxMovementSpeed = player.config.maxRunSpeed;

		let size = parameters.size;
		if (!size) {
			size = vec3.fromValues(1,2,1);
		}
		
		// Reference link box center and player position, i.e. player position at center of box
		player.box = Physics.Box.create({ center: player.position, size: size });
		let stepHeight = 0;
		if (parameters.stepHeight) {
			stepHeight = parameters.stepHeight;
		}

		let world = parameters.world;
		let vorld = parameters.vorld;
		let characterController = CharacterController.create({
			world: world,
			vorld: vorld,
			playerPosition: player.position,
			playerBox: player.box,
			stepHeight: stepHeight
		});
		player.velocity = vec3.create();

		let camera = player.camera = parameters.camera;
		let cameraOffset = 0.75 * 0.5 * size[1];
		let cameraTargetPosition = vec3.create();

		vec3.copy(camera.position, player.position);
		quat.fromEuler(camera.rotation, 0, 180, 0); // Set look for player forward
		vec3.scaleAndAdd(camera.position, camera.position, Maths.vec3Y, cameraOffset);

		// Camera Tint Quad
		let waterQuad = parameters.quad;
		if (waterQuad) {
			waterQuad.active = false;
		}

		let localX = vec3.create(), localZ = vec3.create();
		let localGroundX = vec3.create(), localGroundZ = vec3.create();
		let contacts = vec3.create();

		// Block placement
		let placementDistance = 5;
		let removalDistance = 4;
		if (parameters.placementDistance) {
			placementDistance =  parameters.placementDistance;
		}
		if (parameters.removalDistance) {
			removalDistance = parameters.removalDistance;
		}

		let placementConfig = {
			isCreativeMode: parameters.enableCreativeMode,
			destroyableBlocks: [ gameConfig.blockIds["leaves"], gameConfig.blockIds["long_grass"] ],
			pickupableBlocks: [ gameConfig.blockIds["torch"], gameConfig.blockIds["orb"] ]
		};
		let blockInventory = [];
		
		if (placementConfig.isCreativeMode) {
			blockInventory = Object.values(gameConfig.blockIds); // Probably want a better way of doing this
		}
		let blockIndex = 0; // TODO: UI to control & console option to toggle block placement (or equipable object)

		let blockPreview = BlockPlacer.createPreview(parameters.scene);

		// Input Variables
		let ry = 0, rx = 0;
		let localInputVector = vec3.create();
		let inputVector = vec3.create();
		let isWalking = false;
		let attemptJump = false; 
		let attemptSprint = false;
		let attemptPlacement = false, attemptRemoval = false;
		let verticalLookAngle = 0;
		let maxContactSpeedFactor = 1; // Increase for more slidey / less sticky walls (e.g. 1.5)
		let maxContactSpeed = [maxMovementSpeed, 0, maxMovementSpeed];
		let lastForwardPress = 0;
		let sprintDoubleTapMaxDuration = 0.25;

		let detectInput = (elapsed) => {
			// Calculate Local Axes
			vec3.transformQuat(localX, Maths.vec3X, camera.rotation);
			vec3.transformQuat(localZ, Maths.vec3Z, camera.rotation);
			vec3.copy(localGroundX, localX);
			vec3.copy(localGroundZ, localZ);
			localGroundZ[1] = localGroundX[1] = 0;
			vec3.normalize(localGroundX, localGroundX);
			vec3.normalize(localGroundZ, localGroundZ);

			ry = rx = 0;
			if (Input.isPointerLocked()) {
				ry -= prefs.mouseLookSpeed * elapsed * Input.MouseDelta[0];
				rx -= prefs.mouseLookSpeed * elapsed * Input.MouseDelta[1];
			} else if (Input.mouseDown(0, true)) { // HACK: Request pointer lock all the time
				Input.requestPointerLock();
			}

			let inputX = Input.getAxis(prefs.rightKey, prefs.leftKey, 0.05, Maths.Ease.inQuad);
			let inputY = Input.getAxis(prefs.upKey, prefs.downKey, 0.05, Maths.Ease.inQuad);
			let inputZ = Input.getAxis(prefs.backKey, prefs.forwardKey, 0.05, Maths.Ease.inQuad);
			
			if (!attemptSprint && Input.keyDown(prefs.forwardKey, true)) {
				if ((GameLoop.time - lastForwardPress) < sprintDoubleTapMaxDuration) {
					attemptSprint = true;
				}
				lastForwardPress = GameLoop.time;
			} else if (attemptSprint && !Input.keyDown(prefs.forwardKey)) {
				attemptSprint = false;
			}
			
			if (inputX !== 0 && inputZ !== 0) {
				// Normalize input vector if moving in more than one direction
				inputX /= Math.SQRT2;
				inputZ /= Math.SQRT2;
				// TODO: Consider / test inputVector.sqrMagnitude > 1 => normalize(inputVector)
			}

			localInputVector[0] = inputX;
			localInputVector[1] = inputY;
			localInputVector[2] = inputZ;

			isWalking = Input.keyDown(prefs.walkKey);
			attemptJump = Input.keyDown(prefs.jumpKey, true);

			// TODO: Move keys to prefs
			attemptPlacement = Input.mouseDown(2, true);
			attemptRemoval = Input.mouseDown(0, true);
		};

		let calculateGlobalXZInputVector = (out, localInputVector, forward, left) => {
			vec3.zero(out);
			vec3.scaleAndAdd(out, out, left, localInputVector[0]);
			vec3.scaleAndAdd(out, out, forward, localInputVector[2]);
		};

		let calculateMaxContactSpeed = (localInputVector, forward, left) => {
			// Q: Does maxContactSpeed work niavely or do we need to compensate for current movement direction?
			if (localInputVector[0] !== 0 && localInputVector[2] !== 0) {
				// Not actually sure |localX[0]| + |localZ[0]| / SQRT2 is correct, but its far better than what was there
				maxContactSpeed[0] = Math.min(maxMovementSpeed, (Math.abs(left[0]) + Math.abs(forward[0]) / Math.SQRT2) * maxContactSpeedFactor * maxMovementSpeed);
				maxContactSpeed[2] = Math.min(maxMovementSpeed, (Math.abs(left[2]) + Math.abs(forward[2]) / Math.SQRT2) * maxContactSpeedFactor * maxMovementSpeed);
			} else if (localInputVector[0] !== 0) {
				maxContactSpeed[0] = Math.min(maxMovementSpeed, Math.abs(left[0]) * maxMovementSpeed * maxContactSpeedFactor);
				maxContactSpeed[2] = Math.min(maxMovementSpeed, Math.abs(left[2]) * maxMovementSpeed * maxContactSpeedFactor);
			} else if (localInputVector[2] !== 0) {
				maxContactSpeed[0] = Math.min(maxMovementSpeed, Math.abs(forward[0]) * maxMovementSpeed * maxContactSpeedFactor);
				maxContactSpeed[2] = Math.min(maxMovementSpeed, Math.abs(forward[2]) * maxMovementSpeed * maxContactSpeedFactor);
			}
		};

		// Movement Variables
		let grounded = false, lastGroundedTime = 0, canCoyote = true, lastJumpAttemptTime = 0;
		let isSwimming = false, isInWater = false;

		let stepPeriods = {
			"swim": 0.8,
			"sneak": 0.75,
			"walk": 0.45,
			"run": 0.33
		};
		let timeSinceLastStep = 0; 
		let hasPlayedFirstStep = false;
		let lastMovementSfxAction = "walk";
		let lastGroundedVoxelMaterial = "ground";

		let jump = () => {
			Audio.play({ 
				uri: pickMaterialSfxUri(gameConfig.materials, lastGroundedVoxelMaterial, lastMovementSfxAction),
				mixer: Audio.mixers["sfx/footsteps"]
			});

			grounded = false;
			canCoyote = false;
			// Apply Jump Velocity!
			if (!isWalking && attemptSprint) {
				player.velocity[1] = jumpDeltaV;
			} else {
				player.velocity[1] = 0.9 * jumpDeltaV; // Slightly smaller jump when not sprinting
			}
		};


		// Potential Bug:
		// Without reducing step when not grounded if you jump whilst facing into a corner with 2 height blocks in front, adjacent blocks height one,
		// You reliably get a bigger jump than normal as the player steps up the double height voxel. 
		// This be the controller working as intended, but it would require a confluence of values which merits investigation

		
		// Nigh on impossible to drop into a space of one voxel when player box is 1x1 - as the passes are separated - and if you did you'd just step out
		player.update = (elapsed) => {
			detectInput(elapsed);

			// TODO: consider using local axes rather than ground axes when swimming
			calculateMaxContactSpeed(localInputVector, localGroundZ, localGroundX);

			if (isSwimming && !grounded) {
				calculateGlobalXZInputVector(inputVector, localInputVector, localZ, localX);
				maxMovementSpeed = player.config.maxSwimSpeed;
			} else {
				calculateGlobalXZInputVector(inputVector, localInputVector, localGroundZ, localGroundX);
				if (isWalking) {
					maxMovementSpeed = player.config.maxWalkSpeed;
				} else if (isInWater) {
					// Arguably should be allowed to sprint whilst wading
					maxMovementSpeed = player.config.maxWadeSpeed;
				} else {
					if (attemptSprint) {
						maxMovementSpeed = player.config.maxSprintSpeed;
					} else {
						maxMovementSpeed = player.config.maxRunSpeed;
					}
				}
			}

			// Directly rotate camera
			Maths.quatRotate(camera.rotation, camera.rotation, ry, Maths.vec3Y);
			let clampAngle = 0.5 * Math.PI - verticalApproachClampAngleDegrees * Math.PI/180;
			let lastVerticalLookAngle = verticalLookAngle;
			verticalLookAngle = Fury.Maths.clamp(verticalLookAngle + rx, -clampAngle, clampAngle);
			quat.rotateX(camera.rotation, camera.rotation, verticalLookAngle - lastVerticalLookAngle);

			// Calculate Movement
			if (grounded) {
				let vSqr = player.velocity[0] * player.velocity[0] + player.velocity[2] * player.velocity[2];
				let isSliding = vSqr > maxMovementSpeed * maxMovementSpeed + 0.001; // Fudge factor for double precision when scaling
				let acceleration = player.config.acceleration;

				if (isSliding) {
					// Only deceleration
					if (Math.sign(player.velocity[0]) != Math.sign(inputVector[0])) {
						player.velocity[0] += acceleration * elapsed * inputVector[0];
					}
					if (Math.sign(player.velocity[2]) != Math.sign(inputVector[2])) {
						player.velocity[2] += acceleration * elapsed * inputVector[2];
					}
				} else {
					// Accelerate
					player.velocity[0] += acceleration * elapsed * inputVector[0];
					player.velocity[2] += acceleration * elapsed * inputVector[2];
				}
		
				let groundSpeed = Math.sqrt(player.velocity[0] * player.velocity[0] + player.velocity[2] * player.velocity[2]);
				let anyInput = !!vec3.squaredLength(inputVector);
				
				if (!isSliding && anyInput) {
					// Limit Free movement speed if necessary
					if (groundSpeed > maxMovementSpeed) {
						vec3ScaleXZ(player.velocity, player.velocity, maxMovementSpeed / groundSpeed);
					} 
					// If in contact - limit speed on axis, to clamp sliding velocity
					if (contacts[0] !== 0) {
						player.velocity[2] = Math.sign(player.velocity[2]) * Math.min(Math.abs(player.velocity[2]), maxContactSpeed[2]);
					}
					if (contacts[2] !== 0) {
						player.velocity[0] = Math.sign(player.velocity[0]) * Math.min(Math.abs(player.velocity[0]), maxContactSpeed[0]);
					}
				} else if (groundSpeed > 0 && (!anyInput || isSliding)) {
					// Apply slow down force
					// This tries to model someone at a run deciding to stop if in the 0 to max movement speed range
					// Greater than this they are considered sliding and a different formula is used.
		
					let slowFactor = 2.5;	// Compeltely arbitary factor
					if (isSliding) {
						// Velocities larger than 24 m/s at 60fps (for 60 / slowFactor) are negated immediately when speed reduction proportional to v^2
						// So for velocities higher than this speed reduction proportional to v. Rationale is controller is "sliding" rather than coming to a 
						// controlled stop
						slowFactor *= 2 / groundSpeed;
					}
					
					let deltaV = groundSpeed * groundSpeed * slowFactor * elapsed;
					if (deltaV > groundSpeed) { 
						console.log("Warning: Calculated 'friction' greater than speed");
					}
					deltaV = Math.min(groundSpeed, deltaV);
		
					if(groundSpeed <= player.config.stopSpeed) {
						// Stop below a certain speed if not trying to move
						vec3.zero(player.velocity);
					} else if (groundSpeed != 0) {
						// Apply deceleration
						vec3ScaleXZ(player.velocity, player.velocity, (groundSpeed - deltaV) / groundSpeed);
					} else {
						vec3.zero(player.velocity);
					}
				}
			} else if (!isSwimming) {
				// Apply Drag
				// F(drag) = (1/2)pvvC(drag)A
				// p = density of fluid, v = velocity relative to fluid, C(drag) = drag co-efficient
				// https://www.engineeringtoolbox.com/drag-coefficient-d_627.html person ~= 1.0 - 1.3, cube is 0.8, rectangluar box is ~ 2.1
				// F = m dv/dt => dv = F dt / m
				// Q: Is the force you experience in 'hitting' water, entirely difference in F(drag) or is there surface tension to add?
				// dv = pvvC(d)A * dt / 2m (with A ~= 1 and C(d) ~= 1, p(air) = 1.225 (one atmosphere at 15 degrees C), p(water) = 997)
				// dv = (v*v*1.225*dt)/2m
		
				let airSpeed = vec3.length(player.velocity);
				let dragDv = (airSpeed * airSpeed * 1.225 * elapsed) / (2 * 100);	// Assumes air and mass of 100kg, drag coefficent of ~1 and surface area ~1 (it's probably less)
				// ^^ Technically surface area is different based on direction, so a more accurate model would break down vertical against others
		
				if (airSpeed < dragDv) {
					// This happens when elasped > 200 / 1.225 * airSpeed * airSpeed 
					// i.e. air speed > sqrt(200 * 60 / 1.225) ~= 99 m/s
					console.log("Warning: Calculated drag higher than air speed!");
					airSpeed = Math.max(0, airSpeed - dragDv);
				}

				// Update Air Velocity
				if (airSpeed !== 0) {
					vec3.scale(player.velocity, player.velocity, (airSpeed - dragDv) / airSpeed);
				} else {
					vec3.zero(player.velocity);
				}

				let airAcceleration = player.config.airAcceleration;
				let targetX = player.velocity[0] + airAcceleration * elapsed * inputVector[0];
				let targetZ = player.velocity[2] + airAcceleration * elapsed * inputVector[2];

				let maxAirSpeedSqr = player.config.airMaxMovementSpeed * player.config.airMaxMovementSpeed;
				let targetAirSpeedSqr = targetX * targetX + targetZ * targetZ;
				let canAccelerate = targetAirSpeedSqr < maxAirSpeedSqr;
				if (canAccelerate || Math.abs(targetX) < Math.abs(player.velocity[0])) {
					player.velocity[0] = targetX;
				}
				if (canAccelerate || Math.abs(targetZ) < Math.abs(player.velocity[2])) {
					player.velocity[2] = targetZ;
				}

				if (!(player.velocity[0] == targetX && player.velocity[2] == targetZ)) {
					let speedThresholdSqr = Math.max(player.config.maxRunSpeed * player.config.maxRunSpeed, maxAirSpeedSqr);
					let currentAirSpeedSqr = player.velocity[0] * player.velocity[0] + player.velocity[2] * player.velocity[2];
					if (currentAirSpeedSqr < speedThresholdSqr) {
						// Allow redirection of air movement below run speed (or max air speed if higher)
						let mod = Math.sqrt(currentAirSpeedSqr) / Math.sqrt(targetAirSpeedSqr);
						player.velocity[0] = mod * targetX;
						player.velocity[2] = mod * targetZ; 
					}
				}
			} else {
				// TODO: Move in water grounded logic here
				let swimSpeed = vec3.length(player.velocity);
				let dragDv = (swimSpeed * swimSpeed * 120 * elapsed) / (2 * 100);	// Assumes 'water' and mass of 100kg, drag coefficent of ~1 and surface area ~1 (it's probably less)
				// ^^ Technically surface area is different based on direction, so a more accurate model would break down vertical against others
				// Note the 120 density is just fudged to 'feel' right, no basis in reality
		
				if (swimSpeed < dragDv) {
					// This happens when elasped > 200 / 120 * swimSpeed * swimSpeed 
					// i.e. swim speed > sqrt(200 * 60 / 120) = 10 m/s
					console.log("Warning: Calculated drag higher than swim speed!");
					swimSpeed = Math.max(0, swimSpeed - dragDv);
				}

				// Update Swim Velocity
				if (swimSpeed !== 0) {
					vec3.scale(player.velocity, player.velocity, (swimSpeed - dragDv) / swimSpeed);
				} else {
					vec3.zero(player.velocity);
				}	

				let waterAcceleration = player.config.waterAcceleration;
				let targetX = player.velocity[0] + waterAcceleration * elapsed * inputVector[0];
				let targetY = player.velocity[1] + waterAcceleration * elapsed * inputVector[1] + localInputVector[1] * waterAcceleration * elapsed;
				let targetZ = player.velocity[2] + waterAcceleration * elapsed * inputVector[2];

				let maxSwimSpeedSqr = player.config.waterMaxMovementSpeed * player.config.waterMaxMovementSpeed; 
				let canAccelerate = targetX * targetX + targetY * targetY + targetZ * targetZ < maxSwimSpeedSqr;
				if (canAccelerate || Math.abs(targetX) < Math.abs(player.velocity[0])) {
					player.velocity[0] = targetX;
				}
				if (canAccelerate || (Math.abs(targetY) < Math.abs(player.velocity[1]) && player.velocity[1] * player.velocity[1] < maxSwimSpeedSqr)) {
					// Additional check, can only decelerate in Y when y is less than max swim speed (i.e. can't arrest entry speed when jumping in)
					player.velocity[1] = targetY;
				}
				if (canAccelerate || Math.abs(targetZ) < Math.abs(player.velocity[2])) {
					player.velocity[2] = targetZ;
				}
			}

			// Move Character by Velocity
			characterController.stepHeight = isInWater && !isSwimming ? 1 : grounded || isSwimming ? stepHeight : 0; // No stepping whilst in the air 
			// TODO: ^^ config based get out of water height - also probably a better way to check than !isSwimming
			let didStep = characterController.moveXZ(contacts, player.velocity, elapsed, inputVector);

			// Determine contact block
			// Also stop walking off edges
			if (grounded) 
			{
				let closestVoxelCoord = Maths.vec3Pool.request();
				let foundClosestGroundVoxel = tryGetClosestGroundVoxelCoords(closestVoxelCoord, vorld, player.box);
				if (foundClosestGroundVoxel) {
					if (isInWater) {
						lastGroundedVoxelMaterial = "water";
					} else {
						let groundBlock = Vorld.getBlock(vorld, closestVoxelCoord[0], closestVoxelCoord[1], closestVoxelCoord[2]);
						lastGroundedVoxelMaterial = BlockConfig.getBlockTypeDefinition(vorld, groundBlock).material;
					}
				}

				// Don't allow walking off edges
				// TODO: Allow you to walk down stairs but not off them
				if (isWalking && foundClosestGroundVoxel) {
					let overHangDist = 0.3;
					let shouldSnapBack = true;
					let origin = Fury.Maths.vec3Pool.request();
					
					if (shouldSnapBack) {
						vec3.scaleAndAdd(origin, player.position, Maths.vec3X, overHangDist);
						vec3.scaleAndAdd(origin, origin, Maths.vec3Z, overHangDist);
						shouldSnapBack &= (VorldPhysics.raycast(hitPoint, vorld, origin, castDirection, player.box.extents[1] + 0.5) == 0);
					}
					if (shouldSnapBack) {
						vec3.scaleAndAdd(origin, player.position, Maths.vec3X, overHangDist);
						vec3.scaleAndAdd(origin, origin, Maths.vec3Z, -overHangDist);
						shouldSnapBack &= (VorldPhysics.raycast(hitPoint, vorld, origin, castDirection, player.box.extents[1] + 0.5) == 0);
					}
					if (shouldSnapBack) {
						vec3.scaleAndAdd(origin, player.position, Maths.vec3Z, overHangDist);
						vec3.scaleAndAdd(origin, origin, Maths.vec3X, -overHangDist);
						shouldSnapBack &= (VorldPhysics.raycast(hitPoint, vorld, origin, castDirection, player.box.extents[1] + 0.5) == 0);
					}
					if (shouldSnapBack) {
						vec3.scaleAndAdd(origin, player.position, Maths.vec3X, -overHangDist);
						vec3.scaleAndAdd(origin, origin, Maths.vec3Z, -overHangDist);
						shouldSnapBack &= (VorldPhysics.raycast(hitPoint, vorld, origin, castDirection, player.box.extents[1] + 0.5) == 0);	
					}

					if (shouldSnapBack) {
						// If you're outside the bounds of the closest voxel on each axis
						// snap back to inside and adjust - NOTE: player.velocity is no longer 
						// an accurate measure of distance travelled in the frame
						if (player.position[0] < closestVoxelCoord[0] - overHangDist) {
							player.position[0] = closestVoxelCoord[0] - overHangDist;
							player.velocity[0] = 0;
						} else if (player.position[0] > closestVoxelCoord[0] + 1 + overHangDist) {
							player.position[0] = closestVoxelCoord[0] + 1 + overHangDist;
							player.velocity[0] = 0;
						}
						if (player.position[2] < closestVoxelCoord[2] - overHangDist) {
							player.position[2] = closestVoxelCoord[2] - overHangDist;
							player.velocity[2] = 0;
						} else if (player.position[2] > closestVoxelCoord[2] + 1 + overHangDist) {
							player.position[2] = closestVoxelCoord[2] + 1 + overHangDist;
							player.velocity[2] = 0;
						}
					}

					Fury.Maths.vec3Pool.return(origin);
				}
				// else - if not foundClosestVoxel - I guess you just fall off anyway
				Maths.vec3Pool.return(closestVoxelCoord);
			}

			// Footsteps
			if (grounded && vec3.sqrLen(player.velocity) > 0.1) {
				// TODO: Need to determine if wading (inWater is actually isUnderwater)
				// (currently no tracker, should be different speed)
				let action = "walk";
				if (isWalking || isInWater) {
					action = "sneak";
				} else if (attemptSprint) { // Can you sprint underwater?
					action = "run";
				}
				lastMovementSfxAction = action;

				let period = stepPeriods[action];
				timeSinceLastStep += elapsed;
				if ((didStep && timeSinceLastStep > 0.25) // Technically should play sound every step but it sounds silly when you're running up steps
					|| (hasPlayedFirstStep && timeSinceLastStep > period)
					|| (!hasPlayedFirstStep && timeSinceLastStep > 0.5 * period)) {
					
					Audio.play({ 
						uri: pickMaterialSfxUri(gameConfig.materials, lastGroundedVoxelMaterial, lastMovementSfxAction),
						mixer: Audio.mixers["sfx/footsteps"]
					});
					
					if (isInWater) {
						// Play the swooshes when walking through water too
						Audio.play({ 
							uri: pickMaterialSfxUri(gameConfig.materials, "water", "swim"),
							mixer: Audio.mixers["sfx/footsteps"]
						});
					}
					timeSinceLastStep = 0;
					hasPlayedFirstStep = true;
				}
			} else if (isInWater && vec3.sqrLen(localInputVector) > 0.1) { 
				// Note not "isSwimming" so as to not reset the swim period if you're dipping in and out of the surface of water whilst swimming 
				let action = "swim";
				let period = stepPeriods[action]; // 'step period'
				timeSinceLastStep += elapsed;
				if (!hasPlayedFirstStep || timeSinceLastStep > period) {
					Audio.play({ 
						uri: pickMaterialSfxUri(gameConfig.materials, "water", action),
						mixer: Audio.mixers["sfx/footsteps"]
					});
					timeSinceLastStep = 0;
					hasPlayedFirstStep = true;
				}
			} else {
				hasPlayedFirstStep = false;
				timeSinceLastStep = 0;
			}

			// Now Gravity / Jumping
			if (!isSwimming) {
				player.velocity[1] -= gravity * elapsed;
			} else {
				// TODO: should have gravity vs buoyancy 
				// (this means less buoyancy when you're partially out of the water, and 'more' when you're deeper)
				// Just assuming it cancels for now
				// TODO:
				// * when swimming move in bursts as if you're performing strokes (although this would imply headbob for walking)?
				grounded = VorldPhysics.raycast(hitPoint, vorld, player.position, castDirection, player.box.extents[1] + 0.5) !== 0;
			}

			if (attemptJump) {
				if (grounded || canCoyote && (GameLoop.time - lastGroundedTime < coyoteTime)) {
					jump();
				} else {
					lastJumpAttemptTime = GameLoop.time;
				}
			}

			// Y Move - contacts[1] will be -1 if touches ground
			characterController.moveY(contacts, player.velocity, elapsed);

			let wasInWater = isInWater;
			isInWater = gameConfig.blockIds["water"] === Vorld.getBlock(
				vorld, 
				Math.floor(player.position[0]),
				Math.floor(player.box.min[1] + 0.1),
				Math.floor(player.position[2]));

			if (contacts[1] == -1) {
				lastGroundedTime = GameLoop.time;

				if (!grounded) {
					// Landed! (May jump immediately though)
					// Re-determine grounded voxel (as it'll be out of date)
					let closestVoxelCoord = Maths.vec3Pool.request();
					if (tryGetClosestGroundVoxelCoords(closestVoxelCoord, vorld, player.box)) {
						let groundBlock = Vorld.getBlock(vorld, closestVoxelCoord[0], closestVoxelCoord[1], closestVoxelCoord[2]);
						lastGroundedVoxelMaterial = BlockConfig.getBlockTypeDefinition(vorld, groundBlock).material;
					}
					Maths.vec3Pool.return(closestVoxelCoord);
				}

				if (!grounded && lastGroundedTime - lastJumpAttemptTime < coyoteTime) {
					jump();
				} else {
					if (!grounded) {
						// Landed! (and didn't jump - which will play it's own SFX)
						Audio.play({ 
							uri: pickMaterialSfxUri(gameConfig.materials, lastGroundedVoxelMaterial, lastMovementSfxAction),
							mixer: Audio.mixers["sfx/footsteps"]
						});
						hasPlayedFirstStep = true;
					}
					grounded = true;
					canCoyote = true;
				}
			} else {
				if (grounded && player.velocity[1] < 0) {
					// Walked off edge
					grounded = false;
				}
			}

			// Determine is in water / is swimming
			if (!wasInWater && isInWater) {
				// Entered Water
				if (vec3.length(player.velocity) > 18) {
					// BIG splash!
					Audio.play({ 
						uri: pickMaterialSfxUri(gameConfig.materials, "water", "enter_fast"),
						mixer: Audio.mixers["sfx/footsteps"]
					}, 0, false, 5);
				} else {
					Audio.play({ 
						uri: pickMaterialSfxUri(gameConfig.materials, "water", "enter"),
						mixer: Audio.mixers["sfx/footsteps"]
					});
				}
			} else if (wasInWater && !isInWater) {
				// Exited water
				Audio.play({ 
					uri: pickMaterialSfxUri(gameConfig.materials, "water", "exit"),
					mixer: Audio.mixers["sfx/footsteps"]
				});
			}

			// let wasSwimming = isSwimming;
			// Arguably this could just be isInWater and !grounded?
			isSwimming = gameConfig.blockIds["water"] == Vorld.getBlock(
				vorld,
				Math.floor(player.position[0]),
				Math.floor(player.position[1]),
				Math.floor(player.position[2]));

			// Smol Splash noises?
			/*
			if (wasSwimming && !isSwimming) {
				console.log("Stopped Swimming!");
			} else if (!wasSwimming && isSwimming) {
				console.log("Started swimming"); // Not strictly true actually this is when you start swimming 
			}
			*/
			
			// Smoothly move the camera - no jerks from sudden movement please!
			// Technically displacement isn't the issue, it's acceleration
			// Arguably the change due to falling if there is any, we should just do,
			// as that should always be smooth
			vec3.copy(cameraTargetPosition, player.position);
			vec3.scaleAndAdd(cameraTargetPosition, cameraTargetPosition, Maths.vec3Y, cameraOffset);
			if (vec3.squaredLength(cameraTargetPosition) < 0.1) {
				vec3.copy(camera.position, cameraTargetPosition);
			} else {
				vec3.lerp(camera.position, camera.position, cameraTargetPosition, 0.25);
			}

			if (waterQuad) {
				// Set active if any part of the near clip plane would be in water
				let x = Math.floor(camera.position[0]), y = Math.floor(camera.position[1] - 1.001 * camera.near), z = Math.floor(camera.position[2]);
				waterQuad.active = Vorld.getBlock(vorld, x, y, z) == gameConfig.blockIds["water"]; 
				// TODO: Should check if actually water, and show different properties depending on block type but for now any non-solid block is 'water'
				if (waterQuad.active) {
					// HACK: When light levels are near 0 the quad becomes effectively transparent despite the shader treating alpha separately
					// Whilst we investigate how to fix this, provide a minimum light level of 3 so there's always some obscuring (any higher looks bad at night)
					waterQuad.material.lightLevel = Math.max(3, VorldLighting.interpolateLight(vorld, camera.position));
					waterQuad.material.sunlightLevel = VorldLighting.interpolateSunlight(vorld, camera.position);

					let upperY = Math.floor(camera.position[1] + 1.001 * camera.near); 
					waterQuad.transform.scale[0] = camera.ratio; // technically overkill, as we're closer than 1
					quat.copy(waterQuad.transform.rotation, camera.rotation);
					let targetPoint = vec3Pool.request();
					vec3.transformQuat(targetPoint, Maths.vec3Z, camera.rotation);
					vec3.scaleAndAdd(waterQuad.transform.position, camera.position, targetPoint, - 1.001 * camera.near); 

					if (upperY != y && !Vorld.getBlock(vorld, x, upperY, z)) {
						// Top of near clip plane could be outside the water need to adjust so the quad only covers the appropriate screen area
						// Move in camera localY until the top vertices are at upperY
						let localY = targetPoint; // Reuse target point vec3
						vec3.transformQuat(localY, Maths.vec3Y, camera.rotation);
						let currentY = waterQuad.transform.position[1] + 0.5 * waterQuad.transform.scale[1] * localY[1];
						let distanceToMove = (upperY - currentY) * localY[1];
						vec3.scaleAndAdd(waterQuad.transform.position, waterQuad.transform.position, localY, distanceToMove);
					}

					vec3Pool.return(targetPoint);
				}
			}

			// Block placement
			// DEBUG - block placement change
			// TODO: Need a throttle on changes due to MouseWheel
			if (blockInventory.length) {
				if (Input.keyDown("[", true) || Input.MouseWheel[1] > 0) {
					blockIndex = (blockIndex - 1) % blockInventory.length;
					if (blockIndex < 0) blockIndex = blockInventory.length - 1;
				}
				if (Input.keyDown("]", true) || Input.MouseWheel[1] < 0) {
					blockIndex = (blockIndex + 1) % blockInventory.length;
				}
			}

			let blockToPlace = blockInventory[blockIndex];

			let cameraLookDirection = Maths.vec3Pool.request();
			camera.getLookDirection(cameraLookDirection);

			let pickedObject = null;
			if (!player.heldObject)
			{
				pickedObject = world.pickClosestCarriableEntity(hitPoint, camera.position, cameraLookDirection, placementDistance);
			}

			if (!player.heldObject && !pickedObject && BlockPlacer.raycast(hitInfo, vorld, camera.position, cameraLookDirection, placementDistance)) {
				if (attemptPlacement && blockToPlace) {
					let blockPlacementInfo = BlockPlacer.placeBlock(vorldController, vorld, blockToPlace, hitInfo, cameraLookDirection);
	
					if (!placementConfig.isCreativeMode) { // TODO: Option to carry more than one
						blockInventory.splice(blockIndex, 1); // Remove placed block
					}
	
					Audio.play({
						uri: pickMaterialSfxUri(gameConfig.materials, BlockConfig.getBlockTypeDefinition(vorld, blockToPlace).material, "add"),
						mixer: Audio.mixers["sfx"]
					});

					let [ x, y, z ] = blockPlacementInfo.position;
					if (parameters.onBlockPlaced) {
						parameters.onBlockPlaced(blockToPlace, x, y, z);
					}
					// Note removed held object lerp from position logic
				} else if (attemptRemoval) {
					let [ x, y, z ] = hitInfo.position;
	
					let blockToRemove = Vorld.getBlock(vorld, x, y, z);
	
					let canRemoveBlock = false;
					let canPickupBlock = false;
	
					canPickupBlock = placementConfig.pickupableBlocks.includes(blockToRemove) 
						&& (placementConfig.isCreativeMode || !blockInventory.includes(blockToRemove)); // Currently limited to 1
					canRemoveBlock = (placementConfig.isCreativeMode || placementConfig.destroyableBlocks.includes(blockToRemove));
	
					let isPickingUpBlock = (!placementConfig.isCreativeMode || !blockInventory.includes(blockToRemove));
	
					if (isPickingUpBlock) {
						// HACK - In creative mode items are never removed from your inventory 
						// TODO: Tidy this up by making inventory a module with an create option to not consume
						// always contain etc then we can just call inventory.remove(block) and not have the extra logic here
						blockInventory.push(blockToRemove);
						// Note removed held object lerping to position code
					}
	
					if (canPickupBlock || canRemoveBlock) {
						Audio.play({
							uri: pickMaterialSfxUri(gameConfig.materials, BlockConfig.getBlockTypeDefinition(vorld, blockToRemove).material, "remove"),
							mixer: Audio.mixers["sfx"]
						});

						vorldController.removeBlock(vorld, x, y, z);
	
						if (parameters.onBlockRemoved) {
							parameters.onBlockRemoved(blockToRemove, x, y, z);
						}	
					}
				} else if (blockPreview) {
					let [ x, y, z ] = hitInfo.position;
					let targetBlock = Vorld.getBlock(vorld, x, y, z);
					if (placementConfig.isCreativeMode
						|| placementConfig.destroyableBlocks.includes(targetBlock) 
						|| placementConfig.pickupableBlocks.includes(targetBlock)) {
						blockPreview.active = true;
						vec3.copy(blockPreview.transform.position, hitInfo.position);
					} else {
						blockPreview.active = false;
					}
				}
			} else {
				if (blockPreview) {
					blockPreview.active = false;
				}
			}
			Maths.vec3Pool.return(cameraLookDirection);
			
			// TODO: Pick up input to prefs
			if (!player.heldObject && pickedObject && Input.mouseDown(0, true)) {
				// Pick up object
				player.heldObject = pickedObject;
			} else if (player.heldObject && Input.mouseDown(0, true)) {
				// Drop object
				// TODO: Remove this dropping code once we make them psuedo physics objects
				if (VorldPhysics.raycast(hitPoint, vorld, player.heldObject.collider.bounds.center, castDirection, 10)) {
					vec3.copy(player.heldObject.transform.position, hitPoint);
				}
				player.heldObject = null;
			}

			if (player.heldObject) {
				let position = player.heldObject.transform.position;
				vec3.negate(position, Maths.vec3Z);
				vec3.transformQuat(position, position, camera.rotation);
				vec3.subtract(position, position, player.heldObject.collider.offset);
				position[1] -= 0.25; // Offset want it a little below the camera
				vec3.add(position, position, camera.position);
				// Would be nice to rotate the object in the X/Z plane to match - we'd have to reset the rotation on drop though given that non of the physics is object aligned
			}
		};

		player.teleport = (pos) => {
			vec3.copy(player.position, pos);
			vec3.scaleAndAdd(camera.position, player.position, Maths.vec3Y, cameraOffset); 
			vec3.zero(player.velocity);
		};

		return player;
	};

	return exports;
})();