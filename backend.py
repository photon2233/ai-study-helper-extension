import os
from google import genai
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel
from typing import List
from fastapi.responses import StreamingResponse

client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"], 
    allow_headers=["*"], 
)

class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]  

# old no history
@app.post("/ask")
def ask_old(query: dict):
    try:
        response = client.models.generate_content(
            model="gemma-3-27b-it", #choose gemma-3-27b-it just for free
            contents=query.get("text", "")
        )
        return {"answer": response.text}
    except Exception as e:
        return {"answer": f"An error occurred: {str(e)}"}

# new support history
@app.post("/chat_stream")
async def chat_stream(request: ChatRequest):
    
    
    gemini_contents = []
    
    
    for msg in request.messages:
        if msg.role == "user":
            gemini_contents.append({"role": "user", "parts": [{"text": msg.content}]})
        elif msg.role == "assistant":
            gemini_contents.append({"role": "model", "parts": [{"text": msg.content}]})
    
    def generate():
        try:
            stream = client.models.generate_content_stream(
                model="gemma-3-27b-it",
                contents=gemini_contents
            )

            for chunk in stream:
                if chunk.text:
                    yield chunk.text

        except Exception as e:
            yield f"\n[Error]: {str(e)}"

    return StreamingResponse(generate(), media_type="text/plain")

@app.get("/")
def read_root():
    return {"message": "AI Study Helper API is running", "version": "day4"}