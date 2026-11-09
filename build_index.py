from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from ingest import load_documents, split_documents

embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

docs = load_documents()
chunks = split_documents(docs)

vectorstore = Chroma.from_documents(
    documents=chunks,
    embedding=embeddings,
    persist_directory="chroma_db",
)

print(f"Stored {len(chunks)} chunks in Chroma")