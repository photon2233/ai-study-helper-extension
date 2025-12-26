import os
from google import genai

client = genai.Client(
    api_key=os.environ["GEMINI_API_KEY"]
)

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="hello world"
)

print(response.text)
