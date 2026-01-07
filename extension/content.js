/**
 * Module for relaying messages from the background script to the extension popup.
 *
 * Features:
 * - Listens for background messages requesting text processing.
 * - Forwards the text and mode to the popup via a secondary runtime message.
 * - Uses chrome.storage as a fallback medium because popups cannot directly receive messages when closed.
 *
 * Design notes:
 * - pendingText and pendingMode are initialized to null to ensure clean state.
 * - This module ensures smooth communication between background and popup scripts.
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processText") {
    chrome.runtime.sendMessage({
      action: "openPopupWithText",
      text: request.text,
      mode: request.mode
    });
  }
});

chrome.storage.local.set({
  pendingText: null,
  pendingMode: null
});