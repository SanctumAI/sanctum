# Sanctum — Private RAG System for Curated Knowledge

Sanctum is a privacy-first Retrieval-Augmented Generation (RAG) system for building, maintaining, and querying curated knowledge bases in sensitive domains such as human rights, international law, journalism, and research.

Sanctum runs locally as a Docker Compose application. It combines a structured knowledge graph, a vector search index, and a secure LLM provider to produce grounded, explainable answers — without relying on public RAG services or opaque cloud infrastructure.

---

## Core Principles

- **Grounded answers**: all responses are derived from retrieved, inspectable knowledge
- **Structured memory**: facts and relationships are stored explicitly, not inferred at query time
- **Privacy by design**: data stays local; LLM calls are routed through a secure provider
- **Composable architecture**: graph, vector search, and generation are separate concerns

---

## High-Level Architecture

Sanctum is composed of the following runtime components:

- **Frontend**: Vite-based web UI
- **Backend**: FastAPI application
- **Graph Store**: Neo4j (canonical structured knowledge)
- **Vector Store**: Qdrant (semantic recall)
- **Knowledge Engine**: Graphiti (graph ingestion + retrieval)
- **LLM Provider**: Maple Proxy (secure, OpenAI-compatible, structured outputs)
- **Optional Local LLM**: Ollama (local inference alternative)
- **Deployment**: Docker Compose

All services communicate over an internal Docker network.

---

## Frontend

The frontend is built with **Vite** and React, providing a complete user interface for two distinct personas:

### Admin Flow
- **Authentication**: Nostr identity via NIP-07 browser extension
- **Instance configuration**: Customize branding (name, icon, accent color)
- **User onboarding**: Define custom fields for user registration
- **Document upload**: Submit documents to the RAG knowledge base
- **Database explorer**: View and manage instance data (SQLite)
- **System monitoring**: Test RAG pipeline components

### User Flow
- **Multilingual onboarding**: Language selection (50+ languages supported)
- **Email authentication**: Magic link sign-in flow
- **Profile completion**: Fill admin-defined custom fields
- **RAG Chat**: Query the knowledge base with citations and source context

The frontend does not perform retrieval or generation logic. It communicates exclusively with the FastAPI backend over HTTP.

---

## Backend

The backend is a **FastAPI** service responsible for orchestration.

It performs four core roles:

1. **Ingest orchestration**
   - Accept curated source material
   - Trigger graph ingestion via Graphiti
   - Generate embeddings and update Qdrant
   - Track job completion and failures

2. **Retrieval orchestration**
   - Perform semantic recall using Qdrant
   - Resolve retrieved IDs to canonical graph objects
   - Expand and filter context via Graphiti + Neo4j

3. **Generation orchestration**
   - Assemble a bounded, structured context packet
   - Call the LLM via Maple Proxy
   - Enforce structured outputs and citation requirements

4. **System operations**
   - Job tracking and retries
   - Reindexing and export
   - Access control and auditing (future)

Job execution (ingest, reindex, export) is assumed to be managed asynchronously by the backend.

---

## RAG Architecture (Recommended Flow)

Sanctum implements a **graph-first RAG pipeline**.

### Ingest Flow

1. Curated documents are submitted to the backend
2. Graphiti extracts entities and relationships into Neo4j
3. Canonical graph objects are created or updated
4. Embeddings are generated for:
   - document chunks
   - claims
   - node summaries
5. Embeddings are stored in Qdrant with metadata linking back to graph IDs

Neo4j is the source of truth. Qdrant is a recall accelerator.

---

### Query Flow

1. A user submits a query
2. The backend embeds the query
3. Qdrant returns top-K semantically similar items
4. The backend resolves these to graph entities and relationships
5. Graphiti expands and filters the relevant subgraph
6. A structured context packet is assembled
7. The context packet is sent to the LLM via Maple Proxy
8. The LLM composes a response using retrieved context only
9. The backend returns the answer with citations

The LLM does not select tools or retrieve data. It only synthesizes responses from provided context.

---

## Knowledge Representation

Sanctum stores knowledge explicitly using a graph model.

Typical entity types include:

- Concept
- Claim
- Practice
- Risk
- Source
- Actor (optional)

Typical relationships include:

- Claim SUPPORTED_BY Source
- Practice MITIGATES Risk
- Practice REQUIRES Concept or Tool
- Concept RELATED_TO Concept

Provenance is a first-class concern. All claims are expected to reference sources.

---

## LLM Provider: Maple Proxy

Sanctum uses **Maple Proxy** as its LLM service provider.

Maple Proxy:
- Is OpenAI-compatible
- Provides secure transport and execution
- Supports **structured outputs**, which Graphiti depends on
- Allows Sanctum to enforce JSON schemas and deterministic extraction

The backend treats Maple as a generation and extraction service, not a decision-maker.

---

## Local LLM Option

Sanctum optionally supports **Ollama** for local inference.

Ollama can be used:
- for local testing
- for offline scenarios
- as an alternative to Maple in trusted environments

This is optional and configurable via Docker Compose profiles.

---

## Deployment Model

Sanctum is deployed via **Docker Compose**.

A typical deployment includes containers for:

- FastAPI backend
- Vite frontend
- Neo4j
- Qdrant
- Maple Proxy client configuration
- Optional Ollama

All stateful services use persistent volumes.

---

## Export and Portability

Sanctum supports exporting knowledge at multiple layers:

- Neo4j database dumps and logical exports
- Qdrant snapshots (optional; vectors are regenerable)
- Source documents and manifests
- Ontology and version metadata

This enables full rehydration of the system on another machine.

---

## Scope and Non-Goals

Sanctum is not:

- an autonomous agent
- a generic chatbot
- a cloud RAG platform
- a document search toy

It is a **curated, explainable RAG system** optimized for correctness, privacy, and long-term knowledge stewardship.

---

## Status

Architecture finalized. Implementation in progress.

Primary next steps:
- Finalize ontology v1
- Implement ingest + query pipelines
- Wire Maple structured output enforcement
- Build job tracking endpoints
- Harden export and reindex paths




“Sanctum uses local, open-source sentence embeddings (e.g., BGE/E5-class models) selected for universality, robustness, and CPU-friendly operation.”