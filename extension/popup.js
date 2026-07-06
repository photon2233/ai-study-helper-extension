/**
 * Main script for the AI Study Helper extension popup.
 *
 * Multi-session version:
 * - Sessions are stored as an array under SESSIONS_KEY in chrome.storage.local
 * - Active session id stored under CURRENT_SESSION_KEY
 * - Drawer UI lets the user switch between, create, and delete sessions
 * - Each session's first round triggers an AI-generated title via /chat_stream
 */

const SESSIONS_KEY = 'ai_study_sessions';
const CURRENT_SESSION_KEY = 'ai_study_current';
const SETTINGS_KEY = 'ai_study_extension_settings';
const API_KEY_STORAGE = 'ai_study_api_key';
const LEGACY_HISTORY_KEY = 'ai_study_extension_history';
const API_BASE = 'http://127.0.0.1:8000';
const DEFAULT_TITLE = '新会话';

let apiKey = '';
let kbEnabled = false;

let sessions = [];
let currentSessionId = null;
let currentImage = null;

document.addEventListener('DOMContentLoaded', () => {
    console.log("Popup initializing...");

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

    document.getElementById('historyBtn').addEventListener('click', openDrawer);
    document.getElementById('closeDrawerBtn').addEventListener('click', closeDrawer);
    document.getElementById('newSessionBtn').addEventListener('click', () => {
        createNewSession();
    });
    document.getElementById('drawerOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'drawerOverlay') closeDrawer();
    });

    document.getElementById('kbBtn').addEventListener('click', openKb);
    document.getElementById('closeKbBtn').addEventListener('click', closeKb);
    document.getElementById('kbUploadBtn').addEventListener('click', () => {
        document.getElementById('kbFileInput').click();
    });
    document.getElementById('kbFileInput').addEventListener('change', uploadKbFile);
    document.getElementById('kbOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'kbOverlay') closeKb();
    });
    document.getElementById('kbToggle').addEventListener('change', (e) => {
        kbEnabled = e.target.checked;
        document.getElementById('kbToggleLabel').classList.toggle('on', kbEnabled);
        saveSettings();
    });

    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('cancelKeyBtn').addEventListener('click', closeSettings);
    document.getElementById('saveKeyBtn').addEventListener('click', saveApiKey);
    document.getElementById('clearKeyBtn').addEventListener('click', clearApiKey);
    document.getElementById('settingsOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'settingsOverlay') closeSettings();
    });

    document.getElementById('question').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            ask();
        }
    });

    loadSettings();
    loadApiKey();
    bootstrapSessions();

    console.log("Popup initialized successfully!");
});

// --- Settings ---
function saveSettings() {
    const settings = {
        modelName: document.getElementById('modelSelect').value,
        promptId: document.getElementById('modeSelect').value,
        kbEnabled: kbEnabled
    };
    chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

function loadSettings() {
    chrome.storage.local.get([SETTINGS_KEY], (result) => {
        if (result[SETTINGS_KEY]) {
            const settings = result[SETTINGS_KEY];
            document.getElementById('modelSelect').value = settings.modelName || 'gemini-2.5-flash';
            document.getElementById('modeSelect').value = settings.promptId || 'default';
            kbEnabled = !!settings.kbEnabled;
            document.getElementById('kbToggle').checked = kbEnabled;
            document.getElementById('kbToggleLabel').classList.toggle('on', kbEnabled);
        }
    });
}

// --- Knowledge base ---
function openKb() {
    document.getElementById('kbOverlay').classList.add('open');
    renderKbList();
}

function closeKb() {
    document.getElementById('kbOverlay').classList.remove('open');
    document.getElementById('kbUploadStatus').textContent = '';
}

async function renderKbList() {
    const list = document.getElementById('kbList');
    list.innerHTML = '<div class="empty-hint">加载中...</div>';
    try {
        const res = await fetch(`${API_BASE}/kb/docs`);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();
        const docs = data.documents || [];

        list.innerHTML = '';
        if (docs.length === 0) {
            list.innerHTML = '<div class="empty-hint">知识库为空，点击"上传文档"添加</div>';
            return;
        }

        docs.forEach(doc => {
            const row = document.createElement('div');
            row.className = 'kb-doc';

            const name = document.createElement('span');
            name.className = 'kb-doc-name';
            name.textContent = doc.doc_name;
            name.title = doc.doc_name;

            const meta = document.createElement('span');
            meta.className = 'kb-doc-meta';
            meta.textContent = `${doc.chunks} 块`;

            const del = document.createElement('button');
            del.className = 'session-delete';
            del.textContent = '✕';
            del.title = '删除文档';
            del.addEventListener('click', async () => {
                if (!confirm(`删除文档 "${doc.doc_name}"？`)) return;
                await fetch(`${API_BASE}/kb/docs/${doc.doc_id}`, { method: 'DELETE' });
                renderKbList();
            });

            row.appendChild(name);
            row.appendChild(meta);
            row.appendChild(del);
            list.appendChild(row);
        });
    } catch (err) {
        list.innerHTML = `<div class="empty-hint">加载失败：${err.message}（后端未启动？）</div>`;
    }
}

async function uploadKbFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    const status = document.getElementById('kbUploadStatus');
    status.textContent = `⏳ 正在解析并向量化 "${file.name}"...`;

    const formData = new FormData();
    formData.append('file', file);
    if (apiKey) formData.append('api_key', apiKey);

    try {
        const res = await fetch(`${API_BASE}/kb/upload`, { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `API Error: ${res.status}`);
        }
        const result = await res.json();
        status.textContent = `✅ "${result.doc_name}" 已入库（${result.chunks} 块）`;
        renderKbList();
    } catch (err) {
        status.textContent = `❌ 上传失败：${err.message}`;
    }
}

// --- API Key ---
function loadApiKey() {
    chrome.storage.local.get([API_KEY_STORAGE], (result) => {
        apiKey = result[API_KEY_STORAGE] || '';
    });
}

function maskKey(key) {
    if (!key) return '未设置';
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
}

function openSettings() {
    const status = document.getElementById('keyStatus');
    const input = document.getElementById('apiKeyInput');
    if (apiKey) {
        status.className = 'modal-status ok';
        status.textContent = `✓ 已配置：${maskKey(apiKey)}`;
    } else {
        status.className = 'modal-status warn';
        status.textContent = '⚠ 尚未设置 API Key，发送消息将失败';
    }
    input.value = '';
    document.getElementById('settingsOverlay').classList.add('open');
    setTimeout(() => input.focus(), 50);
}

function closeSettings() {
    document.getElementById('settingsOverlay').classList.remove('open');
    document.getElementById('apiKeyInput').value = '';
}

function saveApiKey() {
    const input = document.getElementById('apiKeyInput');
    const value = input.value.trim();
    if (!value) {
        alert('请输入 API Key 或点击"清除"');
        return;
    }
    apiKey = value;
    chrome.storage.local.set({ [API_KEY_STORAGE]: value }, () => {
        input.value = '';
        closeSettings();
    });
}

function clearApiKey() {
    if (!confirm('确认清除已保存的 API Key？')) return;
    apiKey = '';
    chrome.storage.local.remove([API_KEY_STORAGE], () => {
        document.getElementById('apiKeyInput').value = '';
        closeSettings();
    });
}

// --- Session bootstrap ---
function bootstrapSessions() {
    chrome.storage.local.remove([LEGACY_HISTORY_KEY]);

    chrome.storage.local.get([SESSIONS_KEY, CURRENT_SESSION_KEY], (result) => {
        sessions = Array.isArray(result[SESSIONS_KEY]) ? result[SESSIONS_KEY] : [];
        currentSessionId = result[CURRENT_SESSION_KEY] || null;

        if (sessions.length === 0 || !sessions.find(s => s.id === currentSessionId)) {
            if (sessions.length === 0) {
                createNewSession({ skipRender: true });
            } else {
                currentSessionId = sessions[0].id;
            }
        }

        renderCurrentSession();
        renderSessionList();
        checkPendingData();
    });
}

function getCurrentSession() {
    return sessions.find(s => s.id === currentSessionId) || null;
}

function newSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function createNewSession(opts = {}) {
    const session = {
        id: newSessionId(),
        title: DEFAULT_TITLE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: []
    };
    sessions.unshift(session);
    currentSessionId = session.id;
    saveSessions();

    if (!opts.skipRender) {
        renderCurrentSession();
        renderSessionList();
        closeDrawer();
        removeImage();
        document.getElementById('question').focus();
    }
    return session;
}

function switchSession(id) {
    if (id === currentSessionId) {
        closeDrawer();
        return;
    }
    currentSessionId = id;
    saveSessions();
    renderCurrentSession();
    renderSessionList();
    closeDrawer();
    removeImage();
}

function deleteSession(id) {
    const idx = sessions.findIndex(s => s.id === id);
    if (idx === -1) return;
    sessions.splice(idx, 1);

    if (id === currentSessionId) {
        if (sessions.length === 0) {
            createNewSession({ skipRender: true });
        } else {
            currentSessionId = sessions[0].id;
        }
        renderCurrentSession();
    }
    saveSessions();
    renderSessionList();
}

// --- Drawer ---
function openDrawer() {
    renderSessionList();
    document.getElementById('drawerOverlay').classList.add('open');
}

function closeDrawer() {
    document.getElementById('drawerOverlay').classList.remove('open');
}

function renderSessionList() {
    const list = document.getElementById('sessionList');
    list.innerHTML = '';

    if (sessions.length === 0) {
        list.innerHTML = '<div class="empty-hint">还没有会话</div>';
        return;
    }

    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    sorted.forEach(session => {
        const item = document.createElement('div');
        item.className = 'session-item' + (session.id === currentSessionId ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'session-info';

        const title = document.createElement('div');
        title.className = 'session-title';
        title.textContent = session.title || DEFAULT_TITLE;

        const meta = document.createElement('div');
        meta.className = 'session-meta';
        meta.textContent = `${formatTime(session.updatedAt)} · ${session.messages.length} 条`;

        info.appendChild(title);
        info.appendChild(meta);

        const del = document.createElement('button');
        del.className = 'session-delete';
        del.textContent = '✕';
        del.title = '删除会话';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`删除会话 "${session.title}"？`)) {
                deleteSession(session.id);
            }
        });

        item.appendChild(info);
        item.appendChild(del);
        item.addEventListener('click', () => switchSession(session.id));

        list.appendChild(item);
    });
}

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const pad = n => String(n).padStart(2, '0');
    if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Pending data injection ---
function checkPendingData() {
    chrome.storage.local.get(['pendingText', 'pendingMode', 'pendingImageUrl', 'capturedScreenshot'], (result) => {
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
                .catch(err => console.error('Failed to load image:', err));
            chrome.storage.local.remove(['pendingImageUrl']);
        }

        if (result.capturedScreenshot) {
            currentImage = result.capturedScreenshot;
            document.getElementById('previewImg').src = currentImage;
            document.getElementById('imageInfo').textContent = '📸 Screenshot captured';
            document.getElementById('imagePreview').style.display = 'block';
            chrome.storage.local.remove(['capturedScreenshot']);
            document.getElementById('question').focus();
        }
    });
}

// --- Image handling ---
function captureScreen() {
    try {
        chrome.runtime.sendMessage({ action: "startCapture" });
    } catch (err) {
        alert("Screenshot failed: " + err.message);
    }
}

function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
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
    currentImage = null;
    document.getElementById('imageInput').value = '';
    document.getElementById('imagePreview').style.display = 'none';
}

// --- Chat ---
async function ask() {
    const input = document.getElementById("question");
    const q = input.value.trim();

    if (!q && !currentImage) return;

    const session = getCurrentSession();
    if (!session) return;

    const modelName = document.getElementById("modelSelect").value;
    const promptId = document.getElementById("modeSelect").value;

    const parts = [];
    if (q) parts.push({ type: "text", content: q });
    if (currentImage) {
        const base64Data = currentImage.split(',')[1];
        parts.push({ type: "image", content: base64Data });
    }

    session.messages.push({ role: "user", parts: parts });
    session.updatedAt = Date.now();
    renderMessage("user", parts);
    saveSessions();

    input.value = "";
    removeImage();
    setLoading(true);

    try {
        const res = await fetch(`${API_BASE}/chat_stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: session.messages,
                model_name: modelName,
                prompt_id: promptId,
                api_key: apiKey || null,
                use_kb: kbEnabled
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

        session.messages.push({ role: "assistant", parts: [{ type: "text", content: fullText }] });
        session.updatedAt = Date.now();
        saveSessions();

        const isFirstRound = session.messages.length === 2 && session.title === DEFAULT_TITLE;
        if (isFirstRound) {
            generateSessionTitle(session, modelName);
        }
    } catch (err) {
        renderMessage("assistant", [{ type: "text", content: "❌ Error: " + err.message }]);
    } finally {
        setLoading(false);
    }
}

async function generateSessionTitle(session, modelName) {
    const firstUser = session.messages[0];
    const firstAssistant = session.messages[1];
    if (!firstUser || !firstAssistant) return;

    const userText = (firstUser.parts.find(p => p.type === 'text') || {}).content || '[图片]';
    const assistantText = (firstAssistant.parts.find(p => p.type === 'text') || {}).content || '';

    const titleModel = (modelName && !modelName.includes('gemma')) ? modelName : 'gemini-2.5-flash-lite';

    const fallback = userText.slice(0, 20) || DEFAULT_TITLE;

    try {
        const res = await fetch(`${API_BASE}/chat_stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [{
                    role: "user",
                    parts: [{
                        type: "text",
                        content: `请用不超过15个字总结以下对话的主题，只返回标题文字本身，不要引号、不要解释、不要标点结尾：\n\n用户：${userText}\n助手：${assistantText}`
                    }]
                }],
                model_name: titleModel,
                prompt_id: "default",
                api_key: apiKey || null
            })
        });

        if (!res.ok) throw new Error('title api failed');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let title = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            title += decoder.decode(value, { stream: true });
        }
        title = title.trim().replace(/^["“”'']+|["“”'']+$/g, '').slice(0, 30);
        session.title = title || fallback;
    } catch (err) {
        session.title = fallback;
    }

    saveSessions();
    renderSessionList();
}

// --- Rendering ---
function renderCurrentSession() {
    const container = document.getElementById("chatContainer");
    container.innerHTML = "";
    const session = getCurrentSession();
    if (!session) return;

    session.messages.forEach(m => {
        const validParts = m.parts.filter(p => p.content !== "[Image data removed for storage]");
        if (validParts.length > 0) {
            renderMessage(m.role, validParts);
        }
    });
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

// --- Persistence ---
function saveSessions() {
    const lightSessions = sessions.map(s => ({
        ...s,
        messages: s.messages.map(msg => ({
            role: msg.role,
            parts: msg.parts.map(part => {
                if (part.type === "image") {
                    return { type: "image", content: "[Image data removed for storage]" };
                }
                return part;
            })
        }))
    }));
    chrome.storage.local.set({
        [SESSIONS_KEY]: lightSessions,
        [CURRENT_SESSION_KEY]: currentSessionId
    });
}

// --- Toolbar actions ---
function clearChat() {
    if (!confirm("清空当前会话的所有消息？")) return;
    const session = getCurrentSession();
    if (!session) return;
    session.messages = [];
    session.title = DEFAULT_TITLE;
    session.updatedAt = Date.now();
    document.getElementById("chatContainer").innerHTML = "";
    removeImage();
    saveSessions();
    renderSessionList();
}

function exportChat() {
    const session = getCurrentSession();
    if (!session || session.messages.length === 0) {
        return alert("No conversation to export!");
    }

    let content = `# ${session.title || 'AI Study Helper'}\n\n`;
    content += `Date: ${new Date().toLocaleString()}\n`;
    content += "----------------------------------------\n\n";

    session.messages.forEach(msg => {
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
