from pathlib import Path
from langchain_community.document_loaders import TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

DATA_DIR = Path("data")


def load_documents():
    documents = []
    for file_path in DATA_DIR.rglob("*.txt"):
        loader = TextLoader(str(file_path), encoding="utf-8")
        docs = loader.load()
        airline = file_path.parent.name.replace("_", " ").title()
        flight_type = "domestic" if "domestic" in file_path.stem else "international"
        for doc in docs:
            doc.metadata["airline"] = airline
            doc.metadata["flight_type"] = flight_type
        documents.extend(docs)
    return documents


def split_documents(documents):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
    )
    chunks = splitter.split_documents(documents)
    for chunk in chunks:
        label = f"[{chunk.metadata['airline']} - {chunk.metadata['flight_type']} flights]"
        chunk.page_content = label + "\n" + chunk.page_content
    return chunks


if __name__ == "__main__":
    docs = load_documents()
    chunks = split_documents(docs)
    print(f"Loaded {len(docs)} documents, split into {len(chunks)} chunks")
    for i, chunk in enumerate(chunks):
        first_lines = chunk.page_content.split("\n")[:3]
        print(f"\n--- Chunk {i} ---")
        print("\n".join(first_lines))