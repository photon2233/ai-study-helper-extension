/**
 * Background script for the Chrome extension.
 *
 * Responsibilities:
 * - Register context menu items for text and image actions
 * - Handle user interactions from context menus
 * - Coordinate screenshot capture and cropping workflow
 * - Act as a message hub between popup, capture page, and content scripts
 */
let capturedImageData = null;


// 1. Create context menu items
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "explainText",
    title: "📖 AI Explain Selected Text",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "solveText",
    title: "🧮 AI Solve This Problem",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "analyzeImage",
    title: "🔍 AI Analyze This Image",
    contexts: ["image"]
  });
});


// 2. Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "explainText" || info.menuItemId === "solveText") {
    const mode = info.menuItemId === "explainText" ? "explainer" : "solver";
    
    chrome.storage.local.set({
      pendingText: info.selectionText,
      pendingMode: mode
    }, () => {
      chrome.action.openPopup();
    });
  } 
  else if (info.menuItemId === "analyzeImage") {
    chrome.storage.local.set({
      pendingImageUrl: info.srcUrl,
      pendingMode: "default"
    }, () => {
      chrome.action.openPopup();
    });
  }
});

// 3. Core logic: message handling between popup and capture pages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  // A. Start screenshot capture flow
  if (request.action === "startCapture") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        capturedImageData = dataUrl; 
        chrome.tabs.create({
          url: chrome.runtime.getURL("capture.html"),
          active: true
        });
      });
    });
    return true; 
  }
  
  // B. Retrieve captured image data
  if (request.action === "getCapturedImage") {
    sendResponse({ dataUrl: capturedImageData });
    return true;
  }
  
  // C. Handle screenshot completion
  if (request.action === "screenshotCaptured") {
    capturedImageData = null;
    
    console.log("Screenshot logic complete. Closing capture tab and opening popup...");
    
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id);
    }

    chrome.action.openPopup();
    
    return true;
  }
});