from dotenv import load_dotenv
load_dotenv()
from typing import TypedDict, List
from langgraph.graph import StateGraph, START, END
from langchain_core.documents import Document
from langchain_groq import ChatGroq
from hybrid import vectorstore, bm25, hybrid_search

llm = ChatGroq(model="openai/gpt-oss-120b", temperature=0)

PROMPT = """You are a baggage rules assistant. Answer the question using ONLY the context below.

The context has several passages. Each starts with a label like [Emirates - international flights]. Check EVERY passage before you answer.

Rules:
- If at least one passage answers the question, give the answer. In that case NEVER write the sentence "I don't have that information in my documents."
- Only if no passage answers the question, reply with exactly this sentence and nothing else: "I don't have that information in my documents."
- Never mix an answer with that sentence. Never write lines about passages that do not help. Simply leave them out.
- Only state what the passages say explicitly. Do not assume or extend a rule.
- If the question names an airline or flight type, answer only for that one.
- If the question names no airline and every helpful passage gives the same rule, state it once and say it applies to all airlines in the context.
- If the helpful passages give different rules, write one short line for EACH of them, in the form "Airline (flight type): rule". Do not skip any.
- Keep the answer short and do not add information the question did not ask for.

Context:
{context}

Question: {question}

Answer:"""

class State(TypedDict):
    question: str
    strategy: str
    docs: List[Document]
    answer: str


def router(state: State):
    question = state["question"]
    has_number = any(ch.isdigit() for ch in question)
    if has_number and len(question.split()) <= 4:
        strategy = "keyword"
    elif has_number:
        strategy = "hybrid"
    else:
        strategy = "semantic"
    return {"strategy": strategy}


def retrieve(state: State):
    question = state["question"]
    strategy = state["strategy"]
    if strategy == "keyword":
        docs = bm25.invoke(question)[:3]
    elif strategy == "hybrid":
        docs = hybrid_search(question)
    else:
        docs = vectorstore.similarity_search(question, k=3)
    return {"docs": docs}


def generate(state: State):
    context = "\n\n".join(doc.page_content for doc in state["docs"])
    response = llm.invoke(PROMPT.format(context=context, question=state["question"]))
    return {"answer": response.content}


builder = StateGraph(State)
builder.add_node("router", router)
builder.add_node("retrieve", retrieve)
builder.add_node("generate", generate)
builder.add_edge(START, "router")
builder.add_edge("router", "retrieve")
builder.add_edge("retrieve", "generate")
builder.add_edge("generate", END)
app = builder.compile()


if __name__ == "__main__":
    questions = [
        "100 Wh",
        "Can I take my laptop onto the plane?",
        "How many bags can a business class passenger check on Air India international flights, 23 kg or more?",
    ]
    for question in questions:
        result = app.invoke({"question": question})
        print("\nQuestion:", question)
        print("Strategy chosen:", result["strategy"])
        print("Answer:", result["answer"])
   