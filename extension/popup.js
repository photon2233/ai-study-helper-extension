/**
 * Main script for the AI Study Helper extension popup.
 *
 * Features:
 * - Initializes popup UI and binds all event listeners.
 * - Handles text input, image upload, and screenshot capture.
 * - Maintains conversation history and settings in chrome.storage.
 * - Sends messages to the backend chat API (text and/or image).
 * - Renders user and assistant messages in the chat container.
 * - Supports exporting conversation as Markdown.
 *
 * Design notes:
 * - Pending data from right-click menu or capture tab is checked on load.
 * - Images are stored in memory and cropped to Base64; storage version replaces actual image data with a placeholder for efficiency.
 * - Loading states and UX feedback (e.g., "Thinking...") are handled to improve user experience.
 * - All message sending is async and streamed, updating the chat in real time.
 */

const STORAGE_KEY = 'ai_study_extension_history';
const SETTINGS_KEY = 'ai_study_extension_settings';
let messages = [];
let currentImage = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log("Popup initializing...");
    
     // Bind event listeners for buttons and inputs
    document.getElementById('btn').addEventListener('click', ask);
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('imageInput').click();
    });
    document.getElementById('screenshotBtn').addEventListener('click', captureScreen);
    document.getElementById('imageInput').addEventListener('change', handleImageSelect);
    document.getElementById('removeBtn').addEventListener('click', removeImage);
    document.getElementById('exportBtn').addEventListener('click', exportChat);
    document.getElementById('clearBtn').addEventListener('click', clearChat);
    
    document.getElementById('modelSelect').addEventListener('change', saveSettings);
    document.getElementById('modeSelect').addEventListener('change', saveSettings);
    
    document.getElementById('question').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ask();
        }
    });
    
    loadSettings();
    loadHistory();
    checkPendingData();
    
    console.log("Popup initialized successfully!");
});

// Save selected model and prompt
function saveSettings() {
    const settings = {
        modelName: document.getElementById('modelSelect').value,
        promptId: document.getElementById('modeSelect').value
    };
    chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    console.log("Settings saved:", settings);
}

function loadSettings() {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
        if (result[SETTINGS_KEY]) {
            const settings = result[SETTINGS_KEY];
            document.getElementById('modelSelect').value = settings.modelName || 'gemini-2.5-flash';
            document.getElementById('modeSelect').value = settings.promptId || 'default';
            console.log("Settings loaded:", settings);
        }
    });
}

// Check if there is text or image passed from right-click menu or capture tool
function checkPendingData() {
    chrome.storage.local.get(['pendingText', 'pendingMode', 'pendingImageUrl', 'capturedScreenshot'], (result) => {
        console.log("Checking pending data:", result);
        
        if (result.pendingText) {
            document.getElementById('question').value = result.pendingText;
            if (result.pendingMode) {
                document.getElementById('modeSelect').value = result.pendingMode;
                saveSettings(); 
            }
            chrome.storage.local.remove(['pendingText', 'pendingMode']);
            document.getElementById('question').focus();
        }
        
        if (result.pendingImageUrl) {
            fetch(result.pendingImageUrl)
                .then(res => res.blob())
                .then(blob => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        currentImage = e.target.result;
                        document.getElementById('previewImg').src = currentImage;
                        document.getElementById('imageInfo').textContent = 'Image from webpage';
                        document.getElementById('imagePreview').style.display = 'block';
                    };
                    reader.readAsDataURL(blob);
                })
                .catch(err => {
                    console.error('Failed to load image:', err);
                });
            chrome.storage.local.remove(['pendingImageUrl']);
        }
        
        if (result.capturedScreenshot) {
            console.log("Screenshot detected, loading...");
            currentImage = result.capturedScreenshot;
            document.getElementById('previewImg').src = currentImage;
            document.getElementById('imageInfo').textContent = '📸 Screenshot captured';
            document.getElementById('imagePreview').style.display = 'block';
            chrome.storage.local.remove(['capturedScreenshot']);
            document.getElementById('question').focus();
        }
    });
}

// --- Screen capture ---
function captureScreen() {
    console.log("Capture screen clicked");
    try {
        chrome.runtime.sendMessage({ action: "startCapture" });
    } catch (err) {
        console.error("Screenshot error:", err);
        alert("Screenshot failed: " + err.message);
    }
}

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    console.log("Image selected:", file.name);
    
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file!');
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB!');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        currentImage = e.target.result;
        document.getElementById('previewImg').src = currentImage;
        document.getElementById('imageInfo').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('imagePreview').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

function removeImage() {
    console.log("Remove image clicked");
    currentImage = null;
    document.getElementById('imageInput').value = '';
    document.getElementById('imagePreview').style.display = 'none';
}


async function ask() {
    console.log("Ask function called");
    const input = document.getElementById("question");
    const q = input.value.trim();
    
    if (!q && !currentImage) {
        console.log("No text or image to send");
        return;
    }
    
    const modelName = document.getElementById("modelSelect").value;
    const promptId = document.getElementById("modeSelect").value;
    
    console.log("Sending message:", { text: q, hasImage: !!currentImage, model: modelName });
    
    const parts = [];
    if (q) {
        parts.push({ type: "text", content: q });
    }
    if (currentImage) {
        const base64Data = currentImage.split(',')[1];
        parts.push({ type: "image", content: base64Data });
    }
    
    messages.push({ role: "user", parts: parts });
    renderMessage("user", parts);
    saveHistory();
    
    input.value = "";
    removeImage();
    setLoading(true);

    try {
        const res = await fetch("http://127.0.0.1:8000/chat_stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: messages,
                model_name: modelName,
                prompt_id: promptId
            })
        });

        if (!res.ok) throw new Error(`API Error: ${res.status}`);

        const assistantMsg = createMessageElement("assistant", [{ type: "text", content: "" }]);
        const textElement = assistantMsg.querySelector('.message-text') || assistantMsg;
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;
            textElement.textContent = fullText;
            scrollToBottom();
        }

        messages.push({ role: "assistant", parts: [{ type: "text", content: fullText }] });
        saveHistory();
        
        console.log("Message sent successfully");

    } catch (err) {
        console.error("Error sending message:", err);
        renderMessage("assistant", [{ type: "text", content: "❌ Error: " + err.message }]);
    } finally {
        setLoading(false);
    }
}


function renderMessage(role, parts) {
    const el = createMessageElement(role, parts);
    scrollToBottom();
    return el;
}


function createMessageElement(role, parts) {
    const container = document.getElementById("chatContainer");
    const div = document.createElement("div");
    div.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
    
    parts.forEach(part => {
        if (part.type === "text") {
            const textSpan = document.createElement("span");
            textSpan.className = "message-text";
            textSpan.textContent = part.content;
            div.appendChild(textSpan);
        } else if (part.type === "image") {
            const img = document.createElement("img");
            img.className = "message-image";
            img.src = part.content.startsWith('data:') ? part.content : `data:image/jpeg;base64,${part.content}`;
            div.appendChild(img);
        }
    });
    
    container.appendChild(div);
    return div;
}

function scrollToBottom() {
    const c = document.getElementById("chatContainer");
    c.scrollTop = c.scrollHeight;
}

function setLoading(isLoading) {
    document.getElementById("btn").disabled = isLoading;
    document.getElementById("status").textContent = isLoading ? "Thinking..." : "Ready";
}

function saveHistory() {
    const lightMessages = messages.map(msg => ({
        role: msg.role,
        parts: msg.parts.map(part => {
            if (part.type === "image") {
                return { type: "image", content: "[Image data removed for storage]" };
            }
            return part;
        })
    }));
    chrome.storage.local.set({ [STORAGE_KEY]: lightMessages });
}

function loadHistory() {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
        if (result[STORAGE_KEY]) {
            messages = result[STORAGE_KEY];
            messages.forEach(m => {
                const validParts = m.parts.filter(p => p.content !== "[Image data removed for storage]");
                if (validParts.length > 0) {
                    renderMessage(m.role, validParts);
                }
            });
        }
    });
}

function clearChat() {
    console.log("Clear chat clicked");
    if (confirm("Clear all conversation history?")) {
        messages = [];
        document.getElementById("chatContainer").innerHTML = "";
        saveHistory();
        removeImage();
    }
}

function exportChat() {
    console.log("Export chat clicked");
    if (messages.length === 0) {
        return alert("No conversation to export!");
    }

    let content = "# AI Study Helper - Chat History\n\n";
    content += `Date: ${new Date().toLocaleString()}\n`;
    content += "----------------------------------------\n\n";

    messages.forEach(msg => {
        const roleName = msg.role === 'user' ? '👤 User' : '🤖 AI';
        content += `### ${roleName}:\n`;
        
        msg.parts.forEach(part => {
            if (part.type === "text") {
                content += part.content + "\n";
            } else if (part.type === "image") {
                content += "[Image attached]\n";
            }
        });
        
        content += "\n---\n\n";
    });

    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    
    chrome.downloads.download({
        url: url,
        filename: `study-chat-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.md`,
        saveAs: true
    });
}