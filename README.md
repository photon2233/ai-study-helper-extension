# AI Study Helper Pro

A Chrome extension powered by Google's Gemini AI that provides intelligent learning assistance through text and image analysis.

## Features

### Unified Conversation Interface
- **Screen Capture** - Select and capture any region of your screen
- **Image Upload** - Upload images from your local device
- **Text Input** - Ask questions via text
- **Mixed Conversations** - Combine text and images in the same conversation thread
- **Complete History** - Automatic conversation saving (history feature coming soon)

### Three Usage Modes

1. **Extension Popup**
   - Click the extension icon to start chatting or upload images

2. **Right-Click Text**
   - Select text on any webpage → Right-click → Choose "Explain" or "Solve"

3. **Right-Click Image**
   - Right-click any image → Choose "Analyze This Image"

---

## Project Structure

```
project_root/
├── backend/
│   ├── main.py                 # FastAPI backend (unified API)
│   └── prompts/               # AI prompt templates (customizable)
│       ├── default.txt        # Default mode
│       ├── solver.txt         # Problem solving
│       ├── explainer.txt      # Content explanation
│       └── vision.txt         # (Future) Vision-specific prompts
│
└── extension/                 # Chrome Extension
    ├── manifest.json          # Extension configuration
    ├── popup.html             # Main UI (text + image support)
    ├── popup.js               # Main logic
    ├── content.js             # Content script
    ├── background.js          # Background service
    └── icons/                 # Icons 
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## Quick Start

### Install Dependencies

```bash
# In project root directory
pip install fastapi uvicorn google-genai pydantic
```

### Configure API Key

```bash
# Windows
set GEMINI_API_KEY=your_api_key_here

# Mac/Linux
export GEMINI_API_KEY=your_api_key_here
```

Or add `GEMINI_API_KEY` to your system environment variables. Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

### Start Backend Server

```bash
# In project root directory
python -m uvicorn main:app --reload 
```

### Install Chrome Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Done! The extension icon will appear in your browser toolbar

---

## Usage Guide

### Method 1: Popup Conversation

**Screen Capture:**
1. Click the extension icon to open the popup
2. Click the capture button to enter capture mode
3. Drag to select screen area
4. Click "Capture" to confirm
5. Return to chat interface with image attached
6. Add text or send directly

**Note:** You can capture any part of your screen, including content outside the extension popup.

**Upload Local Image:**
1. Click the upload button to select an image
2. Optionally add text description
3. Click "Send"

**Text Chat:**
1. Type your question and press Enter

**Mixed Conversation Example:**
- Send text: "How do I solve this problem?"
- AI responds with guidance
- Upload image of the problem
- AI analyzes and provides solution
- Continue asking follow-up questions

### Method 2: Context Menu

**Process Text:**
1. Select any text on a webpage
2. Right-click and choose:
   - AI Explain Selected Text
   - AI Solve This Problem
3. Popup opens with text pre-filled

**Analyze Image:**
1. Right-click any image on a webpage
2. Choose "AI Analyze This Image"
3. Popup opens with image loaded

---

## Message Format

### Backend API Structure

```json
{
  "messages": [
    {
      "role": "user",
      "parts": [
        {
          "type": "text",
          "content": "Help me analyze this problem"
        },
        {
          "type": "image",
          "content": "base64_encoded_image_data"
        }
      ]
    },
    {
      "role": "assistant",
      "parts": [
        {
          "type": "text",
          "content": "This is a problem about..."
        }
      ]
    }
  ],
  "model_name": "gemini-2.5-flash",
  "prompt_id": "solver"
}
```

### Key Features
- **parts Array** - Each message can contain multiple parts (text, images)
- **type Field** - Specifies "text" or "image"
- **Unified Endpoint** - `/chat_stream` handles both text and images

---

## Configuration

### Supported Models

| Model Name | Speed | Vision Support | Recommended Use |
|-----------|-------|---------------|-----------------|
| gemini-2.5-flash | Fast | Yes | Recommended for daily use |
| gemini-2.5-flash-lite | Very Fast | Yes | Simple questions, fast response |
| gemma-3-27b-it | Medium | No | Text-only, open-source model |

**Note:** When sending images, the extension automatically checks model compatibility. Gemma will prompt you to switch to Gemini.

### Conversation Modes

- **Free Chat** - Open-ended conversation, no specific constraints
- **Problem Solver** - Structured problem-solving with step-by-step solutions
- **Explainer** - Teaching style with detailed concept explanations

**Customize Prompts:** You can modify the prompt templates in `backend/prompts/` to adjust AI behavior for each mode. Simply edit the `.txt` files to create your own instruction styles.

---

## Usage Tips

### 1. Multi-Turn Image Conversations

```
You: How do I solve this problem?
AI: Please send the problem image, and I'll help you analyze it
You: [Upload image]
AI: This is a quadratic equation... Here are the steps...
You: I don't understand step 3, can you explain in detail?
AI: Sure, step 3 involves factorization...
```

### 2. Compare Different Solutions

```
You: [Upload math problem image] Are there multiple ways to solve this?
AI: There are two main approaches...
You: Can you demonstrate using a graphical method?
You: [Upload coordinate system image]
AI: Looking at your graph, let me mark the key points...
```

### 3. Batch Processing Problems

- **Recommendation:** Start a new conversation for each problem (click Clear)
- **Reason:** Avoids context confusion and improves accuracy

---

## Technical Details

### API Endpoints

- **POST /chat_stream** - Streaming chat endpoint supporting text and images
- Supports multipart messages with mixed content types
- Returns Server-Sent Events (SSE) for real-time streaming

### Browser Compatibility

- Chrome 88+
- Edge 88+
- Other Chromium-based browsers

### Future 
- Add conversation history persistence
- Support for Gemma model with image processing
