import os
from google import genai
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel
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

class Query(BaseModel):
    text: str

#normal
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

#streaming
@app.post("/ask_stream")
def ask_stream(query: Query):

    def generate():
        try:
            stream = client.models.generate_content_stream(
                model="gemini-2.5-flash",
                contents=query.text
            )

            for chunk in stream:
                if chunk.text:
                    yield chunk.text

        except Exception as e:
            yield f"\n[Error]: {str(e)}"

    return StreamingResponse(generate(), media_type="text/plain")