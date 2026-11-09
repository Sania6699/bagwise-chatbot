# BagWise - Baggage Rules Chatbot

A RAG (retrieval-augmented generation) chatbot that answers airport baggage questions using only a small set of policy documents, and shows the passages each answer came from. If the documents do not contain the answer, it says so instead of guessing.

> **Note:** the documents in `data/` are fictional samples with illustrative figures. They are not official Air India or Emirates policy. Verify real baggage rules with the airline before travelling.

---

## 1. What it does

- Answers questions about checked baggage, cabin baggage, power banks, liquids and prohibited items.
- Covers three sample documents: Air India domestic, Air India international, Emirates international.
- Answers only from the retrieved passages. If no passage answers the question, it replies: *"I don't have that information in my documents."*
- Shows the source passages behind each answer (airline, flight type, file name, passage text).
- Streams the answer word by word in a chat interface.

---

## 2. How it works (the process)

```
data/*.txt  ->  ingest.py  ->  build_index.py  ->  chroma_db/
                (load, label, chunk)  (embed + store)

Question -> router -> retrieve -> generate -> answer + sources
            (graph.py)  (semantic / keyword / hybrid)  (Groq LLM)
```

1. **Load and label** (`ingest.py`): every `.txt` file under `data/` is loaded. The airline comes from the folder name (`air_india` becomes "Air India"). The flight type comes from the file name (contains "domestic", otherwise "international").
2. **Chunk** (`ingest.py`): `RecursiveCharacterTextSplitter` with `chunk_size=500` and `chunk_overlap=100`. After splitting, each chunk gets a label line at the start, for example `[Emirates - international flights]`, so the airline and flight type are part of the chunk text.
3. **Embed and index** (`build_index.py`): each chunk is embedded with `sentence-transformers/all-MiniLM-L6-v2` and stored in a Chroma vector store saved in `chroma_db/`. This is run once.
4. **Route** (`graph.py`): a LangGraph node picks a retrieval strategy using simple rules (see section 3).
5. **Retrieve**: semantic search (Chroma), keyword search (BM25), or hybrid (both merged), returning the top 3 chunks.
6. **Generate**: the Groq model `openai/gpt-oss-120b` (temperature 0) answers using only those chunks, following a strict prompt.
7. **Cite**: the API returns the retrieved passages and the interface shows them as clickable sources.

---

## 3. Retrieval strategies and the router

| Strategy | How it works | Good for | Example |
| --- | --- | --- | --- |
| Semantic | Chroma similarity search, top 3 | Questions worded differently from the documents | "Can I take my laptop onto the plane?" |
| Keyword (BM25) | BM25 keyword match, top 3 | Exact terms and numbers | "100 Wh" |
| Hybrid | Semantic top 4 + BM25 top 4, merged with Reciprocal Rank Fusion, top 3 | Meaning and exact terms together | "Can I carry a 100 Wh power bank on Emirates?" |

**Router rules in Auto mode** (`router` in `graph.py`):

- question contains a digit **and** has 4 words or fewer -> **keyword**
- question contains a digit **and** is longer -> **hybrid**
- no digit -> **semantic**

The router is rule-based, not an LLM or a learned model. In the interface you can also force a strategy in settings.

**Reciprocal Rank Fusion (RRF)** in `hybrid.py`: each chunk scores `1 / (60 + rank + 1)` in each result list it appears in, the scores are added, and the top 3 chunks by total score are kept.

---

## 4. How the answer is controlled (anti-hallucination)

The prompt in `graph.py` tells the model to:

- use ONLY the provided context and check every passage
- reply with exactly "I don't have that information in my documents." if no passage answers the question, and never mix that sentence with an answer
- not assume or extend a rule beyond what the passages state
- answer only for the airline or flight type named in the question
- if no airline is named and all helpful passages agree, state the rule once and say it applies to all airlines in the context
- if the passages differ, write one line per airline in the form "Airline (flight type): rule"
- keep the answer short

Other controls: `temperature=0`, and the API flags an answer as refused if it contains "don't have that information" (a simple string check). Refused answers show no sources.

---

## 5. Tech stack

Python, LangChain, LangGraph, Chroma, sentence-transformers (`all-MiniLM-L6-v2`), BM25 (`rank-bm25`), Groq (`openai/gpt-oss-120b`), FastAPI, Uvicorn, plain HTML/CSS/JavaScript.

---

## 6. Setup

Requires Python 3.12 or 3.13.

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file (copy `.env.example`) and add your Groq API key:

```
GROQ_API_KEY=your_groq_api_key_here
```

Build the vector index once (and again whenever you change files in `data/`):

```bash
python build_index.py
```

---

## 7. Run

```bash
python -m uvicorn api:api
```

Open http://127.0.0.1:8000 in your browser.

On Windows you can also double-click `start.bat`. It runs the app with the project's `venv`.

To test the pipeline without the interface:

```bash
python graph.py       # runs 3 sample questions and prints strategy + answer
python hybrid.py      # prints hybrid search results for a sample question
python ingest.py      # prints how the documents were chunked
```

---

## 8. Project structure

| File / folder | Purpose |
| --- | --- |
| `ingest.py` | Loads the documents, adds airline and flight type, splits into chunks |
| `build_index.py` | Embeds the chunks and builds the Chroma index in `chroma_db/` |
| `hybrid.py` | Semantic + BM25 hybrid retrieval with RRF |
| `graph.py` | LangGraph pipeline (router -> retrieve -> generate) and the answer prompt |
| `api.py` | FastAPI backend: `/ask`, `/ask_stream`, and serves `static/` |
| `static/` | Chat interface: `index.html`, `style.css`, `app.js` |
| `data/` | Sample policy documents: `air_india/` (domestic, international), `emirates/` (international only) |
| `requirements.txt` | Python dependencies (versions not pinned) |
| `.env.example` | Template for the `.env` file |
| `start.bat` | Windows launcher |

Not in the repository (listed in `.gitignore`): `.env`, `venv/`, `chroma_db/`, `__pycache__/`, `*.pyc`, `scratch/`.

---

## 9. API

**`POST /ask`** returns the full answer as JSON.

```json
{ "question": "Can I carry a 100 Wh power bank on Emirates?", "strategy": "auto" }
```

`strategy` is optional and defaults to `auto`; it can also be `semantic`, `keyword` or `hybrid`. The response contains `answer`, `strategy`, `refused`, `seconds` and `sources`.

**`POST /ask_stream`** takes the same body and streams newline-delimited JSON events in this order:

1. `route` - the strategy used
2. `sources` - the retrieved passages and retrieval time
3. `token` - repeated, the answer text as it is generated
4. `done` - whether it was refused, and total seconds

Greetings such as "hi" or "hello" get a fixed reply without retrieval or the LLM.

---

## 10. Interface features

- Auto, Semantic, Keyword or Hybrid mode selector in settings
- Clickable source buttons that open a side panel with the passage
- "How this answer was made" panel (router choice, passages and retrieval time, total time)
- Copy, thumbs up/down, "Try again", and a Stop button while an answer streams
- Dark and light theme
- Chat history of the last 30 chats, stored in the browser's `localStorage` (not on the server)

---

## 11. Questions to try

These are based on what the sample documents actually contain.

| Question | What to expect |
| --- | --- |
| What is the cabin bag limit for Air India domestic economy? | 7 kg, plus one personal item |
| Can I carry a 100 Wh power bank on Emirates? | Yes, up to 100 Wh is allowed in cabin baggage only |
| Can I carry a 120 Wh power bank on Air India international? | Needs airline approval, maximum two per passenger, cabin baggage only |
| How many bags can a business class passenger check on Air India international? | Two bags of up to 32 kg each |
| What is the checked baggage allowance for first class on Emirates? | Three bags of up to 32 kg each |
| Can I take my laptop onto the plane? | Yes, in cabin baggage; take it out of the bag at security (answers for each airline) |
| What is the liquids rule for cabin baggage? | Containers of 100 ml or less, in one transparent resealable bag of up to 1 litre |
| Do I need to carry lighters on my person? | Stated for Air India domestic and Emirates; Air India international does not mention lighters |
| 100 Wh | Triggers keyword search (digit, 4 words or fewer) |

**Questions that should be refused** (not in the documents):

| Question | Why |
| --- | --- |
| What is the checked baggage allowance for Emirates domestic flights? | There is no Emirates domestic document |
| Can I bring a pet on Air India? | Pets are not covered in any document |
| What is the first class allowance on Air India? | Air India documents cover economy and business only |
| What is the weather in Dubai? | Not related to the documents |

---

## 12. Interview questions and answers

**What is this project?**
A RAG chatbot for airport baggage rules. It retrieves relevant passages from policy documents and has an LLM answer only from those passages, showing the sources. If the documents lack the answer, it refuses instead of guessing.

**What is RAG and why use it here?**
Retrieval-augmented generation: instead of relying on what the LLM memorised, you retrieve relevant text first and give it to the model as context. Baggage rules are specific and change by airline, so the answer must come from the documents, not from the model's general knowledge.

**Walk me through the pipeline.**
Documents are loaded and chunked (500 characters, 100 overlap), embedded with all-MiniLM-L6-v2 and stored in Chroma. At question time, a LangGraph router picks semantic, keyword or hybrid retrieval, the top 3 chunks go into a prompt, and the Groq model writes a short answer. The API returns the answer and the source passages.

**Why chunk the documents? Why overlap?**
Embedding and retrieving smaller pieces gives more precise matches and keeps the prompt short. The 100-character overlap reduces the chance that a rule is cut in half at a chunk boundary.

**Why add a label like `[Emirates - international flights]` to each chunk?**
A chunk like "Economy class passengers may check one bag up to 25 kg" does not say which airline it belongs to. The label makes the airline and flight type part of the text that is embedded and shown to the LLM, so it can answer for the right airline.

**What is an embedding and what is a vector database?**
An embedding is a list of numbers representing the meaning of text. A vector database (Chroma here) stores these and finds the stored vectors closest to a query vector, so "laptop" can match text about "electronic devices".

**Why three retrieval strategies?**
Semantic search handles different wording but can miss exact numbers like "100 Wh". BM25 keyword search matches exact terms but not meaning. Hybrid combines both with Reciprocal Rank Fusion.

**What is Reciprocal Rank Fusion?**
A way to merge ranked lists without comparing their raw scores. Each item gets `1 / (60 + rank + 1)` from each list it appears in, the scores are summed, and items are re-sorted.

**How does the router decide?**
Simple rules: a digit with 4 words or fewer goes to keyword, a digit with a longer question goes to hybrid, and no digit goes to semantic. It is a heuristic, not a trained model.

**What does LangGraph do here?**
It defines the pipeline as a graph with shared state: `START -> router -> retrieve -> generate -> END`. The state carries the question, strategy, retrieved documents and answer. It makes each step a separate, testable node and makes it easy to add branches later.

**How do you stop hallucinations?**
Four things: retrieval-only context, a strict prompt (answer only from context, exact refusal sentence, do not extend rules), `temperature=0`, and showing sources so answers can be checked. Refusals are detected and shown as "Not in my documents" with no sources.

**What are the weaknesses?**
- The router is rule-based; for example, any question with a digit goes to keyword or hybrid even if semantic would be better.
- Chroma search is not filtered by airline. The airline is only in the chunk text, so the LLM prompt does the airline filtering.
- Refusal detection is a string match on the answer.
- Sources shown are the retrieved passages, not a check of which ones the model actually used.
- Each question is answered independently; the API does not receive earlier messages, so follow-up questions like "what about business class?" have no memory of the previous question. The chat history in the interface is for display only.
- The BM25 index is built in memory from the documents each time the server starts, so changes to `data/` need both `python build_index.py` and a server restart.
- Only three small sample documents; there is no formal evaluation.
- Dependencies in `requirements.txt` are not version-pinned.

**How would you improve it?**
Add metadata filtering by airline in Chroma, pass chat history to handle follow-ups, add an evaluation set of questions with expected answers, replace the rule-based router with an LLM or classifier, and pin dependency versions.

**Why Groq?**
It provides a hosted LLM through an API with a free tier, so no local GPU is needed. The key is loaded from `.env` and `.env` is excluded from Git.

**Why FastAPI with streaming?**
FastAPI serves the chat interface and the API. `/ask_stream` sends the route, sources and answer tokens as they are produced, so the user sees text appear immediately instead of waiting for the full answer.

---

## 13. Limitations

- Answers are only as good as the documents. If a rule is missing, the bot says it does not have that information.
- The documents are fictional samples. Emirates has no domestic document, and first class is covered only for Emirates.
- The routing rules are simple heuristics, not a learned model.
- No conversation memory between questions on the server side.
- Verify real baggage rules with the airline before travelling.
