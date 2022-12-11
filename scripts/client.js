const Fury = require('fury');

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

    // TODO: Load required assets and start game
});