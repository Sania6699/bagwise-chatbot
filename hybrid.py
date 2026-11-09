from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from ingest import load_documents, split_documents

embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
vectorstore = Chroma(persist_directory="chroma_db", embedding_function=embeddings)
bm25 = BM25Retriever.from_documents(split_documents(load_documents()), k=4)


def hybrid_search(question, k=3):
    semantic = vectorstore.similarity_search(question, k=4)
    keyword = bm25.invoke(question)

    scores = {}
    docs = {}
    for results in (semantic, keyword):
        for rank, doc in enumerate(results):
            key = doc.page_content
            docs[key] = doc
            scores[key] = scores.get(key, 0) + 1 / (60 + rank + 1)

    ranked = sorted(scores, key=scores.get, reverse=True)
    return [docs[key] for key in ranked[:k]]


if __name__ == "__main__":
    question = "Can I carry a 100 Wh power bank in cabin baggage on Emirates?"
    for i, doc in enumerate(hybrid_search(question)):
        print(f"\n--- Result {i + 1} ({doc.metadata['airline']}, {doc.metadata['flight_type']}) ---")
        print(doc.page_content)