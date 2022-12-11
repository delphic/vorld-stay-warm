const Fury = require('fury');
const Game = require('./game');
const GameConfig = require('./gameConfig');

const canvasId = "fury";

window.addEventListener('load', () => {
	const glCanvas = document.getElementById(canvasId);

	// Set Canvas full-screen
	let resolutionFactor = 1.0;
	glCanvas.style = "width: 100%; height: 100vh";
	document.body.style = "margin: 0; overflow-y: hidden;";
	let updateCanvasSize = () => {
		glCanvas.width = resolutionFactor * glCanvas.clientWidth;
		glCanvas.height = resolutionFactor * glCanvas.clientHeight;
	};
	window.addEventListener('resize', updateCanvasSize);
	updateCanvasSize();

	Fury.init({ canvasId: canvasId });

	fetch("data/game.json").then(response => response.json()).then(json => {
		let gameConfig = GameConfig.parse(json);
		Game.init({ canvas: glCanvas, gameConfig: gameConfig });
	});
	// TODO: Handle error
});