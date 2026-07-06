"""
FastAPI backend for a multi-modal chat system using Google Gemini and Gemma models.

Features:
- Streaming text responses
- Support for text, image, and mixed inputs
- Prompt switching based on user-selected prompt IDs
- Model-specific handling for Gemini vs Gemma

Model-specific behavior:
- Gemini models use the official `system_instruction` parameter provided by the API.
- Gemma models do not support system instructions natively, so system prompts are
  injected as an initial user message followed by a model acknowledgment.
- Gemma models currently do not support image understanding. Image inputs will
  return an explicit error message.

Planned improvements:
- Use Gemini for image analysis and forward the extracted image description to
  Gemma for text-only reasoning.

Design note:
- Gemma is included primarily due to its higher free API quota, making it suitable
  for cost-sensitive usage scenarios.
"""

import os
import glob
import base64
from google import genai
from google.genai import types
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Union
from fastapi.responses import StreamingResponse

import rag

FALLBACK_API_KEY = os.environ.get("GEMINI_API_KEY")
PROMPT_DIR = "prompts"

app = FastAPI()


def scrub(text: str, secret: Optional[str]) -> str:
    """Remove a secret value from a string before logging or returning it."""
    if not text:
        return text
    if secret:
        text = text.replace(secret, "***")
    if FALLBACK_API_KEY:
        text = text.replace(FALLBACK_API_KEY, "***")
    return text

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"], 
    allow_headers=["*"], 
)


class MessagePart(BaseModel):
    type: str  
    content: str  

class Message(BaseModel):
    role: str 
    parts: List[MessagePart]  

class ChatRequest(BaseModel):
    messages: List[Message]
    model_name: str = "gemini-2.5-flash"
    prompt_id: str = "default"
    api_key: Optional[str] = None  # User-supplied key; falls back to server env var
    use_kb: bool = False  # When true, retrieve from the knowledge base and inject context


def resolve_key(api_key: Optional[str]) -> Optional[str]:
    return (api_key or "").strip() or FALLBACK_API_KEY

# Switch prompts based on the user's selection using prompt IDs
class PromptLoader:
    def __init__(self, directory):
        self.directory = directory
        if not os.path.exists(directory):
            os.makedirs(directory)

    def get_prompt(self, prompt_id: str) -> str:
        safe_id = "".join(x for x in prompt_id if x.isalnum() or x in "._-")
        file_path = os.path.join(self.directory, f"{safe_id}.txt")
        
        if not os.path.exists(file_path):
            file_path = os.path.join(self.directory, "default.txt")
            
        try:
            if os.path.exists(file_path):
                with open(file_path, "r", encoding="utf-8") as f:
                    return f.read().strip()
        except Exception as e:
            print(f"Error loading prompt: {e}")
        
        return "You are a helpful AI assistant."

loader = PromptLoader(PROMPT_DIR)


@app.post("/chat_stream")
async def chat_stream(request: ChatRequest):

    user_key = (request.api_key or "").strip() or None
    effective_key = user_key or FALLBACK_API_KEY

    if not effective_key:
        def no_key_gen():
            yield "❌ Error: No API key provided. Open the extension settings and enter your Gemini API key."
        return StreamingResponse(no_key_gen(), media_type="text/plain")

    try:
        request_client = genai.Client(api_key=effective_key)
    except Exception as e:
        msg = scrub(str(e), user_key)
        def init_err_gen():
            yield f"❌ Error: failed to initialize Gemini client: {msg}"
        return StreamingResponse(init_err_gen(), media_type="text/plain")

    system_instruction = loader.get_prompt(request.prompt_id)
    current_model = request.model_name.lower()

    # Knowledge base retrieval: augment the system prompt with relevant chunks
    kb_sources = []
    if request.use_kb:
        last_user_text = ""
        for msg in reversed(request.messages):
            if msg.role == "user":
                texts = [p.content for p in msg.parts if p.type == "text"]
                if texts:
                    last_user_text = "\n".join(texts)
                break
        if last_user_text:
            try:
                retrieval = rag.retrieve(request_client, last_user_text)
                if retrieval:
                    kb_sources = retrieval["sources"]
                    system_instruction += (
                        "\n\nReference material from the user's knowledge base. "
                        "Prefer this material when it is relevant to the question; "
                        "if it does not cover the question, say so and answer from general knowledge.\n\n"
                        + retrieval["context"]
                    )
            except Exception as e:
                print(f"KB retrieval failed: {scrub(str(e), user_key)}")

    has_image = any(
        any(part.type == "image" for part in msg.parts) 
        for msg in request.messages
    )
    # gemma model  
    if has_image and "gemma" in current_model:
        def error_gen():
            yield "❌ Error: Gemma models do not support image analysis. Please switch to a Gemini model."
        return StreamingResponse(error_gen(), media_type="text/plain")
    
    gemini_contents = []
    

    if "gemma" in current_model:
        gemini_contents.append({
            "role": "user", 
            "parts": [{"text": f"System Instruction:\n{system_instruction}\n\nPlease follow this instruction strictly."}]
        })
        gemini_contents.append({
            "role": "model",
            "parts": [{"text": "Understood. I will strictly follow the provided instructions."}]
        })

    # Key fix: convert frontend message format to the Gemini API format
    for msg in request.messages:
        role = "user" if msg.role == "user" else "model"
        parts = []
        
        for part in msg.parts:
            if part.type == "text":
                parts.append({"text": part.content})
            elif part.type == "image":
                if part.content == "[Image data removed for storage]":
                    continue
                    
                parts.append({
                    "inline_data": {
                        "mime_type": "image/jpeg", 
                        "data": part.content 
                    }
                })
        
        if parts:
            gemini_contents.append({"role": role, "parts": parts})
    
    # Gemini model
    generate_config = None
    if "gemini" in current_model:
        generate_config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.7 
        )

    # streaming output

    # async def generate():
    #     try:
    #         import asyncio
            
    #         loop = asyncio.get_event_loop()
            
    #         def sync_generate():
    #             stream = request_client.models.generate_content_stream(
    #                 model=request.model_name,
    #                 contents=gemini_contents,
    #                 config=generate_config
    #             )
    #             for chunk in stream:
    #                 if chunk.text:
    #                     yield chunk.text

    #         sync_gen = sync_generate()
    #         for chunk in sync_gen:
    #             yield chunk
    #             await asyncio.sleep(0)

    #     except Exception as e:
    #         yield f"\n[Backend Error]: {scrub(str(e), user_key)}"

    # return StreamingResponse(generate(), media_type="text/plain")

    async def generate():
        try:
            stream = await request_client.aio.models.generate_content_stream(
                model=request.model_name,
                contents=gemini_contents,
                config=generate_config
            )
            async for chunk in stream:
                if chunk.text:
                    yield chunk.text
            if kb_sources:
                yield f"\n\n📚 Sources: {', '.join(kb_sources)}"
        except Exception as e:
            yield f"\n[Backend Error]: {scrub(str(e), user_key)}"

    return StreamingResponse(generate(), media_type="text/plain")


# --- Knowledge base endpoints ---

@app.post("/kb/upload")
async def kb_upload(file: UploadFile = File(...), api_key: Optional[str] = Form(None)):
    effective_key = resolve_key(api_key)
    if not effective_key:
        raise HTTPException(status_code=400, detail="No API key provided.")

    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 20MB).")

    client = genai.Client(api_key=effective_key)
    try:
        result = rag.ingest_document(client, file.filename, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=scrub(str(e), api_key))
    return result


@app.get("/kb/docs")
def kb_list():
    return {"documents": rag.list_documents()}


@app.delete("/kb/docs/{doc_id}")
def kb_delete(doc_id: str):
    rag.delete_document(doc_id)
    return {"deleted": doc_id}



@app.get("/")
def read_root():
    return {
        "message": "AI Study Helper API is running", 
        "version": "v3.2-fixed-image-format",
        "features": [
            "Text chat with context",
            "Image analysis (Gemini only)",
            "Mixed text+image messages",
            "Multi-turn conversations"
        ]
    }