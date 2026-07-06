"""
RAG (Retrieval-Augmented Generation) module for the AI Study Helper backend.

Pipeline:
- Ingest: parse (PDF via pypdf, TXT/MD as plain text) -> chunk -> embed -> store in ChromaDB
- Query: embed the question -> retrieve top-k chunks -> return context + sources

Design notes:
- Chunking is paragraph-based with a max size and overlap, so a concept split
  across a chunk boundary still appears intact in at least one chunk.
- Embeddings use Gemini's text-embedding-004 through the same google-genai
  client as chat, so the user's per-request API key works here too.
- ChromaDB runs as a local persistent store (kb_store/); no server needed.
"""

import io
import time
import uuid
from typing import List, Optional

import chromadb
import pypdf
from google import genai

KB_DIR = "kb_store"
COLLECTION_NAME = "study_kb"
EMBEDDING_MODEL = "gemini-embedding-001"
CHUNK_MAX_CHARS = 1500
CHUNK_OVERLAP_CHARS = 200
EMBED_BATCH_SIZE = 100

_chroma = chromadb.PersistentClient(path=KB_DIR)


def _collection():
    return _chroma.get_or_create_collection(COLLECTION_NAME)


# ---------- Parsing ----------

def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        reader = pypdf.PdfReader(io.BytesIO(data))
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            if text.strip():
                pages.append(text)
        return "\n\n".join(pages)
    if name.endswith((".txt", ".md", ".markdown")):
        return data.decode("utf-8", errors="replace")
    raise ValueError(f"Unsupported file type: {filename}. Only PDF, TXT, and MD are supported.")


# ---------- Chunking ----------

def chunk_text(text: str) -> List[str]:
    """Paragraph-based chunking with overlap between adjacent chunks."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: List[str] = []
    current = ""

    for para in paragraphs:
        # A single paragraph larger than the limit gets hard-split
        while len(para) > CHUNK_MAX_CHARS:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(para[:CHUNK_MAX_CHARS])
            para = para[CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS:]

        if len(current) + len(para) + 2 > CHUNK_MAX_CHARS:
            chunks.append(current)
            # carry the tail of the previous chunk forward as overlap
            current = current[-CHUNK_OVERLAP_CHARS:] + "\n\n" + para
        else:
            current = (current + "\n\n" + para) if current else para

    if current.strip():
        chunks.append(current)
    return chunks


# ---------- Embedding ----------

def embed_texts(client: genai.Client, texts: List[str]) -> List[List[float]]:
    vectors: List[List[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i:i + EMBED_BATCH_SIZE]
        result = client.models.embed_content(model=EMBEDDING_MODEL, contents=batch)
        vectors.extend(e.values for e in result.embeddings)
    return vectors


# ---------- Public API ----------

def ingest_document(client: genai.Client, filename: str, data: bytes) -> dict:
    text = extract_text(filename, data)
    if not text.strip():
        raise ValueError("No extractable text found (scanned PDFs are not supported yet).")

    chunks = chunk_text(text)
    embeddings = embed_texts(client, chunks)

    doc_id = "doc_" + uuid.uuid4().hex[:12]
    now = int(time.time())
    coll = _collection()
    coll.add(
        ids=[f"{doc_id}_{i}" for i in range(len(chunks))],
        embeddings=embeddings,
        documents=chunks,
        metadatas=[
            {"doc_id": doc_id, "doc_name": filename, "chunk_index": i, "uploaded_at": now}
            for i in range(len(chunks))
        ],
    )
    return {"doc_id": doc_id, "doc_name": filename, "chunks": len(chunks)}


def list_documents() -> List[dict]:
    coll = _collection()
    result = coll.get(include=["metadatas"])
    docs = {}
    for meta in result["metadatas"]:
        d = docs.setdefault(meta["doc_id"], {
            "doc_id": meta["doc_id"],
            "doc_name": meta["doc_name"],
            "uploaded_at": meta["uploaded_at"],
            "chunks": 0,
        })
        d["chunks"] += 1
    return sorted(docs.values(), key=lambda d: d["uploaded_at"], reverse=True)


def delete_document(doc_id: str) -> None:
    _collection().delete(where={"doc_id": doc_id})


def retrieve(client: genai.Client, query: str, top_k: int = 5) -> Optional[dict]:
    """Return {'context': str, 'sources': [doc names]} or None if the KB is empty."""
    coll = _collection()
    if coll.count() == 0:
        return None

    query_embedding = embed_texts(client, [query])[0]
    result = coll.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, coll.count()),
        include=["documents", "metadatas"],
    )

    documents = result["documents"][0]
    metadatas = result["metadatas"][0]
    if not documents:
        return None

    blocks = []
    sources = []
    for doc, meta in zip(documents, metadatas):
        blocks.append(f"[Source: {meta['doc_name']}]\n{doc}")
        if meta["doc_name"] not in sources:
            sources.append(meta["doc_name"])

    return {"context": "\n\n---\n\n".join(blocks), "sources": sources}
