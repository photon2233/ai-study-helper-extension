import os
import glob
from google import genai
from google.genai import types
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel
from typing import List, Optional
from fastapi.responses import StreamingResponse

API_KEY = os.environ.get("GEMINI_API_KEY")
PROMPT_DIR = "prompts"

client = genai.Client(api_key=API_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"], 
    allow_headers=["*"], 
)


class Message(BaseModel):
    role: str 
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    model_name: str = "gemini-2.5-flash" 
    prompt_id: str = "default"           

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
    
    system_instruction = loader.get_prompt(request.prompt_id)
    
    gemini_contents = []
    current_model = request.model_name.lower()


    if "gemma" in current_model:
        gemini_contents.append({
            "role": "user", 
            "parts": [{"text": f"System Instruction:\n{system_instruction}\n\nPlease follow this instruction strictly."}]
        })
        gemini_contents.append({
            "role": "model",
            "parts": [{"text": "Understood. I will strictly follow the provided instructions."}]
        })

 
    for msg in request.messages:
  
        role = "user" if msg.role == "user" else "model"
        gemini_contents.append({"role": role, "parts": [{"text": msg.content}]})
    
    generate_config = None
    if "gemini" in current_model:
        generate_config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=0.7 
        )

  
    def generate():
        try:
            stream = client.models.generate_content_stream(
                model=request.model_name,
                contents=gemini_contents,
                config=generate_config 
            )

            for chunk in stream:
                if chunk.text:
                    yield chunk.text

        except Exception as e:
            yield f"\n[Backend Error]: {str(e)}"

    return StreamingResponse(generate(), media_type="text/plain")

@app.get("/")
def read_root():
    return {"message": "AI Study Helper API is running", "version": "v2.0-prompt-managed"}