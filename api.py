import json
import os
import time

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from graph import app as rag_graph, router as route_node, llm, PROMPT
from hybrid import vectorstore, bm25, hybrid_search

api = FastAPI(title="BagWise API")

GREETINGS = {"hi", "hello", "hey", "hii", "good morning", "good afternoon", "good evening"}
GREETING_REPLY = (
    "Hello! I can help with baggage rules for Air India and Emirates: "
    "allowances, power banks, liquids and prohibited items. What would you like to know?"
)


class Ask(BaseModel):
    question: str
    strategy: str = "auto"


def clean(text):
    # remove the [Airline - flight type] label we added for retrieval
    if text.startswith("[") and "\n" in text:
        return text.split("\n", 1)[1]
    return text


def retrieve(question, strategy):
    if strategy == "semantic":
        return vectorstore.similarity_search(question, k=3)
    if strategy == "keyword":
        return bm25.invoke(question)[:3]
    return hybrid_search(question)


def source_dicts(docs):
    return [
        {
            "airline": d.metadata["airline"],
            "flight_type": d.metadata["flight_type"],
            "file": os.path.basename(d.metadata["source"]),
            "text": clean(d.page_content),
        }
        for d in docs
    ]


@api.post("/ask")
def ask(body: Ask):
    start = time.perf_counter()
    if body.strategy == "auto":
        result = rag_graph.invoke({"question": body.question})
        answer, used, docs = result["answer"], result["strategy"], result["docs"]
    else:
        used = body.strategy
        docs = retrieve(body.question, used)
        context = "\n\n".join(d.page_content for d in docs)
        answer = llm.invoke(PROMPT.format(context=context, question=body.question)).content

    refused = "don't have that information" in answer.lower()
    return {
        "answer": answer,
        "strategy": used,
        "refused": refused,
        "seconds": round(time.perf_counter() - start, 1),
        "sources": [] if refused else source_dicts(docs),
    }


@api.post("/ask_stream")
def ask_stream(body: Ask):
    def events():
        start = time.perf_counter()

        if body.question.strip().lower().strip("!.?, ") in GREETINGS:
            yield json.dumps({"type": "token", "text": GREETING_REPLY}) + "\n"
            yield json.dumps({"type": "done", "refused": False, "seconds": 0.0}) + "\n"
            return

        if body.strategy == "auto":
            used = route_node({"question": body.question})["strategy"]
        else:
            used = body.strategy
        yield json.dumps({"type": "route", "strategy": used}) + "\n"

        docs = retrieve(body.question, used)
        yield json.dumps({
            "type": "sources",
            "sources": source_dicts(docs),
            "seconds": round(time.perf_counter() - start, 1),
        }) + "\n"

        context = "\n\n".join(d.page_content for d in docs)
        prompt = PROMPT.format(context=context, question=body.question)
        full = ""
        for chunk in llm.stream(prompt):
            full += chunk.content
            yield json.dumps({"type": "token", "text": chunk.content}) + "\n"

        yield json.dumps({
            "type": "done",
            "refused": "don't have that information" in full.lower(),
            "seconds": round(time.perf_counter() - start, 1),
        }) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


os.makedirs("static", exist_ok=True)
api.mount("/", StaticFiles(directory="static", html=True), name="static")