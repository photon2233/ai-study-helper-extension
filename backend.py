import os
from google import genai
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel


client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY"))

app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"], 
    allow_headers=["*"], 
)

class Query(BaseModel):
    text: str

@app.post("/ask")
def ask(query: Query):
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash", 
            contents=query.text
        )
        return {"answer": response.text}
    except Exception as e:
        return {"answer": f"An error occurred: {str(e)}"}
    