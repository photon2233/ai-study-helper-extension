/**
 * Module for the screenshot capture and cropping tool.
 *
 * Features:
 * - Displays the captured tab screenshot on a full-window canvas.
 * - Allows the user to select a rectangular area for cropping.
 * - Handles mouse interactions: mousedown, mousemove, mouseup for selection.
 * - Generates cropped image data and stores it in chrome.storage.
 * - Notifies background script when screenshot is finalized.
 * - Supports canceling via button or Escape key.
 *
 * Design notes:
 * - The canvas overlay darkens unselected areas for better visual feedback.
 * - Captured images are scaled to maintain resolution relative to the original tab.
 * - Window closing is managed by background.js to ensure Popup opens reliably.
 */

const canvas = document.getElementById('screenshot-canvas');
const ctx = canvas.getContext('2d');
const captureBtn = document.getElementById('captureBtn');
const cancelBtn = document.getElementById('cancelBtn');
const instruction = document.getElementById('instruction');

let originalImage = null;
let isSelecting = false;
let startX, startY, endX, endY;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

chrome.runtime.sendMessage({ action: "getCapturedImage" }, (response) => {
    if (response && response.dataUrl) {
        const img = new Image();
        img.onload = () => {
            originalImage = img;
            drawCanvas();
        };
        img.src = response.dataUrl;
    } else {
        alert("Failed to capture screenshot.");
        window.close();
    }
});


function drawCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (originalImage) {
        ctx.drawImage(originalImage, 0, 0, originalImage.width, originalImage.height, 0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (isSelecting && startX !== undefined) {
        const x = Math.min(startX, endX);
        const y = Math.min(startY, endY);
        const w = Math.abs(endX - startX);
        const h = Math.abs(endY - startY);
        ctx.clearRect(x, y, w, h);
        if (originalImage) {
            const scaleX = originalImage.width / canvas.width;
            const scaleY = originalImage.height / canvas.height;
            ctx.drawImage(originalImage, x * scaleX, y * scaleY, w * scaleX, h * scaleY, x, y, w, h);
        }
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
    }
}


canvas.addEventListener('mousedown', (e) => {
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    endX = startX;
    endY = startY;
    captureBtn.disabled = true;
    drawCanvas();
});

canvas.addEventListener('mousemove', (e) => {
    if (isSelecting) {
        endX = e.clientX;
        endY = e.clientY;
        drawCanvas();
    }
});

canvas.addEventListener('mouseup', (e) => {
    if (isSelecting) {
        const w = Math.abs(endX - startX);
        const h = Math.abs(endY - startY);
        if (w > 10 && h > 10) {
            captureBtn.disabled = false;
            instruction.textContent = `✅ Selected ${Math.round(w)} × ${Math.round(h)} - Click "Capture"`;
        }
        isSelecting = false;
    }
});


captureBtn.addEventListener('click', () => {
    if (!originalImage) return;
    
    captureBtn.disabled = true;
    captureBtn.textContent = "Saving...";

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);
    
    const scaleX = originalImage.width / canvas.width;
    const scaleY = originalImage.height / canvas.height;
    
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = w * scaleX;
    cropCanvas.height = h * scaleY;
    const cropCtx = cropCanvas.getContext('2d');
    
    cropCtx.drawImage(
        originalImage,
        x * scaleX, y * scaleY, w * scaleX, h * scaleY,
        0, 0, cropCanvas.width, cropCanvas.height
    );
    
    const croppedImage = cropCanvas.toDataURL('image/png');

    chrome.storage.local.set({
        capturedScreenshot: croppedImage,
        pendingMode: 'default'
    }, () => {
        console.log("Data saved, notifying background...");
        chrome.runtime.sendMessage({ action: "screenshotCaptured" });
        
    });
});

cancelBtn.addEventListener('click', () => window.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });